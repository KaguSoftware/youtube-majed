"""Media storage: the local content-addressed cache, in front of Blob.

Phase 2 resumed a job by re-running it against `work/cache/`, which only works
for a worker that shares that disk. This puts a remote store behind the cache,
so the lookup for every expensive artifact becomes

    local file  ->  remote store  ->  generate (and upload)

and a worker on a different machine, with an empty disk, finishes another
worker's job without regenerating its shots (PLAN.md Phase 3, carried item 1).

### Keys

A key is the artifact's path under `work/cache/`, so the local cache *is* a
mirror of the remote one and nothing needs translating:

    images/<hash>.png       generated stills, every attempt including rerolls
    audio/<hash>.wav|json   narration and its beat index
    align/<hash>.json       forced alignment
    films/<sha>.mp4         an mp4 of a film version, made for a download
    refs/<sha>.png          style references (hero crops)
    chunks/<hash>.ts        the delivered film, one chunk per shot (assemble.py)
    narration/<hash>.ts     the narration as the film's audio stream

### What is uploaded, and what is not

Only what is expensive to make or must be seen in the browser. Images are the
GPU's output. Chunks and the narration stream are the film the browser plays. Narration and alignment are cheap, but they are not reproducible
*across machines* — a different torch build can synthesize different samples,
the aligner then times different words, and the shot plan moves — so a
takeover must read the original bytes. Films are the deliverable.

Ken Burns segments are not uploaded. They are ffmpeg output from the images,
re-rendered in seconds, and at ~3 MB each they would fill the free tier's
1 GB store in a handful of projects.

### Publishing heals

Every artifact a run *uses* is published, not only the ones it generated. A
file made by an attempt whose upload failed is a local cache hit on the next
attempt; if publishing followed generation only, it would never reach the
store and the timeline would name a still no other machine (and no browser)
can fetch. Measured in the Phase 3 takeover run: one transient Blob error left
exactly that hole. For a key already indexed, publishing costs one query.

Uploads are retried with backoff before a failure reaches the job, since an
error there otherwise spends one of the job's three attempts.

### Upload first, pointer second

`publish` uploads, then records the key in the `media` table. A job only
points at media (a checkpoint, a timeline) after `publish` returned, so a
pointer can never lead to a blob that is not there (PLAN.md failure mode 9).
The table doubles as the index of what the store holds, which spares the
store's metered `head` calls and lets the web app show usage against the
1 GB allowance without listing the store.
"""

from __future__ import annotations

import os
import shutil
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Protocol

from . import config
from .timeline import file_sha

#: Content-addressed blobs never change, so the CDN may keep them as long as it
#: likes. The store's own default is one month.
IMMUTABLE_MAX_AGE = 365 * 24 * 3600

#: Uploads at once in `publish_many`.
UPLOAD_JOBS = 4

#: Above this a single PUT is replaced by a multipart upload (Vercel's advice
#: is 100 MB). A 3-minute film at the current bitrate is around 100 MB.
MULTIPART_ABOVE = 64 * 1024 * 1024
PART_SIZE = 16 * 1024 * 1024

CONTENT_TYPES = {".png": "image/png", ".wav": "audio/wav", ".json": "application/json",
                 ".mp4": "video/mp4", ".ts": "video/mp2t", ".webp": "image/webp"}


class Remote(Protocol):
    name: str

    def get(self, key: str, dest: Path) -> bool:
        """Download `key` to `dest` atomically. False if the store lacks it."""

    def put(self, key: str, src: Path) -> None:
        """Upload `src` as `key`. Idempotent: an existing key is success."""

    def delete(self, key: str) -> None:
        """Remove `key`. Upkeep only (pipeline/upkeep.py)."""


class NoRemote:
    """Local cache only: the Phase 2 behaviour, and the slice's."""

    name = "none"

    def get(self, key: str, dest: Path) -> bool:
        return False

    def put(self, key: str, src: Path) -> None:
        pass

    def delete(self, key: str) -> None:
        pass


