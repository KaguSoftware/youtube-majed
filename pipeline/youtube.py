"""YouTube: connect the channel once, then upload cuts to it. PLAN.md Phase 6.

    python -m pipeline.youtube connect     # once, on the studio machine; opens a browser
    python -m pipeline.youtube status      # which channel, and whether the connection works

Stdlib only (http.client), so publishing adds nothing to requirements.lock.

### Credentials stay on the studio machine

The worker uploads, so the worker holds the channel's refresh token, in the
same env file as its other secrets (`worker.DEFAULT_ENV_FILE`). Neither the
database nor Vercel ever sees a Google credential: the studio asks for a
publish by writing a row, as it asks for everything else. `connect` is the
OAuth flow for a desktop app (loopback redirect, PKCE; Google retired the
copy-paste flow) and writes the token into that file.

Two Google rules decide whether the connection lasts:
- An OAuth app whose consent screen is still in **Testing** gets refresh
  tokens that expire after **7 days**. Set it to "In production". An
  unverified app in production is allowed for its owner; Google shows a
  warning screen once, at connect.
- Each client keeps at most 100 refresh tokens per account; connecting a
  101st time silently revokes the oldest. Only one is ever in use here.

### An upload never happens twice

A resumable session is opened before any bytes move, and its URI is
checkpointed on the job first (`on_session`). A worker killed mid-upload
resumes *that* session: it asks how many bytes arrived and sends the rest. If
the upload had finished but the reply was lost, the same question returns
the finished video. Only a session YouTube no longer knows (404/410) starts a
new one, and that means the video was never created. Once a video id exists it
is recorded on the publication, and a publication with a video id is never
uploaded again.

### Quota (failure mode 14)

Since June 2026 `videos.insert` has its own bucket: 100 uploads a day per
project, at 1 unit each. Everything else shares 10,000 units: a thumbnail
costs 50 and a status read 1. Days end at midnight Pacific time. A quota or
upload-limit refusal is `Refused`: the job fails at once and is never retried
automatically, because a blind retry spends what is left of the day on
requests that will fail.
"""

from __future__ import annotations

import base64
import hashlib
import http.client
import json
import os
import secrets
import ssl
import sys
import time
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path

from .publish import CATEGORY_EDUCATION

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
API_ROOT = "https://www.googleapis.com"


def _token_url() -> str:
    """Overridable, read per call, so the queue test can stand in for Google
    (pipeline/fake_youtube.py)."""
    return os.environ.get("YOUTUBE_TOKEN_URL", TOKEN_URL)


def _api_root() -> str:
    return os.environ.get("YOUTUBE_API_ROOT", API_ROOT)

#: Upload, plus read access to see the channel and the video's status after.
SCOPES = ("https://www.googleapis.com/auth/youtube.upload",
          "https://www.googleapis.com/auth/youtube.readonly")

#: Uploads per Pacific day the Video Uploads bucket allows by default.
DAILY_UPLOADS = int(os.environ.get("YOUTUBE_DAILY_UPLOADS", 100))

#: Upload chunk. Must be a multiple of 256 KiB. 8 MiB keeps a lost chunk
#: cheap to resend on a home uplink without one request per second.
CHUNK = int(os.environ.get("YOUTUBE_CHUNK_BYTES", 8 * 1024 * 1024))

#: A chunk that fails with a 5xx or a dropped connection is retried this many
#: times, with backoff, before the failure reaches the job (which then retries
#: the whole job, resuming the same session).
CHUNK_RETRIES = 5
BACKOFF_SECONDS = float(os.environ.get("YOUTUBE_BACKOFF_SECONDS", 2.0))

#: Error reasons that mean "not today": never retried automatically.
QUOTA_REASONS = {"quotaExceeded", "uploadLimitExceeded", "rateLimitExceeded",
                 "userRateLimitExceeded", "dailyLimitExceeded", "uploadRateLimitExceeded"}


class Refused(RuntimeError):
    """YouTube said no in a way a retry would only repeat. The job fails at
    once with this message, which the studio shows."""


class NotConnected(Refused):
    """No channel connected, or the connection was revoked or expired."""


