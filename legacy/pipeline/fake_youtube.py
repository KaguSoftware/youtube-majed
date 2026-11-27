"""A stand-in for Google's token endpoint and the YouTube Data API, for the
queue test. No network, no account, no quota.

It speaks the parts of the protocol `pipeline/youtube.py` uses, the way
YouTube does: a resumable session answers a status query with 308 and a
`Range` header, or with the finished video once every byte has arrived. Its
state is plain attributes, so a test can make it misbehave and then check
what reached it: how many sessions were opened (each one is an upload
charged against the day), how many videos exist, which bytes arrived when.

    server = FakeYouTube()
    env = server.env()          # for a worker process
    server.quota = True         # the next upload is refused with quotaExceeded
    server.close()
"""

from __future__ import annotations

import http.server
import json
import threading
import time
import urllib.parse


class FakeYouTube:
    CHANNEL = {"id": "UCfakeHistory0000000000", "title": "Fake History"}

    def __init__(self) -> None:
        self.sessions: dict[str, dict] = {}
        self.videos: dict[str, dict] = {}
        self.thumbnails: dict[str, int] = {}
        self.tokens = 0
        self.reads = 0
        #: Misbehaviour, set by the test.
        self.quota = False              # uploads refused: quotaExceeded
        self.revoked = False            # the refresh token: invalid_grant
        self.thumb_forbidden = False    # an unverified channel's thumbnails: 403
        self.lock_private = False       # an unaudited app's uploads: made private
        self.fail_puts: set[int] = set()  # 1-based chunk PUTs answered 503
        self.chunk_delay = 0.0          # seconds per chunk, to give a kill test time
        self.forgotten: set[str] = set()  # session ids answered 404, as if expired
        self.puts = 0
        fake = self

        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def _send(self, code: int, body: dict | None = None, headers: dict | None = None) -> None:
                data = json.dumps(body).encode() if body is not None else b""
                self.send_response(code)
                for k, v in (headers or {}).items():
                    self.send_header(k, v)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def _body(self) -> bytes:
                n = int(self.headers.get("Content-Length") or 0)
                return self.rfile.read(n) if n else b""

            def _error(self, code: int, reason: str, message: str) -> None:
                self._send(code, {"error": {"code": code, "message": message,
                                            "errors": [{"reason": reason, "message": message}]}})

            def _authed(self) -> bool:
                if not (self.headers.get("Authorization") or "").startswith("Bearer tok-"):
                    self._error(401, "authError", "Invalid Credentials")
                    return False
                return True

            def do_POST(self):  # noqa: N802
                u = urllib.parse.urlsplit(self.path)
                q = dict(urllib.parse.parse_qsl(u.query))
                body = self._body()
                if u.path == "/token":
                    form = dict(urllib.parse.parse_qsl(body.decode()))
                    if fake.revoked or form.get("refresh_token") != "refresh-ok":
                        return self._send(400, {"error": "invalid_grant",
                                                "error_description": "Token has been expired or revoked."})
                    fake.tokens += 1
                    return self._send(200, {"access_token": f"tok-{fake.tokens}", "expires_in": 3599})
                if not self._authed():
                    return None
                if u.path == "/upload/youtube/v3/videos" and q.get("uploadType") == "resumable":
                    if fake.quota:
                        return self._error(403, "quotaExceeded", "The request cannot be completed "
                                           "because you have exceeded your quota.")
                    sid = f"s{len(fake.sessions) + 1}"
                    fake.sessions[sid] = {"meta": json.loads(body), "size": int(self.headers["X-Upload-Content-Length"]),
                                          "received": 0, "chunks": [], "video": None}
                    host = self.headers.get("Host")
                    return self._send(200, {}, {"Location": f"http://{host}/upload/session/{sid}"})
                if u.path == "/upload/youtube/v3/thumbnails/set":
                    if fake.thumb_forbidden:
                        return self._error(403, "forbidden", "The authenticated user doesn't have "
                                           "permissions for uploading and setting custom video thumbnails.")
                    if q.get("videoId") not in fake.videos:
                        return self._error(404, "videoNotFound", "no such video")
                    fake.thumbnails[q["videoId"]] = len(body)
                    return self._send(200, {"items": [{"default": {"url": "x"}}]})
                return self._send(404, {"error": "not here"})

            def do_PUT(self):  # noqa: N802
                u = urllib.parse.urlsplit(self.path)
                body = self._body()
                sid = u.path.rsplit("/", 1)[-1]
                s = fake.sessions.get(sid)
                if s is None or sid in fake.forgotten:
                    return self._send(404, {"error": {"code": 404, "message": "session not found"}})
                rng = self.headers.get("Content-Range", "")
                if s["video"]:
                    return self._send(200, fake.videos[s["video"]])
                if rng.startswith("bytes */"):
                    return self._partial(s)
                fake.puts += 1
                if fake.puts in fake.fail_puts:
                    return self._error(503, "backendError", "injected")
                if fake.chunk_delay:
                    time.sleep(fake.chunk_delay)
                start = int(rng.split(" ", 1)[1].split("-", 1)[0])
                if start != s["received"]:
                    return self._partial(s)
                s["received"] += len(body)
                s["chunks"].append((start, len(body)))
                if s["received"] < s["size"]:
                    return self._partial(s)
                vid = f"vid{len(fake.videos) + 1:08d}"
                st = s["meta"].get("status", {})
                fake.videos[vid] = {
                    "id": vid, "snippet": {**s["meta"].get("snippet", {}), "channelId": fake.CHANNEL["id"]},
                    "status": {**st, "privacyStatus": "private" if fake.lock_private else st.get("privacyStatus"),
                               "uploadStatus": "uploaded"},
                    "processingDetails": {"processingStatus": "processing"},
                }
                s["video"] = vid
                return self._send(201, fake.videos[vid])

            def _partial(self, s: dict) -> None:
                headers = {"Range": f"bytes=0-{s['received'] - 1}"} if s["received"] else {}
                self._send(308, None, headers)

            def do_GET(self):  # noqa: N802
                u = urllib.parse.urlsplit(self.path)
                q = dict(urllib.parse.parse_qsl(u.query))
                if not self._authed():
                    return None
                if u.path == "/youtube/v3/channels":
                    return self._send(200, {"items": [{"id": fake.CHANNEL["id"],
                                                       "snippet": {"title": fake.CHANNEL["title"]}}]})
                if u.path == "/youtube/v3/videos":
                    fake.reads += 1
                    v = fake.videos.get(q.get("id", ""))
                    if v and v["status"]["uploadStatus"] == "uploaded" and fake.reads > 1:
                        v["status"]["uploadStatus"] = "processed"
                        v["processingDetails"]["processingStatus"] = "succeeded"
                    return self._send(200, {"items": [v] if v else []})
                return self._send(404, {"error": "not here"})

            def log_message(self, *a):
                pass

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.root = f"http://127.0.0.1:{self.server.server_port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def env(self) -> dict[str, str]:
        """What a worker needs to publish here instead of to YouTube."""
        return {"YOUTUBE_API_ROOT": self.root, "YOUTUBE_TOKEN_URL": f"{self.root}/token",
                "YOUTUBE_CLIENT_ID": "fake-client", "YOUTUBE_CLIENT_SECRET": "fake-secret",
                "YOUTUBE_REFRESH_TOKEN": "refresh-ok", "YOUTUBE_CHUNK_BYTES": str(256 * 1024),
                "YOUTUBE_BACKOFF_SECONDS": "0.05", "YOUTUBE_PROCESSING_POLL": "0.2",
                "YOUTUBE_PROCESSING_WAIT": "3"}

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
