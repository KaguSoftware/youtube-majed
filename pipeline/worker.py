"""The worker: a long-lived process that pulls production jobs from Postgres.

    python -m pipeline.worker                 # poll forever
    python -m pipeline.worker --exit-when-idle

Two rules from PLAN.md section 2 shape all of it:

1. **The worker pulls.** It is a client behind NAT; nothing ever calls in.
2. **The worker holds no state.** Its job's inputs come from the database, its
   outputs are content-addressed files plus fenced rows, and its progress is a
   checkpoint on the job. Kill it at any instant and the next worker to claim
   the job — this one restarted, or another machine — resumes it.

### What survives a kill, and why

A SIGKILL mid-shot loses at most that one shot. Every finished image is a
complete file under its content hash (writes are atomic, see
`config.partial`), so the resumed attempt re-runs the job from the top and
every finished stage and shot is a cache hit. That is the Phase 2 exit
criterion, and it holds without the resumed attempt trusting anything the dead
one wrote to the database.

### Leases

The claim holds a lease, extended every `--heartbeat` seconds by a background
thread. If the process dies, the lease runs out and any worker may reclaim the
job. A restarted worker on the *same host* does not wait for that: the host
lock below guarantees the previous holder of this worker id is dead, so its
first poll reclaims its own orphan immediately.

The heartbeat thread exists because the main thread spends 15-20 seconds at a
time inside one image generation and much longer inside a model load. A
heartbeat sent only between shots would put the lease at the mercy of the
slowest single step.

### Lanes

`--kinds` picks which job kinds this process claims. The default GPU lane runs
`production` and `style` and keeps klein warm; a second process with
`--kinds research,script` runs `claude -p`, which needs no GPU and should not
wait behind a twenty-minute render. One process per lane, each on its own work
root, so the host lock still guarantees one image generation at a time.

### The doorbell: idle without waking the database

Polling Postgres every few seconds keeps a serverless database awake around
the clock. On Neon's free tier that is ~180 compute-hours a month against an
allowance of 100, after which the database is suspended until the next month.

So with `DOORBELL_URL` set, an idle worker polls a Vercel route instead. The
route answers from Vercel's runtime cache and never touches the database; the
web app changes the value whenever it enqueues a job. The worker reads
Postgres only when the value changes, after finishing a job, when a retry's
backoff or a dead worker's lease comes due (`Store.next_due`), and otherwise
every `IDLE_DB_SECONDS` as a safety net. If the cache evicts the value, the
route writes a fresh one, which reads as a ring: a lost ring costs one
database poll, never a missed job.

Without `DOORBELL_URL` the worker polls Postgres every `--poll` seconds, as in
Phase 2. Local development and the queue test run that way.

### Shutdown

SIGTERM or Ctrl-C asks for a graceful stop: the current shot finishes, the job
goes back to the queue without spending an attempt, and the process exits. A
second signal exits immediately, which is safe for the same reason SIGKILL is.
"""

from __future__ import annotations

import argparse
import fcntl
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import traceback
from pathlib import Path

import json
import urllib.request
from datetime import datetime, timezone

import psycopg

from . import assemble, config, docs, editor, images, media, pins, production, smoke, writer
from .timeline import Timeline, text_sha
from .store import (GPU_KINDS, LIGHT_KINDS, Claim, FilmMoved, LeaseLost, MediaIndex, Store,
                    database_url)

#: How long a claim survives without a heartbeat. Long enough to ride out a
#: model load and a slow image; short enough that a dead worker's job is picked
#: up within a couple of minutes by anyone else.
LEASE_SECONDS = 90.0
HEARTBEAT_SECONDS = 15.0
POLL_SECONDS = 5.0

#: Failure mode 8: refuse to start a job on a nearly full disk rather than
#: failing opaquely halfway through. A 60-shot job writes well under 1 GB.
#: Checked before every GPU job (they all write media); `MIN_FREE_GB` in the
#: environment overrides it, which is how the queue test makes a disk "full".
MIN_FREE_BYTES = int(float(os.environ.get("MIN_FREE_GB", 2)) * 1024**3)

#: Failure mode 7. macOS counts every page it writes to swap; on unified memory
#: this is the honest pressure signal (HANDOFF section 6: neither MLX's
#: counter nor RSS sees it). A normal job adds none. 8.8's fatal 1216x704 run
#: wrote ~28 GB, ~1.7 million 16 KB pages. Past this a job's "done" event and
#: log say so: 50,000 pages is ~0.8 GB.
SWAPOUT_WARN = 50_000

#: Backoff before an unexpected failure is retried: attempt n waits n times this.
RETRY_DELAY_SECONDS = 30.0

#: Doorbell cadence. 15s keeps two lanes at ~350k function invocations a month,
#: about a third of Vercel Hobby's allowance, for at most 15s of pickup delay.
DOORBELL_SECONDS = 15.0
#: Doorbell cadence while the editing page is open (the bell says "hot"). The
#: Phase 4 exit is a corrected film within 60 s of asking, and a 15 s pickup
#: would spend a quarter of it. An hour of editing costs ~1,800 invocations.
HOT_DOORBELL_SECONDS = 2.0
#: The safety-net poll while the bell is quiet. Each one wakes Neon for about
#: five minutes, so four a day cost ~2.5 of the free tier's 100 CU-hours a month.
IDLE_DB_SECONDS = 6 * 3600.0
#: When the doorbell itself is unreachable, fall back to polling Postgres at
#: this pace rather than every few seconds.
DOORBELL_DOWN_DB_SECONDS = 300.0


class Stopping(Exception):
    """A graceful shutdown was requested; release the job."""


class Transient(RuntimeError):
    """A failure that may not repeat (disk full, network). Retry later."""