class QuotaExceeded(Refused):
    """A daily limit, YouTube's or ours. Try again after midnight Pacific."""


class YouTubeError(Refused):
    """Any other 4xx, with YouTube's reason (`invalidTitle`, `forbidden`, ...):
    the request itself is wrong, so sending it again changes nothing."""

    def __init__(self, status: int, reason: str, message: str) -> None:
        super().__init__(f"YouTube {status} {reason}: {message}")
        self.status, self.reason, self.message = status, reason, message


class Transient(RuntimeError):
    """A failure worth retrying: a 5xx, a dropped connection."""


def _error(status: int, body: bytes) -> Exception:
    """An error response as the exception that says what to do about it."""
    reason, message = "", body.decode(errors="replace")[:300]
    try:
        err = json.loads(body)["error"]
        if isinstance(err, dict):
            message = err.get("message") or message
            reason = ((err.get("errors") or [{}])[0].get("reason")) or err.get("status") or ""
        else:                                    # the token endpoint: {"error": "invalid_grant"}
            reason, message = str(err), json.loads(body).get("error_description", message)
    except (ValueError, KeyError, TypeError, IndexError):
        pass
    if reason in QUOTA_REASONS:
        return QuotaExceeded(f"YouTube's daily limit is reached ({reason}). Nothing was retried; "
                             "publish again after midnight Pacific time.")
    if reason == "invalid_grant" or status == 401:
        return NotConnected("The studio machine's connection to YouTube has expired or was revoked. "
                            "Connect it again: python -m pipeline.youtube connect")
    if status >= 500 or status == 429:
        return Transient(f"YouTube {status} {reason}: {message}")
    return YouTubeError(status, reason, message)


# ----------------------------------------------------------------- transport


def _request(method: str, url: str, *, headers: dict | None = None, body: bytes | None = None,
             timeout: float = 120.0) -> tuple[int, dict, bytes]:
    """One HTTP exchange. No redirects are followed: in the resumable protocol
    a 308 is an answer ("this much arrived"), not a redirect."""
    u = urllib.parse.urlsplit(url)
    conn_cls = http.client.HTTPSConnection if u.scheme == "https" else http.client.HTTPConnection
    kwargs = {"context": ssl.create_default_context()} if u.scheme == "https" else {}
    conn = conn_cls(u.hostname, u.port, timeout=timeout, **kwargs)
    try:
        path = u.path + (f"?{u.query}" if u.query else "")
        conn.request(method, path, body=body, headers=headers or {})
        r = conn.getresponse()
        return r.status, {k.lower(): v for k, v in r.getheaders()}, r.read()
    except (OSError, http.client.HTTPException) as exc:
        raise Transient(f"{method} {u.hostname}: {type(exc).__name__}: {exc}") from exc
    finally:
        conn.close()


# ---------------------------------------------------------------- the client