class DirRemote:
    """A directory standing in for Blob. The queue test uses it to prove the
    takeover property without a network or an account.

    `fail_puts` lists 1-based upload numbers that raise, to exercise the
    retry and healing paths the real store needs (MEDIA_DIR_FAIL_PUTS)."""

    def __init__(self, root: Path, fail_puts: set[int] | None = None) -> None:
        self.root = root
        self.name = f"dir:{root}"
        self.fail_puts = fail_puts or set()
        self.puts = 0

    def get(self, key: str, dest: Path) -> bool:
        src = self.root / key
        if not src.is_file():
            return False
        _atomic_copy(src, dest)
        return True

    def put(self, key: str, src: Path) -> None:
        self.puts += 1
        if self.puts in self.fail_puts:
            raise RuntimeError(f"injected upload failure #{self.puts} ({key})")
        dest = self.root / key
        if not dest.exists():
            _atomic_copy(src, dest)

    def delete(self, key: str) -> None:
        (self.root / key).unlink(missing_ok=True)


class BlobRemote:
    """A private Vercel Blob store, authenticated by BLOB_READ_WRITE_TOKEN.

    Private because nothing here is meant to be public before it is posted.
    The browser plays films through short-lived presigned URLs the web app
    issues; those go straight to the store with HTTP range support, so a
    video never streams through a function (measured in the Phase 3 spike).
    """

    def __init__(self) -> None:
        from vercel.blob import sync as blob

        token = os.environ.get("BLOB_READ_WRITE_TOKEN", "")
        if not token:
            raise RuntimeError("BLOB_READ_WRITE_TOKEN is not set")
        # vercel_blob_rw_<store id>_<secret>. The name scopes the media index
        # to this store; it never includes the secret.
        parts = token.split("_")
        store_id = parts[3] if len(parts) > 4 and token.startswith("vercel_blob_rw_") else "unknown"
        self.name = f"vercel-blob:{store_id}"
        self._b = blob

    def get(self, key: str, dest: Path) -> bool:
        try:
            result = self._b.get_blob(key, access="private")
        except self._b.BlobNotFoundError:
            return False
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = config.partial(dest)
        tmp.write_bytes(result.body)
        os.replace(tmp, dest)
        return True

    def put(self, key: str, src: Path) -> None:
        ctype = CONTENT_TYPES.get(src.suffix, "application/octet-stream")
        try:
            if src.stat().st_size > MULTIPART_ABOVE:
                with self._b.multipart_upload_blob(
                        key, access="private", content_type=ctype,
                        cache_control_max_age=IMMUTABLE_MAX_AGE) as up, src.open("rb") as f:
                    while chunk := f.read(PART_SIZE):
                        up.upload_part(chunk)
            else:
                self._b.put_blob(key, src.read_bytes(), access="private", content_type=ctype,
                                 cache_control_max_age=IMMUTABLE_MAX_AGE)
        except self._b.BlobError as exc:
            # Keys are content addresses, so an existing blob holds these
            # exact bytes: a retried upload after a lost response, or another
            # worker that got there first.
            if "already exists" not in str(exc):
                raise

    def delete(self, key: str) -> None:
        """Only upkeep deletes (pipeline/upkeep.py): content-addressed media is
        otherwise never removed, since some cut may still name it."""
        self._b.delete_blob(key)


def remote_from_env() -> Remote:
    """MEDIA_DIR for a directory store, else Blob when its token is present."""
    if os.environ.get("MEDIA_DIR"):
        fails = {int(n) for n in os.environ.get("MEDIA_DIR_FAIL_PUTS", "").split(",") if n.strip()}
        return DirRemote(Path(os.environ["MEDIA_DIR"]), fail_puts=fails)
    if os.environ.get("BLOB_READ_WRITE_TOKEN"):
        return BlobRemote()
    return NoRemote()


class Index(Protocol):
    """What the store is known to hold. The worker's is the `media` table."""

    def size(self, key: str) -> int | None:
        """The byte size recorded at upload, or None if the store lacks `key`."""

    def known(self, key: str) -> bool: ...

    def record(self, key: str, *, size: int, kind: str) -> None: ...