class Heartbeat(threading.Thread):
    """Extends the lease on its own connection until stopped or the lease is lost."""

    def __init__(self, claim: Claim, *, url: str, lease: float, every: float,
                 hostname: str, log, kinds: tuple[str, ...] = GPU_KINDS) -> None:
        super().__init__(name=f"heartbeat-{claim.job_id}", daemon=True)
        self.claim, self.url, self.lease, self.every = claim, url, lease, every
        self.kinds = kinds
        self.hostname, self.log = hostname, log
        self.lost: str | None = None
        self._halt = threading.Event()

    def run(self) -> None:
        store = None
        while not self._halt.wait(self.every):
            try:
                store = store or Store(self.url)
                store.heartbeat(self.claim, self.lease)
                store.touch_worker(self.claim.worker, hostname=self.hostname,
                                   pid=os.getpid(), current_job=self.claim.job_id,
                                   kinds=self.kinds)
            except LeaseLost as exc:
                self.lost = str(exc)
                self.log(f"  heartbeat: {exc}")
                break
            except Exception as exc:
                # A dropped connection is not a lost lease. Keep trying; if the
                # outage outlasts the lease, the token check on the next
                # successful write is what tells us.
                self.log(f"  heartbeat failed ({type(exc).__name__}: {exc}); retrying")
                if store is not None:
                    try:
                        store.close()
                    except Exception:
                        pass
                store = None
        if store is not None:
            store.close()

    def stop(self) -> None:
        self._halt.set()


class JobHooks(production.Hooks):
    """Turns production progress into fenced checkpoints and job events."""

    def __init__(self, worker: "Worker", claim: Claim, heartbeat: Heartbeat) -> None:
        self.worker, self.claim, self.heartbeat = worker, claim, heartbeat
        self.store = worker.store
        self.current = "claimed"
        self.images: dict[str, dict] = {}
        self._generated = 0
        self._cached = 0

    def check(self) -> None:
        """Called at every boundary: stop here if the job is no longer ours to run."""
        if self.heartbeat.lost:
            raise LeaseLost(self.heartbeat.lost)
        if self.worker.stopping:
            raise Stopping()

    def stage(self, name: str) -> None:
        self.check()
        self.current = name
        self.store.progress(self.claim, {"stage": name})
        self.store.event(self.claim, "stage", {"stage": name})

    def done(self, key: str, value: dict) -> None:
        self.store.checkpoint(self.claim, key, value)
        self.check()

    def shot(self, shot, stats, done: int, total: int) -> None:
        generated = stats.generated - self._generated
        cached = stats.cached - self._cached
        self._generated, self._cached = stats.generated, stats.cached
        source = "generated" if generated else "cached"
        image = shot.image
        self.images[shot.shot_id] = {
            "hash": image.hash, "seed": image.seed, "attempts": image.attempts,
            "qa_ok": bool(image.qa.get("ok")), "source": source,
        }
        self.store.checkpoint(
            self.claim, "images", self.images,
            progress={"stage": "images", "done": done, "total": total,
                      "generated": stats.generated, "cached": stats.cached},
        )
        self.store.event(self.claim, "shot", {
            "shot": shot.shot_id, "source": source, "generated": generated, "cached": cached,
            "attempts": image.attempts, "hash": image.hash,
            "seconds": round(sum(stats.times[-generated:]), 2) if generated else 0.0,
        })
        self.check()


class Doorbell:
    """The idle worker's view of the queue, without the database. See the
    module docstring. `check()` returns the bell's current value."""

    def __init__(self, url: str, token: str, *, worker_id: str, kinds: tuple[str, ...],
                 timeout: float = 10.0) -> None:
        self.url, self.token, self.timeout = url, token, timeout
        self.worker_id, self.kinds = worker_id, kinds

    def check(self) -> str:
        req = urllib.request.Request(self.url, headers={
            "Authorization": f"Bearer {self.token}",
            "X-Worker-Id": self.worker_id,
            "X-Worker-Kinds": ",".join(self.kinds),
        })
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            body = json.loads(r.read())
        # Someone has the editing page open: an edit should start within a
        # couple of seconds, not up to fifteen (PLAN.md 12.4).
        self.hot = bool(body.get("hot"))
        return str(body["ring"])

    hot = False