@dataclass
class Client:
    client_id: str
    client_secret: str
    refresh_token: str
    log: object = print
    _token: str | None = None
    _expires: float = 0.0
    #: Units this client spent, by bucket, for the job's record.
    spent: dict = field(default_factory=lambda: {"uploads": 0, "units": 0})

    @classmethod
    def from_env(cls, log=print) -> "Client":
        missing = [k for k in ("YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN")
                   if not os.environ.get(k)]
        if missing:
            raise NotConnected("No YouTube channel is connected to the studio machine yet. "
                               "Connect one: python -m pipeline.youtube connect")
        return cls(os.environ["YOUTUBE_CLIENT_ID"], os.environ["YOUTUBE_CLIENT_SECRET"],
                   os.environ["YOUTUBE_REFRESH_TOKEN"], log=log)

    def token(self) -> str:
        if self._token and time.time() < self._expires - 60:
            return self._token
        status, _, body = _request("POST", _token_url(), headers={
            "Content-Type": "application/x-www-form-urlencoded"}, body=urllib.parse.urlencode({
                "grant_type": "refresh_token", "refresh_token": self.refresh_token,
                "client_id": self.client_id, "client_secret": self.client_secret}).encode())
        if status != 200:
            raise _error(status, body)
        data = json.loads(body)
        self._token, self._expires = data["access_token"], time.time() + float(data.get("expires_in", 3600))
        return self._token

    def _api(self, method: str, path: str, *, params: dict | None = None, body: bytes | None = None,
             content_type: str | None = None, units: int = 0, extra: dict | None = None,
             root: str = "/youtube/v3") -> tuple[int, dict, bytes]:
        url = f"{_api_root()}{root}{path}" + (f"?{urllib.parse.urlencode(params)}" if params else "")
        headers = {"Authorization": f"Bearer {self.token()}", **(extra or {})}
        if content_type:
            headers["Content-Type"] = content_type
        if body is not None:
            headers["Content-Length"] = str(len(body))
        status, h, data = _request(method, url, headers=headers, body=body)
        self.spent["units"] += units
        return status, h, data

    def _json(self, *a, **kw) -> dict:
        status, _, body = self._api(*a, **kw)
        if status not in (200, 201):
            raise _error(status, body)
        return json.loads(body or b"{}")

    # ------------------------------------------------------------- reads

    def channel(self) -> dict:
        """The channel the connection uploads to: {id, title}. 1 unit."""
        data = self._json("GET", "/channels", params={"part": "snippet", "mine": "true"}, units=1)
        items = data.get("items") or []
        if not items:
            raise Refused("The connected Google account has no YouTube channel. "
                          "Create one, then connect again.")
        return {"id": items[0]["id"], "title": items[0]["snippet"]["title"]}

    def video(self, video_id: str) -> dict | None:
        """status and processingDetails of an uploaded video. 1 unit."""
        data = self._json("GET", "/videos", params={"part": "status,processingDetails", "id": video_id},
                          units=1)
        items = data.get("items") or []
        return items[0] if items else None

    # ----------------------------------------------------------- uploads

    def start_upload(self, metadata: dict, size: int, content_type: str = "video/mp4") -> str:
        """Open a resumable session for `size` bytes. -> the session URI.
        This is the call the Video Uploads bucket charges."""
        status, h, body = self._api(
            "POST", "/videos", root="/upload/youtube/v3",
            params={"uploadType": "resumable", "part": "snippet,status"},
            body=json.dumps(metadata).encode(), content_type="application/json; charset=UTF-8",
            extra={"X-Upload-Content-Length": str(size), "X-Upload-Content-Type": content_type})
        if status != 200 or "location" not in h:
            raise _error(status, body)
        self.spent["uploads"] += 1
        return h["location"]

    def upload_status(self, session: str, size: int) -> tuple[str, object]:
        """Where a session stands: ("done", video), ("partial", next byte) or
        ("gone", None) for a session YouTube no longer knows."""
        status, h, body = _request("PUT", session, headers={
            "Authorization": f"Bearer {self.token()}", "Content-Length": "0",
            "Content-Range": f"bytes */{size}"})
        if status in (200, 201):
            return "done", json.loads(body)
        if status == 308:
            return "partial", _next_byte(h)
        if status in (404, 410):
            return "gone", None
        raise _error(status, body)

    def upload(self, path: Path, metadata: dict, *, session: str | None = None, on_session=None,
               on_progress=None, should_stop=None) -> dict:
        """Upload `path`, resuming `session` if given. -> the video resource.

        `on_session(uri)` is called before any bytes are sent: the caller
        records it, so a kill at any instant leaves a session to resume
        rather than a reason to upload again."""
        size = path.stat().st_size
        offset = 0
        if session:
            state, value = self.upload_status(session, size)
            if state == "done":
                self.log("  the upload had already finished; taking the video it made")
                return value
            if state == "partial":
                offset = int(value)
                self.log(f"  resuming the upload at {offset / 1e6:.1f} of {size / 1e6:.1f} MB")
            else:
                self.log("  YouTube no longer knows the earlier upload; starting a new one")
                session = None
        if not session:
            session = self.start_upload(metadata, size)
            if on_session:
                on_session(session)
        failures = 0
        with path.open("rb") as f:
            while True:
                if should_stop:
                    should_stop()
                end = min(offset + CHUNK, size)
                f.seek(offset)
                data = f.read(end - offset)
                try:
                    status, h, body = _request("PUT", session, body=data, headers={
                        "Authorization": f"Bearer {self.token()}", "Content-Length": str(len(data)),
                        "Content-Type": "video/mp4",
                        "Content-Range": f"bytes {offset}-{end - 1}/{size}" if data else f"bytes */{size}"},
                        timeout=300.0)
                    err = (None if status in (200, 201, 308)
                           # Expired mid-upload: no video was made, so the job's
                           # retry may open a new session (upload_status: "gone").
                           else Transient("the upload session expired") if status in (404, 410)
                           else _error(status, body))
                except Transient as exc:
                    err = exc
                if err is None and status in (200, 201):
                    # No progress call here: the caller's progress write is
                    # fenced, and the video must reach the caller even if
                    # the job was stopped while the last bytes went.
                    return json.loads(body)
                if err is None:                      # 308: this much arrived
                    offset, failures = _next_byte(h), 0
                    if on_progress:
                        on_progress(offset, size)
                    continue
                if not isinstance(err, Transient):
                    raise err
                failures += 1
                if failures > CHUNK_RETRIES:
                    raise err
                wait = BACKOFF_SECONDS * 2 ** (failures - 1)
                self.log(f"  upload chunk failed ({err}); asking where it stands in {wait:.0f}s")
                time.sleep(wait)
                state, value = self.upload_status(session, size)
                if state == "done":
                    return value
                if state == "gone":
                    raise Transient("the upload session expired mid-upload")
                offset = int(value)

    def set_thumbnail(self, video_id: str, image: Path) -> None:
        """thumbnails.set, ~50 units. Refused (403) unless the channel is
        verified: the caller records that and carries on."""
        status, _, body = self._api(
            "POST", "/thumbnails/set", root="/upload/youtube/v3",
            params={"videoId": video_id, "uploadType": "media"},
            body=image.read_bytes(), content_type="image/jpeg", units=50)
        if status not in (200, 201):
            raise _error(status, body)