class Mirror:
    """The local cache with a remote store behind it.

    Lookups are local first, so a worker that made a file never downloads it,
    and a re-run on the same machine costs the store nothing.
    """

    #: Upload attempts and the first backoff (doubling). Five tries over ~15s
    #: ride out the transient errors Blob returns under load.
    PUT_TRIES = 5
    PUT_BACKOFF = 1.0

    def __init__(self, cache: Path, remote: Remote | None = None, index: Index | None = None,
                 log=print) -> None:
        self.cache = cache
        self.remote = remote or NoRemote()
        self.index = index
        self.log = log
        self.fetched = 0
        self.published = 0
        self.put_retries = 0

    @property
    def enabled(self) -> bool:
        return not isinstance(self.remote, NoRemote)

    def key(self, path: Path) -> str:
        return path.relative_to(self.cache).as_posix()

    def path(self, key: str) -> Path:
        return self.cache / key

    def has(self, path: Path) -> bool:
        """Is `path` made, here or in the store? Never downloads. For work
        that only needs to know whether to redo something, such as an edit
        deciding which chunks to encode."""
        if path.exists() and path.stat().st_size > 0:
            return True
        return self.enabled and self.index is not None and self.index.known(self.key(path))

    def ensure(self, path: Path) -> bool:
        """True if `path` is available locally, fetching it if the store has it."""
        if path.exists() and path.stat().st_size > 0:
            return True
        if not self.enabled:
            return False
        key = self.key(path)
        # Every worker publishes through the index, so a key it does not know
        # is not in the store. Asking anyway would cost a metered request per
        # new image — sixty wasted calls on every cold job.
        expected = self.index.size(key) if self.index is not None else None
        if self.index is not None and expected is None:
            return False
        if not self.remote.get(key, path):
            return False
        # A key addresses its *inputs*, not its bytes, so nothing else would
        # notice a short download: the next attempt would trust a truncated
        # PNG exactly as Phase 2's half-written files were trusted (PLAN.md
        # 10.2). The size recorded at upload is the check.
        if expected is not None and path.stat().st_size != expected:
            got = path.stat().st_size
            path.unlink(missing_ok=True)
            raise RuntimeError(f"{key}: fetched {got} bytes, the store recorded {expected}")
        self.fetched += 1
        return True

    def publish(self, path: Path, kind: str) -> str:
        """Upload `path` (if the store lacks it) and record it. -> its key."""
        key = self.key(path)
        if not self.enabled:
            return key
        if self.index is not None and self.index.known(key):
            return key
        delay = self.PUT_BACKOFF
        for attempt in range(1, self.PUT_TRIES + 1):
            try:
                self.remote.put(key, path)
                break
            except Exception as exc:
                if attempt == self.PUT_TRIES:
                    raise
                self.put_retries += 1
                self.log(f"  upload of {key} failed ({type(exc).__name__}: {exc}); "
                         f"retrying in {delay:.0f}s ({attempt}/{self.PUT_TRIES - 1})")
                time.sleep(delay)
                delay *= 2
        self.published += 1
        if self.index is not None:
            self.index.record(key, size=path.stat().st_size, kind=kind)
        return key

    def publish_many(self, paths: list[Path], kind: str) -> list[str]:
        """`publish` for a batch, asking the index once rather than per file.
        An edit publishes a film's 50 chunks of which two are new; from the
        Mac to Neon each lookup is a ~100 ms round trip."""
        keys = [self.key(p) for p in paths]
        if not self.enabled:
            return keys
        known = self.index.known_many(keys) if self.index is not None and hasattr(self.index, "known_many") \
            else set()
        todo = [path for path, key in zip(paths, keys) if key not in known]
        # In parallel: one upload does not fill this Mac's uplink (1.7 MB/s
        # measured over many), and an edit waits on these before it commits.
        with ThreadPoolExecutor(min(UPLOAD_JOBS, max(1, len(todo)))) as ex:
            list(ex.map(lambda path: self.publish(path, kind), todo))
        return keys

    def publish_film(self, video: Path) -> str:
        """Films are keyed by their bytes, so a re-render that changed nothing
        is the same key and a changed one can never overwrite the old."""
        dest = self.cache / "films" / f"{file_sha(video)}.mp4"
        if not dest.exists():
            dest.parent.mkdir(parents=True, exist_ok=True)
            # A hard link where the filesystem allows it: films are large.
            try:
                os.link(video, dest)
            except OSError:
                _atomic_copy(video, dest)
        return self.publish(dest, "film")


def _atomic_copy(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = config.partial(dest)
    shutil.copyfile(src, tmp)
    os.replace(tmp, dest)