class Worker:
    def __init__(self, *, url: str, work_root: Path, worker_id: str, engines: production.Engines,
                 lease: float = LEASE_SECONDS, heartbeat: float = HEARTBEAT_SECONDS,
                 poll: float = POLL_SECONDS, fake: bool = False, log=print,
                 kinds: tuple[str, ...] = GPU_KINDS, remote: media.Remote | None = None,
                 doorbell: Doorbell | None = None, doorbell_every: float = DOORBELL_SECONDS,
                 idle_db: float = IDLE_DB_SECONDS, smoke_every: float | None = None) -> None:
        self.url = url
        self.store = Store(url)
        self.work_root = work_root
        self.worker_id = worker_id
        self.hostname = machine_name()
        self.engines = engines
        self.lease, self.heartbeat_every, self.poll = lease, heartbeat, poll
        self.fake = fake
        self.log = log
        self.kinds = kinds
        self.remote = remote or media.NoRemote()
        self.doorbell = doorbell
        self.doorbell_every, self.idle_db = doorbell_every, idle_db
        self.stopping = False
        self._lock_fd: int | None = None
        #: What this worker last found wrong with itself (migration 006). The
        #: studio shows it; `unfit` decides from it what not to claim.
        self.health: dict = {"pins": None, "smoke": None}
        #: Seconds between smoke tests while idle; None runs none (the light
        #: lane, fake workers unless asked, `--once`).
        self.smoke_every = smoke_every if set(kinds) & set(GPU_KINDS) else None
        self.smoke_root = work_root / "smoke"

    # ---------------------------------------------------------------- setup

    def acquire_host_lock(self) -> None:
        """One worker per work root, which in practice means one per machine.

        Two workers on one Mac would run two image generations at once, and
        unified memory turns that into swap (PLAN.md section 4: concurrency
        one on the GPU step). The lock also makes orphan reclaim safe — if we
        hold it, no other live process is running under our id.
        """
        self.work_root.mkdir(parents=True, exist_ok=True)
        fd = os.open(self.work_root / ".worker.lock", os.O_RDWR | os.O_CREAT, 0o644)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(fd)
            raise SystemExit(f"another worker already holds {self.work_root}/.worker.lock")
        os.ftruncate(fd, 0)
        os.write(fd, f"{os.getpid()}\n".encode())
        self._lock_fd = fd

    def sweep_partials(self) -> None:
        """Delete half-written files left by a killed predecessor.

        Harmless if left — nothing reads a `.partial` name — but they are
        exactly the files a kill produces, so they would accumulate.
        """
        n = 0
        for p in self.work_root.rglob(".*.partial.*"):
            p.unlink(missing_ok=True)
            n += 1
        if n:
            self.log(f"  removed {n} partial file(s) left by an interrupted run")

    def check_pins(self) -> None:
        """Failure modes 10 and 13: run only what was tested, on the weights
        whose licence was reviewed. The GPU lane checks the model files too
        (by size and blob name; the smoke test re-hashes them)."""
        report = pins.check(models=bool(set(self.kinds) & set(GPU_KINDS)) and not self.fake)
        self.health["pins"] = {"problems": report.problems, "notes": report.notes}
        for n in report.notes:
            self.log(f"  pins: {n}")
        for p in report.problems:
            self.log(f"  pins: FAIL {p}")
        if report.problems:
            self.log("  this worker will claim nothing until its install matches the pins "
                     "(deploy/install-worker.sh, or `python -m pipeline.pins fetch`)")

    @property
    def unfit(self) -> tuple[str, ...]:
        """The job kinds this worker must not claim, given its health. Drift
        in the pins blocks everything; a failed smoke test blocks GPU work."""
        if (self.health.get("pins") or {}).get("problems"):
            return self.kinds
        if (self.health.get("smoke") or {}).get("failures"):
            return tuple(k for k in self.kinds if k in GPU_KINDS)
        return ()

    def maybe_smoke(self) -> None:
        """The nightly smoke test (pipeline/smoke.py), run while idle on the
        warm engines, so it costs a minute of GPU rather than a model load.

        Due a day after the last pass, or an hour after a failure. Run only
        right after a database poll found nothing to do, so a queued job is
        never what it delays, and the result is written to the worker's row
        while the database is awake anyway."""
        if self.smoke_every is None:
            return
        last = (smoke.Report.from_json(self.health["smoke"]) if self.health.get("smoke")
                else smoke.read_last(self.smoke_root))
        if not smoke.due(last, every=self.smoke_every, retry=min(self.smoke_every, smoke.RETRY_SECONDS)):
            if last is not None and self.health.get("smoke") is None:
                self.health["smoke"] = last.to_json()
            return
        self.log("smoke test: the production stage on a 20 s fixture, from an empty cache")
        halt = threading.Event()
        if self.doorbell:
            # The studio reads an idle worker's presence from its doorbell
            # polls (60 s window); keep making them while the GPU is busy.
            def ring_on() -> None:
                while not halt.wait(self.doorbell_every):
                    try:
                        self.doorbell.check()
                    except Exception:
                        pass
            threading.Thread(target=ring_on, daemon=True, name="smoke-doorbell").start()
        try:
            report, _ = smoke.run(self.engines, self.smoke_root, fake=self.fake,
                                  log=lambda m: self.log(m))
        finally:
            halt.set()
        self.health["smoke"] = report.to_json()
        for line in report.render().splitlines():
            self.log(f"  {line.strip()}")
        if report.failures:
            self.log("  GPU work waits until a smoke test passes (retried hourly)")
        self._quietly(lambda: self.store.touch_worker(
            self.worker_id, hostname=self.hostname, pid=os.getpid(), current_job=None,
            kinds=self.kinds, health=self.health))

    def install_signals(self) -> None:
        def handler(signum, _frame):
            if self.stopping:
                self.log("\nsecond signal: exiting now (the job will be reclaimed)")
                os._exit(130)
            self.stopping = True
            self.log(f"\n{signal.Signals(signum).name}: finishing the current shot, "
                     "then releasing the job (signal again to exit now)")

        signal.signal(signal.SIGTERM, handler)
        signal.signal(signal.SIGINT, handler)

    # ----------------------------------------------------------------- loop

    def run(self, *, once: bool = False, exit_when_idle: bool = False) -> int:
        self.acquire_host_lock()
        self.install_signals()
        self.sweep_partials()
        self.check_pins()
        self.log(f"worker {self.worker_id} (pid {os.getpid()}) on {self.work_root}, "
                 f"kinds {','.join(self.kinds)}, media {self.remote.name}, "
                 f"lease {self.lease:.0f}s, heartbeat {self.heartbeat_every:.0f}s, "
                 + (f"doorbell every {self.doorbell_every:.0f}s" if self.doorbell
                    else f"polling the database every {self.poll:.0f}s"))

        first = True
        next_db = 0.0                    # monotonic time of the next database poll
        bell: str | None = None
        bell_failures = 0
        if self.doorbell:
            # The baseline is read *before* the first database poll, so a job
            # enqueued between the two still changes the bell. Read after, it
            # would become the baseline and wait for the safety-net poll.
            try:
                bell = self.doorbell.check()
            except Exception:
                pass
        while not self.stopping:
            if self.doorbell and time.monotonic() < next_db:
                try:
                    rung = self.doorbell.check()
                    bell_failures = 0
                    if rung != bell:
                        if bell is not None:
                            self.log(f"doorbell: {rung}")
                        bell, next_db = rung, 0.0
                except Exception as exc:
                    bell_failures += 1
                    if bell_failures in (1, 10) or bell_failures % 100 == 0:
                        self.log(f"doorbell unreachable ({type(exc).__name__}: {exc}); "
                                 f"polling the database every {DOORBELL_DOWN_DB_SECONDS:.0f}s")
                    next_db = min(next_db, time.monotonic() + DOORBELL_DOWN_DB_SECONDS)
                if time.monotonic() < next_db:
                    self._sleep(HOT_DOORBELL_SECONDS if self.doorbell.hot else self.doorbell_every)
                    continue

            try:
                claim = self._poll(reclaim_own=first)
            except psycopg.OperationalError as exc:
                # Neon drops idle connections when it scales to zero. One
                # reconnect is routine; failing again means it is really down.
                self.log(f"database connection lost ({str(exc).strip()[:120]}); reconnecting")
                try:
                    self.store.reconnect()
                    claim = self._poll(reclaim_own=first)
                except psycopg.OperationalError as exc2:
                    self.log(f"database unreachable: {str(exc2).strip()[:160]}")
                    self._sleep(max(self.poll, 30.0))
                    continue
            first = False
            if claim is None:
                if once or exit_when_idle:
                    self.log("queue empty")
                    return 0
                self.maybe_smoke()
                if self.doorbell:
                    next_db = self._next_db_poll()
                else:
                    self._sleep(self.poll)
                continue
            self.execute(claim)
            next_db = 0.0                # finished a job: look for the next one now
            if once:
                return 0
        self.log("stopped")
        return 0

    def _poll(self, *, reclaim_own: bool) -> Claim | None:
        self.store.touch_worker(self.worker_id, hostname=self.hostname, pid=os.getpid(),
                                current_job=None, kinds=self.kinds, health=self.health)
        kinds = tuple(k for k in self.kinds if k not in self.unfit)
        if not kinds:
            return None
        return self.store.claim(self.worker_id, self.lease, reclaim_own=reclaim_own,
                                fake=self.fake, kinds=kinds)

    def _next_db_poll(self) -> float:
        """The safety-net poll, brought forward to whenever the queue next
        changes on its own (a retry's backoff, an expiring lease)."""
        wait = self.idle_db
        due = self.store.next_due(fake=self.fake, kinds=self.kinds)
        if due is not None:
            wait = min(wait, max(1.0, (due - datetime.now(timezone.utc)).total_seconds() + 1.0))
        return time.monotonic() + wait

    def _sleep(self, seconds: float) -> None:
        end = time.monotonic() + seconds
        while not self.stopping and time.monotonic() < end:
            time.sleep(min(0.25, end - time.monotonic()))

    def execute(self, claim: Claim) -> None:
        resumed = sorted(claim.checkpoint)
        n_images = len(claim.checkpoint.get("images", {}))
        self.log(f"\n>> job {claim.job_id} ({claim.kind}, {claim.project_id}) "
                 f"attempt {claim.attempts}/{claim.max_attempts}"
                 + (f", resuming: {n_images} shot(s) checkpointed, the rest of the "
                    "work is checked against the cache" if resumed else ""))
        hb = Heartbeat(claim, url=self.url, lease=self.lease, every=self.heartbeat_every,
                       hostname=self.hostname, log=self.log, kinds=self.kinds)
        hb.start()
        self.store.touch_worker(self.worker_id, hostname=self.hostname, pid=os.getpid(),
                                current_job=claim.job_id, kinds=self.kinds)
        self.store.event(claim, "claimed", {
            "attempt": claim.attempts, "pid": os.getpid(),
            "checkpoint_keys": resumed,
            "images_checkpointed": len(claim.checkpoint.get("images", {})),
        })
        hooks = JobHooks(self, claim, hb)
        t0 = time.time()
        swap0 = swapouts()
        try:
            if claim.kind not in LIGHT_KINDS:
                free = shutil.disk_usage(self.work_root).free
                if free < MIN_FREE_BYTES:
                    raise Transient(f"only {free / 1024**3:.1f} GB free under {self.work_root} "
                                    f"(needs {MIN_FREE_BYTES / 1024**3:.0f} GB)")
            if claim.kind in LIGHT_KINDS:
                row = self.write_document(claim, hooks)
                self._done(claim, swap0, {
                    "artifact_id": row["id"], "version": row["version"],
                    "doc_status": row["doc_status"], "seconds": round(time.time() - t0, 1),
                })
                self.log(f"<< job {claim.job_id} done in {time.time() - t0:.1f}s: "
                         f"{claim.kind}.md v{row['version']} ({row['doc_status']})")
                return
            if claim.kind == "style":
                row = self.paint_looks(claim, hooks)
                self._done(claim, swap0, {
                    "style_run": row["id"], "candidates": len(row["candidates_json"]),
                    "seconds": round(time.time() - t0, 1)})
                self.log(f"<< job {claim.job_id} done in {time.time() - t0:.1f}s: "
                         f"{len(row['candidates_json'])} candidate looks")
                return
            if claim.kind == "edit":
                out = self.edit_film(claim, hooks)
                self._done(claim, swap0, {**out, "seconds": round(time.time() - t0, 1)})
                self.log(f"<< job {claim.job_id} done in {time.time() - t0:.1f}s: "
                         + (f"timeline v{out['version']}" if out.get("version") else "no change"))
                return
            if claim.kind == "export":
                out = self.export_film(claim, hooks)
                self._done(claim, swap0, {**out, "seconds": round(time.time() - t0, 1)})
                self.log(f"<< job {claim.job_id} done in {time.time() - t0:.1f}s: {out['film']}")
                return
            if claim.kind != "production":
                raise production.Gate("kind", [f"no handler for {claim.kind!r} jobs in this worker yet"])
            mirror = media.Mirror(
                self.work_root / "cache", self.remote,
                MediaIndex(self.store, self.remote.name, project_id=claim.project_id,
                           job_id=claim.job_id),
                log=self.log)
            paths = config.Paths(root=self.work_root, project=claim.project_id, mirror=mirror)
            inputs = self.load_inputs(claim, mirror)
            result = production.run(inputs, paths, engines=self.engines, hooks=hooks,
                                    log=self.log)
            hooks.check()
            version = self.store.complete(claim, result.timeline.to_json())
            self._done(claim, swap0, {
                "timeline_version": version, "seconds": round(time.time() - t0, 1),
                "generated": result.stats.generated if result.stats else 0,
                "cached": result.stats.cached if result.stats else 0,
                "video": str(result.video) if result.video else None,
                "film": result.timeline.media.get("film"),
                "fetched": mirror.fetched, "published": mirror.published,
            })
            self.log(f"<< job {claim.job_id} done in {time.time() - t0:.1f}s, "
                     f"timeline v{version}")
        except LeaseLost as exc:
            # Write nothing: whoever holds the job now owns its rows.
            self.log(f"<< job {claim.job_id}: lease lost, abandoning ({exc})")
        except Stopping:
            self._quietly(lambda: self.store.release(claim))
            self._quietly(lambda: self.store.event(claim, "released", {"stage": hooks.current}))
            self.log(f"<< job {claim.job_id} released at {hooks.current}")
        except FilmMoved as exc:
            # Not retryable: the edit was made on a version that is no longer
            # the film. The user asks again on the film as it is now.
            message = f"edit: {exc}"
            self._quietly(lambda: self.store.fail(claim, message))
            self._quietly(lambda: self.store.event(
                claim, "failed", {"stage": "commit", "errors": [message], "retry": False}))
            self.log(f"<< job {claim.job_id} failed (not retryable): {exc}")
        except writer.WriterGate as gate:
            # Claude declined (usage limit, sign-in): a retry would repeat it.
            # The studio offers paste mode instead (failure mode 12).
            self._quietly(lambda: self.store.fail(claim, str(gate)))
            self._quietly(lambda: self.store.event(
                claim, "failed", {"stage": "writing", "errors": [str(gate)], "retry": False}))
            self.log(f"<< job {claim.job_id} failed (not retryable): {gate}")
        except production.Gate as gate:
            self._quietly(lambda: self.store.fail(claim, str(gate)))
            self._quietly(lambda: self.store.event(
                claim, "failed", {"stage": gate.stage, "errors": gate.errors, "retry": False}))
            self.log(f"<< job {claim.job_id} failed at {gate.stage} (not retryable):")
            for e in gate.errors:
                self.log(f"     {e}")
        except Exception as exc:
            tb = traceback.format_exc()
            self.log(tb)
            message = f"{hooks.current}: {type(exc).__name__}: {exc}"
            requeued = self._quietly(lambda: self.store.retry_later(
                claim, message, RETRY_DELAY_SECONDS * claim.attempts))
            self._quietly(lambda: self.store.event(
                claim, "error", {"stage": hooks.current, "error": message,
                                 "traceback": tb[-4000:], "requeued": bool(requeued)}))
            self.log(f"<< job {claim.job_id} errored at {hooks.current}; "
                     + ("requeued" if requeued else "failed, attempts exhausted"))
        finally:
            hb.stop()
            self._quietly(lambda: self.store.touch_worker(
                self.worker_id, hostname=self.hostname, pid=os.getpid(), current_job=None,
                kinds=self.kinds))

    def _done(self, claim: Claim, swap0: int | None, payload: dict) -> None:
        """The job's "done" event, with the pages it pushed to swap."""
        now = swapouts()
        if swap0 is not None and now is not None:
            payload["swapouts"] = now - swap0
            if now - swap0 > SWAPOUT_WARN:
                self.log(f"  warn   {now - swap0:,} pages swapped out during this job: memory "
                         "pressure (PLAN.md 8.8); is something else using the GPU?")
        self.store.event(claim, "done", payload)

    def _quietly(self, fn):
        try:
            return fn()
        except LeaseLost as exc:
            self.log(f"  {exc}")
        except Exception as exc:
            self.log(f"  could not record outcome: {type(exc).__name__}: {exc}")
        return None

    def paint_looks(self, claim: Claim, hooks: JobHooks) -> dict:
        """A style job: the hero beat painted on several seeds, no reference.

        The subject is held constant so the candidates differ only in look
        (DESIGN.md, "Stage: style"). No reference image yet: the chosen frame
        is what becomes the reference, after the user crops it to the
        character.
        """
        p = claim.payload
        mirror = media.Mirror(
            self.work_root / "cache", self.remote,
            MediaIndex(self.store, self.remote.name, project_id=claim.project_id, job_id=claim.job_id),
            log=self.log)
        paths = config.Paths(root=self.work_root, project=claim.project_id, mirror=mirror)
        prompt = config.Style(
            style_id="candidate", preset=p.get("preset", ""), prompt_prefix=p["prompt_prefix"], seed=0,
            hero_full=Path(), hero_crop=Path(), crop_box=(0, 0, 1, 1),
        ).prompt_for(p["visual"], p["mood"], period=p.get("period"),
                     protagonist=(p.get("protagonist") or "", p.get("protagonist_look") or ""))
        gen = self.engines.generator
        candidates = []
        hooks.stage("images")
        for i, seed in enumerate(p["seeds"]):
            from .timeline import image_hash

            h = image_hash(prompt, int(seed), [], model=gen.model_name)
            dest = paths.images / f"{h}.png"
            source = "cached"
            if not mirror.ensure(dest):
                if not gen.loaded:
                    gen.load(log=self.log)
                elapsed = gen.generate(prompt, int(seed), [], dest)
                source = f"{elapsed:.1f}s"
            key = mirror.publish(dest, "image")
            candidates.append({"seed": int(seed), "key": key, "hash": h})
            self.store.progress(claim, {"stage": "images", "done": i + 1, "total": len(p["seeds"])})
            self.store.event(claim, "candidate", {"seed": int(seed), "key": key, "source": source})
            self.log(f"  look {i + 1}/{len(p['seeds'])} seed {seed}: {source}")
            hooks.check()
        return self.store.finish_style(claim, candidates=candidates, preset_id=p.get("preset_id"),
                                       beat_id=p["beat_id"], prompt_prefix=p["prompt_prefix"])

    def write_document(self, claim: Claim, hooks: JobHooks) -> dict:
        """A research or script job: Claude writes, docs.check judges, and the
        document, its prompt_log row and the job's completion commit together."""
        kind, p = claim.kind, claim.payload
        project = self.store.project(claim.project_id)
        if project is None:
            raise production.Gate("inputs", [f"no project {claim.project_id}"])
        research_md = None
        if kind == "research":
            # DESIGN.md "Staleness": research.md <- hash(topic, angle).
            upstream = text_sha(f"{project['topic']}\n{project.get('angle') or ''}")
        else:
            research = self.store.artifact(p["research_id"]) if p.get("research_id") else None
            latest = self.store.latest_approved(claim.project_id, "research")
            if research is None or research["doc_status"] != "approved":
                raise writer.WriterGate("there is no approved research to write the script from")
            if latest and latest["id"] != research["id"]:
                raise production.Gate("inputs", [
                    f"research.md v{research['version']} was superseded by v{latest['version']} "
                    "after this script was requested; ask again"])
            research_md, upstream = research["markdown_raw"], research["content_sha"]

        hooks.stage("writing")
        written = writer.write(kind, project, research_md=research_md, note=p.get("note"),
                               narrative_id=p.get("narrative"), should_stop=hooks.check, log=self.log)
        hooks.stage("checking")
        verdict = docs.check(kind, written.markdown, research_markdown=research_md,
                             verify_sources=bool(p.get("verify_sources", True)))
        hooks.check()
        return self.store.finish_document(
            claim, kind=kind, markdown=written.markdown, verdict=verdict, upstream_hash=upstream,
            prompt=f"[system]\n{written.system}\n\n[user]\n{written.prompt}",
            response_raw=written.response_raw, meta=written.meta,
        )

    # ------------------------------------------------------------- editing

    def _film(self, claim: Claim, version: int) -> tuple[Timeline, media.Mirror, config.Paths, Path]:
        """A committed version and everything needed to change or export it:
        the paths, the mirror, and the narration it was cut to."""
        row = self.store.timeline(claim.project_id, version)
        if row is None:
            raise production.Gate("inputs", [f"{claim.project_id} has no version {version}"])
        timeline = Timeline.from_json(row["timeline_json"])
        mirror = media.Mirror(
            self.work_root / "cache", self.remote,
            MediaIndex(self.store, self.remote.name, project_id=claim.project_id, job_id=claim.job_id),
            log=self.log)
        paths = config.Paths(root=self.work_root, project=claim.project_id, mirror=mirror)
        wav = mirror.path(timeline.audio["key"]) if timeline.audio.get("key") else paths.audio
        if not (mirror.ensure(wav) if timeline.audio.get("key") else wav.exists()):
            raise production.Gate("inputs", [
                f"the narration this film was cut to is not available ({wav.name}); render it again"])
        return timeline, mirror, paths, wav

    def _edit_context(self, claim: Claim, timeline: Timeline) -> dict:
        """The film-wide words every prompt was built from. Recorded on the
        timeline since Phase 4; for an older film, read from its script."""
        st = timeline.style
        period, protagonist = st.get("period"), st.get("protagonist")
        if period is None and protagonist is None:
            script = self.store.latest_approved(claim.project_id, "script")
            if script:
                parsed = docs.parse_script_text(script["markdown_raw"])
                period, protagonist = parsed.meta.get("period"), list(docs.protagonist(parsed) or []) or None
        return {"prompt_prefix": st["prompt_prefix"], "period": period, "protagonist": protagonist}

    def edit_film(self, claim: Claim, hooks: JobHooks) -> dict:
        """An edit job: Claude changes a draft of the film's timeline, the
        warm model paints what changed, two chunks per change are re-cut,
        and the result is committed as the next version (pipeline/editor.py)."""
        p = claim.payload
        base = int(p["base_version"])
        timeline, mirror, paths, wav = self._film(claim, base)
        context = self._edit_context(claim, timeline)
        timings: dict[str, float] = {}

        hooks.stage("understanding")
        t = time.monotonic()
        result = editor.run_agent(
            timeline, p["request"], at=p.get("at"), context=context, work_root=self.work_root,
            should_stop=hooks.check, log=self.log,
            on_op=lambda op: self.store.event(claim, "tool", {
                "tool": op["tool"], "args": op["args"], "ok": op["ok"], "result": op["result"][:300]}))
        timings["understanding"] = round(time.monotonic() - t, 2)
        self._quietly(lambda: self.store.record_prompt(
            project_id=claim.project_id, kind="edit", prompt=result.prompt,
            response_raw=result.response_raw, job_id=claim.job_id, meta=result.meta))
        changed = editor.changes(result.ops)
        hooks.check()
        if not changed:
            self.store.finish_job(claim)
            return {"version": None, "summary": result.summary, "timings": timings}

        draft = result.draft
        errors, _ = draft.validate()
        if errors:
            raise production.Gate("edit", errors)
        pending = [s for s in draft.shots if s.repaint]
        if pending:
            hooks.stage("painting")
            style = self._film_style(claim, timeline, mirror)
            t = time.monotonic()
            done = 0

            def on_shot(shot, stats):
                nonlocal done
                done += 1
                hooks.shot(shot, stats, done, len(pending))

            images.repaint_shots(draft.shots, style, paths, generator=self.engines.generator,
                                 on_shot=on_shot, log=self.log)
            timings["painting"] = round(time.monotonic() - t, 2)

        hooks.stage("cutting")
        t = time.monotonic()
        rendered = assemble.build(draft, paths, audio=wav, mp4=False, log=self.log)
        timings["encoding"] = round(time.monotonic() - t, 2)
        production.publish_render(draft, rendered, paths, log=self.log)
        timings["cutting"] = round(time.monotonic() - t, 2)
        hooks.check()
        change = {
            "request": p["request"], "at": p.get("at"), "summary": result.summary,
            "ops": [{"tool": o["tool"], "args": o["args"], "result": o["result"]} for o in changed],
            "shots": sorted({s.shot_id for s in draft.shots if s.image and (
                s.image.hash not in {x.image.hash for x in timeline.shots if x.image})}),
            "chunks_encoded": len(rendered.encoded), "timings": timings,
            "agent": {"turns": result.meta.get("num_turns"), "model": result.meta.get("model")},
        }
        version = self.store.finish_edit(claim, draft.to_json(), parent=base, change=change,
                                         created_by=p.get("requested_by"))
        return {"version": version, "summary": result.summary, "timings": timings,
                "chunks_encoded": len(rendered.encoded)}

    def _film_style(self, claim: Claim, timeline: Timeline, mirror: media.Mirror) -> config.Style:
        """The style an edit paints with: the film's own, with its hero crop."""
        row = self.store.style(timeline.style["style_id"])
        if row is None:
            raise production.Gate("inputs", [f"the film's look {timeline.style['style_id']} is gone"])
        preset = row["preset_json"]
        if not preset.get("hero_crop"):
            preset = {**preset, "hero_crop": self.materialize_crop(row["id"], preset, mirror)}
        style = config.Style.from_record(row["id"], preset, resolve=lambda ref: resolve_ref(ref, mirror))
        if not style.hero_crop.exists():
            raise production.Gate("inputs", [f"the character reference {style.hero_crop.name} is missing"])
        return style

    def export_film(self, claim: Claim, hooks: JobHooks) -> dict:
        """An mp4 of one version, for download: the chunks by stream copy,
        so seconds of work and one upload."""
        version = int(claim.payload["version"])
        timeline, mirror, paths, wav = self._film(claim, version)
        hooks.stage("exporting")
        hls = timeline.media.get("hls")
        if hls:
            chunks = [mirror.path(c["key"]) for c in hls["chunks"]]
            for c in chunks:
                if not mirror.ensure(c):
                    raise production.Gate("inputs", [f"chunk {c.name} of version {version} is missing"])
        else:
            # A film from before chunks: cut them now (its stills are needed).
            rendered = assemble.build(timeline, paths, audio=wav, mp4=False, log=self.log)
            chunks = [path for _, path in rendered.chunks]
        dest = paths.run / f"v{version}.mp4"
        assemble.film(timeline, chunks, wav, dest, log=self.log)
        key = mirror.publish_film(dest)
        self.store.finish_export(claim, film_key=key, size=dest.stat().st_size)
        return {"film": key, "version": version, "bytes": dest.stat().st_size}

    def materialize_crop(self, style_id: str, preset: dict, mirror: media.Mirror) -> str:
        """First use of a project style: build its hero crop and record it."""
        src = resolve_ref(preset["hero_full"], mirror)
        if not src.exists():
            raise production.Gate("inputs", [f"the chosen look's frame {preset['hero_full']} is missing"])
        key = mirror.publish(crop_reference(src, preset["crop_box"], mirror.cache), "ref")
        self.store.set_style_crop(style_id, key)
        self.log(f"  hero crop {key} from {preset['hero_full']} at {preset['crop_box']}")
        return key

    def load_inputs(self, claim: Claim, mirror: media.Mirror) -> production.Inputs:
        """Rebuild the job's inputs from the exact artifact versions it was enqueued on."""
        p = claim.payload
        research_row = self.store.artifact(p["research_id"])
        script_row = self.store.artifact(p["script_id"])
        style_row = self.store.style(p["style_id"])
        project = self.store.project(claim.project_id)
        if not (research_row and script_row and style_row and project):
            raise production.Gate("inputs", [f"job payload references missing rows: {p}"])

        # DESIGN.md "Staleness": never silently use an artifact that has been
        # superseded. The job is pinned to the versions it was enqueued with;
        # if a newer one was approved since, this video would narrate a script
        # nobody is reviewing any more.
        stale = []
        for kind, row in (("research", research_row), ("script", script_row)):
            latest = self.store.latest_approved(claim.project_id, kind)
            if latest and latest["id"] != row["id"]:
                stale.append(f"{kind}.md v{row['version']} was superseded by "
                             f"v{latest['version']} after this job was enqueued")
        if stale:
            raise production.Gate("inputs", stale + ["enqueue a new production job"])

        preset = style_row["preset_json"]
        if not preset.get("hero_crop"):
            preset = {**preset, "hero_crop": self.materialize_crop(style_row["id"], preset, mirror)}
        size = p.get("render_size")
        return production.Inputs(
            project=claim.project_id,
            topic=project["topic"],
            research=docs.parse_research_text(research_row["markdown_raw"]),
            script=docs.parse_script_text(script_row["markdown_raw"]),
            style=config.Style.from_record(style_row["id"], preset,
                                           resolve=lambda ref: resolve_ref(ref, mirror)),
            target_shots=int(p.get("target_shots", config.TARGET_SHOTS)),
            allow_fixture_sources=bool(p.get("allow_fixture_sources", False)),
            force=bool(p.get("force", False)),
            max_wer=float(p.get("max_wer", config.MAX_WER)),
            render_size=tuple(size) if size else None,
        )