def _next_byte(headers: dict) -> int:
    """The byte to send next, from a 308's `Range: bytes=0-N` (none: 0)."""
    r = headers.get("range")
    return int(r.rsplit("-", 1)[1]) + 1 if r else 0


def metadata(pub: dict) -> dict:
    """The `videos` resource sent with the upload, from a publications row."""
    return {
        "snippet": {
            "title": pub["title"], "description": pub["description"], "tags": list(pub["tags"] or []),
            "categoryId": CATEGORY_EDUCATION, "defaultLanguage": "en", "defaultAudioLanguage": "en",
        },
        "status": {
            "privacyStatus": pub["privacy"], "selfDeclaredMadeForKids": bool(pub["made_for_kids"]),
            "containsSyntheticMedia": bool(pub["synthetic"]), "embeddable": True,
        },
    }


#: YouTube's recommended thumbnail: 1280x720, 16:9.
THUMB_SIZE = (1280, 720)


def make_thumbnail(still: Path, dest: Path) -> Path:
    """A still as a 1280x720 JPEG: scaled to cover, centre-cropped to 16:9.
    The stills are 832x480 (~1.73:1), so the crop takes a sliver off the top
    and bottom and nothing from the sides."""
    from PIL import Image

    W, H = THUMB_SIZE
    with Image.open(still) as im:
        im = im.convert("RGB")
        scale = max(W / im.width, H / im.height)
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
        x, y = (im.width - W) // 2, (im.height - H) // 2
        im = im.crop((x, y, x + W, y + H))
        dest.parent.mkdir(parents=True, exist_ok=True)
        im.save(dest, "JPEG", quality=90, optimize=True)
    return dest


# ------------------------------------------------------------------- connect


