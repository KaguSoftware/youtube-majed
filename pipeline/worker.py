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

from . import config, docs, production
from .store import Claim, LeaseLost, Store, database_url

#: How long a claim survives without a heartbeat. Long enough to ride out a
#: model load and a slow image; short enough that a dead worker's job is picked
#: up within a couple of minutes by anyone else.
LEASE_SECONDS = 90.0
HEARTBEAT_SECONDS = 15.0
POLL_SECONDS = 5.0

#: Failure mode 8: refuse to start a job on a nearly full disk rather than
#: failing opaquely halfway through. A 60-shot job writes well under 1 GB.
MIN_FREE_BYTES = 2 * 1024**3

#: Backoff before an unexpected failure is retried: attempt n waits n times this.
RETRY_DELAY_SECONDS = 30.0


class Stopping(Exception):
    """A graceful shutdown was requested; release the job."""


class Transient(RuntimeError):
    """A failure that may not repeat (disk full, network). Retry later."""


class Heartbeat(threading.Thread):
    """Extends the lease on its own connection until stopped or the lease is lost."""

    def __init__(self, claim: Claim, *, url: str, lease: float, every: float,
                 hostname: str, log) -> None:
        super().__init__(name=f"heartbeat-{claim.job_id}", daemon=True)
        self.claim, self.url, self.lease, self.every = claim, url, lease, every
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
                                   pid=os.getpid(), current_job=self.claim.job_id)
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


class Worker:
    def __init__(self, *, url: str, work_root: Path, worker_id: str, engines: production.Engines,
                 lease: float = LEASE_SECONDS, heartbeat: float = HEARTBEAT_SECONDS,
                 poll: float = POLL_SECONDS, fake: bool = False, log=print) -> None:
        self.url = url
        self.store = Store(url)
        self.work_root = work_root
        self.worker_id = worker_id
        self.hostname = machine_name()
        self.engines = engines
        self.lease, self.heartbeat_every, self.poll = lease, heartbeat, poll
        self.fake = fake
        self.log = log
        self.stopping = False
        self._lock_fd: int | None = None

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
        self.log(f"worker {self.worker_id} (pid {os.getpid()}) on {self.work_root}, "
                 f"lease {self.lease:.0f}s, heartbeat {self.heartbeat_every:.0f}s")

        first = True
        while not self.stopping:
            self.store.touch_worker(self.worker_id, hostname=self.hostname,
                                    pid=os.getpid(), current_job=None)
            claim = self.store.claim(self.worker_id, self.lease, reclaim_own=first, fake=self.fake)
            first = False
            if claim is None:
                if once or exit_when_idle:
                    self.log("queue empty")
                    return 0
                self._sleep(self.poll)
                continue
            self.execute(claim)
            if once:
                return 0
        self.log("stopped")
        return 0

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
                       hostname=self.hostname, log=self.log)
        hb.start()
        self.store.touch_worker(self.worker_id, hostname=self.hostname, pid=os.getpid(),
                                current_job=claim.job_id)
        self.store.event(claim, "claimed", {
            "attempt": claim.attempts, "pid": os.getpid(),
            "checkpoint_keys": resumed,
            "images_checkpointed": len(claim.checkpoint.get("images", {})),
        })
        hooks = JobHooks(self, claim, hb)
        t0 = time.time()
        try:
            inputs = self.load_inputs(claim)
            free = shutil.disk_usage(self.work_root).free
            if free < MIN_FREE_BYTES:
                raise Transient(f"only {free / 1024**3:.1f} GB free under {self.work_root}")
            paths = config.Paths(root=self.work_root, project=claim.project_id)
            result = production.run(inputs, paths, engines=self.engines, hooks=hooks,
                                    log=self.log)
            hooks.check()
            version = self.store.complete(claim, result.timeline.to_json())
            self.store.event(claim, "done", {
                "timeline_version": version, "seconds": round(time.time() - t0, 1),
                "generated": result.stats.generated if result.stats else 0,
                "cached": result.stats.cached if result.stats else 0,
                "video": str(result.video) if result.video else None,
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
                self.worker_id, hostname=self.hostname, pid=os.getpid(), current_job=None))

    def _quietly(self, fn):
        try:
            return fn()
        except LeaseLost as exc:
            self.log(f"  {exc}")
        except Exception as exc:
            self.log(f"  could not record outcome: {type(exc).__name__}: {exc}")
        return None

    def load_inputs(self, claim: Claim) -> production.Inputs:
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

        size = p.get("render_size")
        return production.Inputs(
            project=claim.project_id,
            topic=project["topic"],
            research=docs.parse_research_text(research_row["markdown_raw"]),
            script=docs.parse_script_text(script_row["markdown_raw"]),
            style=config.Style.from_record(style_row["id"], style_row["preset_json"]),
            target_shots=int(p.get("target_shots", config.TARGET_SHOTS)),
            allow_fixture_sources=bool(p.get("allow_fixture_sources", False)),
            force=bool(p.get("force", False)),
            max_wer=float(p.get("max_wer", config.MAX_WER)),
            render_size=tuple(size) if size else None,
        )


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


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m pipeline.worker", description=__doc__.split("\n")[0])
    ap.add_argument("--work-root", type=Path, default=None,
                    help="default $WORK_ROOT or ./work (./work/fake with --fake)")
    ap.add_argument("--worker-id", default=os.environ.get("WORKER_ID"),
                    help="default <hostname>:<work root>. Stable across restarts, so a "
                         "restarted worker reclaims its own orphaned job immediately; "
                         "unique per work root, which the host lock is taken on")
    ap.add_argument("--lease", type=float, default=LEASE_SECONDS)
    ap.add_argument("--heartbeat", type=float, default=HEARTBEAT_SECONDS)
    ap.add_argument("--poll", type=float, default=POLL_SECONDS)
    ap.add_argument("--once", action="store_true", help="run at most one job, then exit")
    ap.add_argument("--exit-when-idle", action="store_true", help="exit when the queue is empty")
    ap.add_argument("--no-caffeinate", action="store_true")
    ap.add_argument("--fake", action="store_true",
                    help="weights-free engines (pipeline/fakes.py): exercises the queue, "
                         "checkpoints and render without loading a model")
    ap.add_argument("--fake-delay", type=float, default=0.0,
                    help="seconds per fake image, to give a kill test something to interrupt")
    args = ap.parse_args(argv)

    if args.fake:
        from .fakes import fake_engines

        engines = fake_engines(image_delay=args.fake_delay)
    else:
        engines = production.Engines(unload_images=False)
    if not args.no_caffeinate and not args.fake:
        keep_awake()

    store = Store()
    store.migrate()
    store.close()

    root = (args.work_root or Path(os.environ.get("WORK_ROOT", "work"))
            / ("fake" if args.fake and not args.work_root else "")).resolve()
    worker = Worker(
        url=database_url(), work_root=root,
        worker_id=args.worker_id or f"{machine_name()}:{root}", engines=engines,
        lease=args.lease, heartbeat=args.heartbeat, poll=args.poll, fake=args.fake,
        log=lambda *a: print(*a, flush=True),
    )
    return worker.run(once=args.once, exit_when_idle=args.exit_when_idle)


if __name__ == "__main__":
    sys.exit(main())