def crop_reference(src: Path, box, cache: Path) -> Path:
    """The hero frame cropped to the character: a pure function of the frame
    and the box, so the crop the user previewed is the crop shots condition on.
    Content-addressed under refs/."""
    from PIL import Image

    with Image.open(src) as im:
        w, h = im.size
        x0, y0, x1, y1 = (float(v) for v in box)
        crop = im.convert("RGB").crop((round(x0 * w), round(y0 * h), round(x1 * w), round(y1 * h)))
    tmp = cache / "refs" / ".crop.partial.png"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    crop.save(tmp, "PNG")
    from .timeline import file_sha

    dest = cache / "refs" / f"{file_sha(tmp)}.png"
    os.replace(tmp, dest)
    return dest


def resolve_ref(ref: str, mirror: media.Mirror) -> Path:
    """A style reference as a local file: a repo path (the Phase 1 library
    style), else a media key fetched through the mirror. A missing file is
    left for `production.validate` to report as a gate."""
    local = config.REPO / ref
    if local.exists():
        return local
    path = mirror.path(ref)
    mirror.ensure(path)
    return path


def swapouts() -> int | None:
    """Pages swapped out since boot (`vm_stat`), or None off macOS."""
    try:
        out = subprocess.run(["vm_stat"], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    return parse_swapouts(out)


def parse_swapouts(vm_stat: str) -> int | None:
    import re
    m = re.search(r"^Swapouts:\s+(\d+)", vm_stat, re.M)
    return int(m.group(1)) if m else None


def machine_name() -> str:
    """A name for this machine that does not change with the network.

    On macOS `gethostname()` follows DHCP and can come back as an IP address,
    and a worker id that changes across a restart turns instant orphan
    reclaim into a wait for the lease. LocalHostName is set once, by the user.
    """
    if sys.platform == "darwin" and shutil.which("scutil"):
        try:
            out = subprocess.run(["scutil", "--get", "LocalHostName"], capture_output=True,
                                 text=True, timeout=5)
            if out.returncode == 0 and out.stdout.strip():
                return out.stdout.strip()
        except Exception:
            pass
    return socket.gethostname()


def keep_awake() -> None:
    """`caffeinate -s` for as long as this process lives (PLAN.md 8.6).

    `-s` holds off system sleep only on AC power, which is the condition the
    worker should be running under anyway; `-w` ties it to our pid so it can
    never outlive the worker.
    """
    if sys.platform == "darwin" and shutil.which("caffeinate"):
        subprocess.Popen(["caffeinate", "-s", "-w", str(os.getpid())])


#: Where the worker's secrets live: DATABASE_URL, BLOB_READ_WRITE_TOKEN,
#: DOORBELL_URL, WORKER_TOKEN. Outside the repo, and not in the launchd plist,
#: so neither a commit nor a copied plist can carry them.
DEFAULT_ENV_FILE = Path.home() / ".config" / "youtube-majed" / "worker.env"


def load_env_file(path: Path) -> list[str]:
    """KEY=VALUE lines into os.environ, never overriding what is already set.
    -> the keys it set. Quotes around a value are stripped; # starts a comment."""
    loaded = []
    if not path.is_file():
        return loaded
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip().removeprefix("export ").strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value
            loaded.append(key)
    return loaded


def main(argv: list[str] | None = None) -> int:
    env_file = Path(os.environ.get("WORKER_ENV_FILE", DEFAULT_ENV_FILE))
    loaded = load_env_file(env_file)
    if loaded:
        print(f"loaded {', '.join(sorted(loaded))} from {env_file}", flush=True)
    ap = argparse.ArgumentParser(prog="python -m pipeline.worker", description=__doc__.split("\n")[0])
    ap.add_argument("--work-root", type=Path, default=None,
                    help="default $WORK_ROOT or ./work (./work/fake with --fake)")
    ap.add_argument("--worker-id", default=os.environ.get("WORKER_ID"),
                    help="default <hostname>:<work root>. Stable across restarts, so a "
                         "restarted worker reclaims its own orphaned job immediately; "
                         "unique per work root, which the host lock is taken on")
    ap.add_argument("--lease", type=float, default=LEASE_SECONDS)
    ap.add_argument("--heartbeat", type=float, default=HEARTBEAT_SECONDS)
    ap.add_argument("--poll", type=float, default=POLL_SECONDS,
                    help="database poll interval without a doorbell")
    ap.add_argument("--doorbell-every", type=float, default=DOORBELL_SECONDS)
    ap.add_argument("--idle-db", type=float, default=IDLE_DB_SECONDS,
                    help="safety-net database poll while the doorbell is quiet")
    ap.add_argument("--kinds", default=None,
                    help=f"job kinds to claim, comma-separated (default {','.join(GPU_KINDS)}; "
                         f"the light lane is {','.join(LIGHT_KINDS)})")
    ap.add_argument("--once", action="store_true", help="run at most one job, then exit")
    ap.add_argument("--exit-when-idle", action="store_true", help="exit when the queue is empty")
    ap.add_argument("--no-caffeinate", action="store_true")
    ap.add_argument("--fake", action="store_true",
                    help="weights-free engines (pipeline/fakes.py): exercises the queue, "
                         "checkpoints and render without loading a model")
    ap.add_argument("--fake-delay", type=float, default=0.0,
                    help="seconds per fake image, to give a kill test something to interrupt")
    ap.add_argument("--smoke-every", type=float, default=None,
                    help=f"seconds between smoke tests while idle (default {smoke.EVERY_SECONDS:.0f}; "
                         "none for --fake unless given)")
    ap.add_argument("--no-smoke", action="store_true", help="never run the smoke test")
    args = ap.parse_args(argv)

    if args.fake:
        from .fakes import fake_engines

        engines = fake_engines(image_delay=args.fake_delay)
    else:
        # Only the pinned snapshots, never a download of `main`: provisioning
        # is `python -m pipeline.pins fetch`, a deliberate step (pins.py). Set
        # before anything imports huggingface_hub, which reads it once.
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        engines = production.Engines(unload_images=False)
    if not args.no_caffeinate and not args.fake:
        keep_awake()

    store = Store()
    store.migrate()
    store.close()

    kinds = tuple(k.strip() for k in (args.kinds or ",".join(GPU_KINDS)).split(",") if k.strip())
    unknown = set(kinds) - set(GPU_KINDS) - set(LIGHT_KINDS)
    if unknown:
        ap.error(f"unknown job kinds: {', '.join(sorted(unknown))}")
    light = set(kinds) <= set(LIGHT_KINDS)
    # Each lane gets its own work root by default, because the host lock is
    # taken per root and two lanes on one machine must both be able to start.
    root = (args.work_root or Path(os.environ.get("WORK_ROOT", "work"))
            / ("fake" if args.fake and not args.work_root else "")
            / ("light" if light and not args.work_root else "")).resolve()
    worker_id = args.worker_id or f"{machine_name()}:{root}"
    doorbell = None
    if os.environ.get("DOORBELL_URL"):
        if not os.environ.get("WORKER_TOKEN"):
            ap.error("DOORBELL_URL is set but WORKER_TOKEN is not")
        doorbell = Doorbell(os.environ["DOORBELL_URL"], os.environ["WORKER_TOKEN"],
                            worker_id=worker_id, kinds=kinds)
    worker = Worker(
        url=database_url(), work_root=root, worker_id=worker_id, engines=engines,
        lease=args.lease, heartbeat=args.heartbeat, poll=args.poll, fake=args.fake,
        log=lambda *a: print(*a, flush=True), kinds=kinds, remote=media.remote_from_env(),
        doorbell=doorbell, doorbell_every=args.doorbell_every, idle_db=args.idle_db,
        smoke_every=None if args.no_smoke else (
            args.smoke_every if args.smoke_every is not None
            else (None if args.fake else smoke.EVERY_SECONDS)),
    )
    return worker.run(once=args.once, exit_when_idle=args.exit_when_idle)


if __name__ == "__main__":
    sys.exit(main())