def _pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def authorize(client_id: str, client_secret: str, *, open_browser: bool = True,
              timeout: float = 300.0) -> str:
    """The desktop-app OAuth flow: a one-shot server on a loopback port takes
    Google's redirect. -> a refresh token."""
    import http.server
    import threading
    import webbrowser

    verifier, challenge = _pkce()
    state = secrets.token_urlsafe(16)
    got: dict = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(self.path).query))
            if "code" not in q and "error" not in q:
                self.send_response(404)
                self.end_headers()
                return
            got.update(q)
            ok = q.get("state") == state and "code" in q
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(("<p style='font:16px system-ui;margin:3rem'>"
                              + ("Connected. You can close this tab." if ok else
                                 f"Not connected: {q.get('error', 'the reply did not match')}.")
                              + "</p>").encode())

        def log_message(self, *a):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    server.timeout = timeout
    redirect = f"http://127.0.0.1:{server.server_port}"
    url = AUTH_URL + "?" + urllib.parse.urlencode({
        "client_id": client_id, "redirect_uri": redirect, "response_type": "code",
        "scope": " ".join(SCOPES), "access_type": "offline", "prompt": "consent",
        "code_challenge": challenge, "code_challenge_method": "S256", "state": state})
    print(f"Sign in with the Google account that owns the channel, and choose the channel:\n\n  {url}\n")
    if open_browser:
        webbrowser.open(url)
    thread = threading.Thread(target=lambda: [server.handle_request() for _ in range(5) if not got],
                              daemon=True)
    thread.start()
    thread.join(timeout)
    server.server_close()
    if not got:
        raise SystemExit("no reply from Google within the time allowed")
    if got.get("state") != state:
        raise SystemExit("the reply did not match this request (state); try again")
    if "code" not in got:
        raise SystemExit(f"Google said: {got.get('error')}")
    status, _, body = _request("POST", _token_url(), headers={
        "Content-Type": "application/x-www-form-urlencoded"}, body=urllib.parse.urlencode({
            "grant_type": "authorization_code", "code": got["code"], "code_verifier": verifier,
            "client_id": client_id, "client_secret": client_secret, "redirect_uri": redirect}).encode())
    if status != 200:
        raise SystemExit(f"the token exchange failed: {_error(status, body)}")
    data = json.loads(body)
    if "refresh_token" not in data:
        raise SystemExit("Google returned no refresh token; remove the app's access at "
                         "myaccount.google.com/permissions and connect again")
    return data["refresh_token"]


def write_env(path: Path, values: dict[str, str]) -> None:
    """Set keys in the worker's env file, keeping every other line. 0600."""
    lines = path.read_text().splitlines() if path.is_file() else []
    done = set()
    out = []
    for line in lines:
        key = line.split("=", 1)[0].strip().removeprefix("export ").strip() if "=" in line else None
        if key in values:
            out.append(f"{key}={values[key]}")
            done.add(key)
        else:
            out.append(line)
    out += [f"{k}={v}" for k, v in values.items() if k not in done]
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.partial")
    tmp.write_text("\n".join(out) + "\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def main(argv: list[str] | None = None) -> int:
    import argparse
    import getpass

    from . import worker

    env_file = Path(os.environ.get("WORKER_ENV_FILE", worker.DEFAULT_ENV_FILE))
    worker.load_env_file(env_file)
    ap = argparse.ArgumentParser(prog="python -m pipeline.youtube", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("connect", help="connect the channel the studio publishes to")
    c.add_argument("--client-id", default=os.environ.get("YOUTUBE_CLIENT_ID"))
    c.add_argument("--no-browser", action="store_true")
    sub.add_parser("status", help="the connected channel, checked against YouTube")
    args = ap.parse_args(argv)

    if args.cmd == "connect":
        client_id = args.client_id or input("OAuth client ID (Desktop app): ").strip()
        same = client_id == os.environ.get("YOUTUBE_CLIENT_ID")
        secret = (same and os.environ.get("YOUTUBE_CLIENT_SECRET")) or getpass.getpass(
            "OAuth client secret: ").strip()
        refresh = authorize(client_id, secret, open_browser=not args.no_browser)
        ch = Client(client_id, secret, refresh).channel()
        write_env(env_file, {"YOUTUBE_CLIENT_ID": client_id, "YOUTUBE_CLIENT_SECRET": secret,
                             "YOUTUBE_REFRESH_TOKEN": refresh})
        print(f"connected: {ch['title']} ({ch['id']})\nsaved to {env_file}; "
              "restart the light worker (deploy/install-worker.sh) to pick it up")
        return 0

    try:
        client = Client.from_env()
        ch = client.channel()
    except Refused as exc:
        print(exc)
        return 1
    print(f"connected: {ch['title']} ({ch['id']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
