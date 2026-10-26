"""Queue, lease and resume checks against a real Postgres. No model weights.

    docker compose up -d --wait
    python -m pipeline.queuetest

Runs in a throwaway database created and dropped around the run, so it never
touches the queue a real worker is polling.

The last section is the Phase 2 exit criterion, tested the way it would fail
in life: a real worker *process* is SIGKILLed mid-job, restarted, and the job's
event log is checked to show the resumed attempt generated only the shots the
dead one never finished. The fakes make it take seconds; everything else —
the queue, the lease, the content-addressed caches, ffmpeg — is the real code.
"""

from __future__ import annotations

import dataclasses
import os
import shlex
import signal
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

import psycopg
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from . import config, docs
from .selftest import Checks
from .store import LeaseLost, Store, database_url

FIXTURES = Path(__file__).resolve().parent / "fixtures"
REPO = Path(__file__).resolve().parent.parent


class ThrowawayDB:
    def __init__(self) -> None:
        self.admin = database_url()
        self.name = f"ytm_queuetest_{os.getpid()}"
        self.url = make_conninfo(self.admin, dbname=self.name)

    def __enter__(self) -> str:
        with psycopg.connect(self.admin, autocommit=True) as c:
            c.execute(f'CREATE DATABASE "{self.name}"')
        return self.url

    def __exit__(self, *exc) -> None:
        with psycopg.connect(self.admin, autocommit=True) as c:
            c.execute(f'DROP DATABASE IF EXISTS "{self.name}" WITH (FORCE)')


def seed(store: Store, project: str = "barbarians-01") -> dict:
    style = config.PHASE1_STYLE
    store.upsert_style(style.style_id, style.preset, style.to_record(), is_library=True)
    research = docs.parse_research(FIXTURES / "barbarians-01.research.md")
    script = docs.parse_script(FIXTURES / "barbarians-01.script.md")
    store.upsert_project(project, topic="t", target_duration=script.target_duration,
                         style_id=style.style_id)
    r = store.add_artifact(project, "research", research.raw, doc_status="approved")
    s = store.add_artifact(project, "script", script.raw, doc_status="approved")
    return {"research_id": r["id"], "script_id": s["id"], "style_id": style.style_id,
            "allow_fixture_sources": True}


def drain(store: Store) -> None:
    """Close every live job so the next check starts from an empty queue."""
    store.conn.execute("UPDATE jobs SET state = 'cancelled', lease_token = NULL "
                       "WHERE state IN ('queued', 'running')")


def queue_semantics(c: Checks, url: str) -> None:
    store = Store(url)
    print("\n-- schema --")
    c.check("migrations apply", store.migrate() == ["001_init.sql", "002_web.sql", "003_library_style.sql",
                                                  "004_narrative.sql"])
    c.check("migrations are idempotent", store.migrate() == [])
    payload = seed(store)
    again = seed(store)
    c.check("re-seeding identical documents does not mint a new version",
            again["script_id"] == payload["script_id"])

    print("\n-- claim --")
    job = store.enqueue("barbarians-01", "production", payload)
    try:
        store.enqueue("barbarians-01", "production", payload)
        c.check("one live production job per project", False, "second enqueue succeeded")
    except psycopg.errors.UniqueViolation:
        c.check("one live production job per project", True)

    # Eight workers polling at the same instant, each on its own connection.
    winners: list = []
    barrier = threading.Barrier(8)

    def race(i: int) -> None:
        with Store(url) as s:
            barrier.wait()
            got = s.claim(f"racer-{i}", 30)
            if got:
                winners.append(got)

    threads = [threading.Thread(target=race, args=(i,)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    c.check("eight simultaneous claims, exactly one winner", len(winners) == 1, str(len(winners)))
    a = winners[0]
    c.check("claim records the attempt", a.attempts == 1 and a.job_id == job)
    c.check("a leased job is not claimable by others", store.claim("other", 30) is None)

    store.heartbeat(a, 30)
    c.check("heartbeat with the live token succeeds", True)
    forged = dataclasses.replace(a, token="00000000-0000-0000-0000-000000000000")
    try:
        store.checkpoint(forged, "x", {})
        c.check("a write with a stale token is refused", False)
    except LeaseLost:
        c.check("a write with a stale token is refused", True)

    print("\n-- lease expiry and fencing --")
    store.heartbeat(a, 0.5)
    time.sleep(1.0)
    b = store.claim("worker-b", 30)
    c.check("an expired lease is reclaimed", b is not None and b.job_id == job)
    c.check("reclaim counts as a new attempt", b is not None and b.attempts == 2)
    try:
        store.heartbeat(a, 30)
        c.check("the old holder's heartbeat raises LeaseLost", False)
    except LeaseLost:
        c.check("the old holder's heartbeat raises LeaseLost", True)
    try:
        store.checkpoint(a, "images", {"S01": "from a zombie"})
        c.check("the old holder cannot checkpoint", False)
    except LeaseLost:
        c.check("the old holder cannot checkpoint", True)
    store.event(a, "shot", {"zombie": True})
    zombie = [e for e in store.events(job) if e["data"].get("zombie")]
    c.check("the old holder's events are dropped", not zombie)
    store.checkpoint(b, "images", {"S01": "b"})
    c.check("the new holder's checkpoint lands",
            store.job(job)["checkpoint"]["images"] == {"S01": "b"})

    print("\n-- a frozen worker that nobody replaced carries on --")
    store.heartbeat(b, 0.2)
    time.sleep(0.5)
    try:
        store.heartbeat(b, 30)
        c.check("heartbeat after an unclaimed expiry renews the lease", True)
    except LeaseLost:
        c.check("heartbeat after an unclaimed expiry renews the lease", False)

    print("\n-- release, retry, give up --")
    store.release(b)
    j = store.job(job)
    c.check("graceful release requeues without spending an attempt",
            j["state"] == "queued" and j["attempts"] == 1, f"{j['state']} {j['attempts']}")
    d = store.claim("worker-d", 30)
    c.check("checkpoint survives a release", d is not None and d.checkpoint.get("images") == {"S01": "b"})
    store.retry_later(d, "boom", 60)
    c.check("retry_later backs off", store.claim("worker-e", 30) is None)
    store.conn.execute("UPDATE jobs SET run_after = now() WHERE id = %s", (job,))
    e = store.claim("worker-e", 0.2)
    c.check("claimable after the backoff", e is not None and e.attempts == 3)
    time.sleep(0.5)
    c.check("a job that has used every attempt is not handed out again",
            store.claim("worker-f", 30) is None)
    j = store.job(job)
    c.check("...it is failed with a reason", j["state"] == "failed" and "not retrying" in (j["error"] or ""),
            f"{j['state']}: {j['error']}")
    c.check("operator retry resets the budget", store.requeue(job) and store.job(job)["attempts"] == 0)

    print("\n-- cancel, orphans, partitions --")
    f = store.claim("worker-f", 30)
    store.cancel(job)
    try:
        store.heartbeat(f, 30)
        c.check("cancel revokes the lease", False)
    except LeaseLost:
        c.check("cancel revokes the lease", True)

    job2 = store.enqueue("barbarians-01", "production", payload)
    g = store.claim("host:/work", 90)
    c.check("someone else waits out a live lease", store.claim("elsewhere", 90) is None)
    g2 = store.claim("host:/work", 90, reclaim_own=True)
    c.check("a restarted worker reclaims its own orphan at once",
            g2 is not None and g2.job_id == job2 and g2.token != g.token)
    drain(store)

    store.enqueue("barbarians-01", "production", {**payload, "fake": True})
    c.check("a real worker never takes a fake job", store.claim("real", 30) is None)
    c.check("a fake worker takes it", store.claim("fake", 30, fake=True) is not None)
    drain(store)

    print("\n-- staleness --")
    from .worker import Worker
    from .media import Mirror
    from .production import Engines, Gate

    job3 = store.enqueue("barbarians-01", "production", payload)
    h = store.claim("w", 30)
    script = (FIXTURES / "barbarians-01.script.md").read_text()
    store.add_artifact("barbarians-01", "script", script + "\n<!-- v2 -->\n", doc_status="approved")
    w = Worker(url=url, work_root=Path(tempfile.gettempdir()), worker_id="w", engines=Engines(),
               log=lambda *a: None)
    try:
        w.load_inputs(h, Mirror(Path(tempfile.gettempdir()) / "cache"))
        c.check("a job pinned to a superseded script refuses to run", False)
    except Gate as gate:
        c.check("a job pinned to a superseded script refuses to run",
                gate.stage == "inputs" and "superseded" in str(gate), str(gate))
    w.store.close()
    drain(store)
    store.close()


# ------------------------------------------------------------------- resume


#: Never inherited from the caller's shell: with .env.local sourced, a test
#: worker would otherwise upload fake images to the real Blob store.
SCRUBBED = ("BLOB_READ_WRITE_TOKEN", "MEDIA_DIR", "DOORBELL_URL", "WORKER_TOKEN")


def _worker(url: str, root: Path, *extra: str, env: dict | None = None) -> subprocess.Popen:
    env = {**{k: v for k, v in os.environ.items() if k not in SCRUBBED},
           "DATABASE_URL": url, "PYTHONUNBUFFERED": "1",
           # ...nor from the worker's env file, for the same reason.
           "WORKER_ENV_FILE": os.devnull, **(env or {})}
    return subprocess.Popen(
        [sys.executable, "-m", "pipeline.worker", "--fake", "--work-root", str(root),
         "--poll", "0.2", *extra],
        cwd=REPO, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )


def _wait_for(store: Store, job: int, pred, timeout: float = 60) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        if pred(store.events(job)):
            return True
        time.sleep(0.1)
    return False


def _shots(events, attempt: int) -> list[dict]:
    return [e["data"] for e in events if e["kind"] == "shot" and e["attempt"] == attempt]


def resume(c: Checks, url: str) -> None:
    store = Store(url)
    payload = {**seed(store), "fake": True, "render_size": [320, 180]}

    print("\n-- exit criterion: SIGKILL mid-job, restart, resume --")
    with tempfile.TemporaryDirectory() as td:
        root = Path(td) / "work"
        job = store.enqueue("barbarians-01", "production", payload)
        proc = _worker(url, root, "--fake-delay", "0.4")
        ok = _wait_for(store, job, lambda ev: len(_shots(ev, 1)) >= 4)
        c.check("worker reaches shot 4", ok)
        proc.send_signal(signal.SIGKILL)
        proc.wait()
        before = _shots(store.events(job), 1)
        j = store.job(job)
        c.check("killed job is left running under a dead worker (wedged until reclaimed)",
                j["state"] == "running", j["state"])
        c.check("checkpoint recorded every finished shot",
                len(j["checkpoint"].get("images", {})) == len(before),
                f"{len(j['checkpoint'].get('images', {}))} vs {len(before)} events")

        t = time.time()
        out = _worker(url, root, "--exit-when-idle").communicate(timeout=120)[0]
        waited = time.time() - t
        j = store.job(job)
        c.check("restarted worker finishes the job", j["state"] == "done", f"{j['state']}: {j['error']}\n{out[-1500:]}")
        c.check("same-host restart did not wait out the 90s lease", waited < 60, f"{waited:.0f}s")

        events = store.events(job)
        after = _shots(events, 2)
        done_before = {s["shot"] for s in before}
        regenerated = [s["shot"] for s in after if s["shot"] in done_before and s["generated"]]
        c.check(f"no finished shot regenerated ({len(done_before)} finished before the kill)",
                not regenerated, str(regenerated))
        c.check("every shot finished before the kill was a cache hit",
                all(s["source"] == "cached" for s in after if s["shot"] in done_before))
        c.check("the rest were generated",
                all(s["generated"] for s in after if s["shot"] not in done_before),
                str([(s["shot"], s["source"]) for s in after]))
        claimed = [e["data"] for e in events if e["kind"] == "claimed" and e["attempt"] == 2]
        c.check("the resumed attempt saw the checkpoint",
                claimed and claimed[0]["images_checkpointed"] == len(done_before))
        stages = [e["data"]["stage"] for e in events if e["kind"] == "stage" and e["attempt"] == 2]
        c.check("resume re-enters from the top (every stage is idempotent)",
                stages[:2] == ["validate", "narrate"], str(stages))

        tl = store.latest_timeline("barbarians-01")
        c.check("the timeline is written as a project version",
                tl is not None and tl["job_id"] == job and len(tl["timeline_json"]["shots"]) == 10)
        hashes = {s["shot_id"]: s["image"]["hash"] for s in tl["timeline_json"]["shots"]}
        first = {s["shot"]: s["hash"] for s in before}
        c.check("the resumed film uses the very images the dead attempt made",
                all(hashes[k] == v for k, v in first.items()))
        c.check("film exists", (root / "barbarians-01" / "out.mp4").exists())
        c.check("no partial files left behind", not list(root.rglob(".*.partial.*")))

    print("\n-- another machine takes over after the lease expires --")
    with tempfile.TemporaryDirectory() as td:
        root = Path(td) / "work"
        job = store.enqueue("barbarians-01", "production", payload)
        proc = _worker(url, root, "--fake-delay", "0.4", "--lease", "3", "--heartbeat", "1",
                       "--worker-id", "mac-a")
        c.check("worker A reaches shot 3", _wait_for(store, job, lambda ev: len(_shots(ev, 1)) >= 3))
        proc.send_signal(signal.SIGKILL)
        proc.wait()
        # B keeps polling: with A's lease still live there is nothing for it
        # to claim yet, which is the point.
        t = time.time()
        b = _worker(url, root, "--lease", "3", "--heartbeat", "1", "--worker-id", "mac-b")
        claimed = _wait_for(store, job, lambda ev: any(
            e["kind"] == "claimed" and e["worker"] == "mac-b" for e in ev))
        took = time.time() - t
        _wait_for(store, job, lambda ev: any(e["kind"] == "done" for e in ev))
        b.send_signal(signal.SIGTERM)
        out = b.communicate(timeout=30)[0]
        j = store.job(job)
        c.check("worker B completes it", j["state"] == "done" and j["claimed_by"] == "mac-b",
                f"{j['state']} {j['claimed_by']}\n{out[-800:]}")
        c.check("worker B waited for the lease, then took the job promptly",
                claimed and 1.5 < took < 10, f"{took:.1f}s")
        before = {s["shot"] for s in _shots(store.events(job), 1)}
        after = _shots(store.events(job), 2)
        c.check("worker B regenerated none of A's shots",
                not [s for s in after if s["shot"] in before and s["generated"]])

    print("\n-- graceful shutdown --")
    with tempfile.TemporaryDirectory() as td:
        root = Path(td) / "work"
        job = store.enqueue("barbarians-01", "production", payload)
        proc = _worker(url, root, "--fake-delay", "0.4")
        c.check("worker reaches shot 2", _wait_for(store, job, lambda ev: len(_shots(ev, 1)) >= 2))
        proc.send_signal(signal.SIGTERM)
        proc.wait(timeout=30)
        j = store.job(job)
        c.check("SIGTERM releases the job back to the queue",
                j["state"] == "queued" and j["attempts"] == 0, f"{j['state']} attempts={j['attempts']}")
        c.check("...and says so in the log",
                any(e["kind"] == "released" for e in store.events(job)))
        _worker(url, root, "--exit-when-idle").communicate(timeout=120)
        c.check("the released job completes on the next start", store.job(job)["state"] == "done")

    print("\n-- one worker per work root --")
    with tempfile.TemporaryDirectory() as td:
        root = Path(td) / "work"
        first = _worker(url, root)
        time.sleep(2.0)
        second = _worker(url, root, "--exit-when-idle")
        out = second.communicate(timeout=30)[0]
        c.check("a second worker on the same root refuses to start",
                second.returncode != 0 and "already holds" in out, out[-300:])
        first.send_signal(signal.SIGTERM)
        first.wait(timeout=30)

    store.close()


def _takeover(store: Store, url: str, payload: dict, media_dir: Path | None) -> dict:
    """Worker A on one disk is killed after shot 3; worker B on an *empty*
    disk takes over once A's lease runs out. -> what B did."""
    env = {"MEDIA_DIR": str(media_dir)} if media_dir else {}
    with tempfile.TemporaryDirectory() as ta, tempfile.TemporaryDirectory() as tb:
        job = store.enqueue("barbarians-01", "production", payload)
        a = _worker(url, Path(ta) / "work", "--fake-delay", "0.4", "--lease", "3",
                    "--heartbeat", "1", "--worker-id", "disk-a", env=env)
        reached = _wait_for(store, job, lambda ev: len(_shots(ev, 1)) >= 3)
        a.send_signal(signal.SIGKILL)
        a.wait()
        b = _worker(url, Path(tb) / "work", "--lease", "3", "--heartbeat", "1",
                    "--worker-id", "disk-b", env=env)
        _wait_for(store, job, lambda ev: any(e["kind"] == "done" for e in ev))
        b.send_signal(signal.SIGTERM)
        out = b.communicate(timeout=30)[0]
        events = store.events(job)
        before = _shots(events, 1)
        done = [e["data"] for e in events if e["kind"] == "done"]
        return {
            "reached": reached, "job": store.job(job), "out": out, "before": before,
            "after": _shots(events, 2), "done": done[0] if done else {},
            "narration_cached": "cached " in out.split("== align")[0] if "== align" in out else False,
        }


def media_takeover(c: Checks, url: str) -> None:
    store = Store(url)
    payload = {**seed(store), "fake": True, "render_size": [320, 180]}

    print("\n-- media: a worker with an empty disk takes over through the store --")
    with tempfile.TemporaryDirectory() as tm:
        media_dir = Path(tm) / "blob"
        r = _takeover(store, url, payload, media_dir)
        before = {s["shot"] for s in r["before"]}
        c.check("worker A reaches shot 3 before the kill", r["reached"])
        c.check("worker B, on an empty disk, completes the job",
                r["job"]["state"] == "done" and r["job"]["claimed_by"] == "disk-b",
                f"{r['job']['state']}: {r['job']['error']}\n{r['out'][-800:]}")
        c.check("worker B regenerated none of A's shots",
                before and not [s for s in r["after"] if s["shot"] in before and s["generated"]],
                str([(s["shot"], s["source"]) for s in r["after"]]))
        c.check("B took the narration from the store rather than re-synthesizing it",
                r["narration_cached"], r["out"][:600])
        c.check("B fetched A's images, narration and alignment",
                r["done"].get("fetched", 0) >= len(before) + 3, str(r["done"]))
        film = r["done"].get("film")
        c.check("the film was published under its content address",
                bool(film) and film.startswith("films/") and (media_dir / film).is_file(), str(film))
        tl = store.latest_timeline("barbarians-01")["timeline_json"]
        c.check("the timeline points at the published film", tl.get("media", {}).get("film") == film)
        sheet = tl.get("media", {}).get("sheet", {})
        c.check("...and at a contact sheet holding every shot",
                (media_dir / sheet.get("key", "-")).is_file() and len(sheet.get("shots", [])) == 10
                and sheet["cols"] * sheet["rows"] >= 10, str(sheet))
        missing = [s["shot_id"] for s in tl["shots"]
                   if not (media_dir / "images" / f"{s['image']['hash']}.png").is_file()]
        c.check("every still the timeline names is in the store", not missing, str(missing))
        rows = store.conn.execute("SELECT key FROM media WHERE store = %s",
                                  (f"dir:{media_dir}",)).fetchall()
        indexed = {row["key"] for row in rows}
        on_disk = {p.relative_to(media_dir).as_posix() for p in media_dir.rglob("*") if p.is_file()}
        c.check("the media index matches what the store holds", indexed == on_disk,
                f"{len(indexed)} indexed, {len(on_disk)} stored")
        c.check("Ken Burns segments stay local", not any(k.startswith("segments/") for k in indexed))

    def run_to_done(root: Path, env: dict) -> dict:
        job = store.enqueue("barbarians-01", "production", payload)
        out = _worker(url, root, "--exit-when-idle", env=env).communicate(timeout=180)[0]
        return {"job": store.job(job), "events": store.events(job), "out": out}

    def stills_missing(media_dir: Path) -> list[str]:
        tl = store.latest_timeline("barbarians-01")["timeline_json"]
        return [s["shot_id"] for s in tl["shots"]
                if not (media_dir / "images" / f"{s['image']['hash']}.png").is_file()]

    print("\n-- media: a failed upload is retried, not charged to the job --")
    with tempfile.TemporaryDirectory() as tm, tempfile.TemporaryDirectory() as tw:
        media_dir = Path(tm) / "blob"
        r = run_to_done(Path(tw) / "work", {"MEDIA_DIR": str(media_dir), "MEDIA_DIR_FAIL_PUTS": "2,6"})
        c.check("the job completes on its first attempt despite two failed uploads",
                r["job"]["state"] == "done" and r["job"]["attempts"] == 1,
                f"{r['job']['state']} attempts={r['job']['attempts']}\n{r['out'][-600:]}")
        c.check("...and says it retried", r["out"].count("retrying in") == 2)
        c.check("...and every still the timeline names reached the store", not stills_missing(media_dir))

    print("\n-- media: publishing heals what an earlier run never uploaded --")
    with tempfile.TemporaryDirectory() as tm, tempfile.TemporaryDirectory() as tw:
        media_dir, root = Path(tm) / "blob", Path(tw) / "work"
        run_to_done(root, {})                       # local cache only, nothing published
        r = run_to_done(root, {"MEDIA_DIR": str(media_dir)})
        shots = _shots(r["events"], 1)
        c.check("the second run is all local cache hits",
                shots and not any(s["generated"] for s in shots), str(shots))
        c.check("...yet every still it used is now in the store", not stills_missing(media_dir),
                str(stills_missing(media_dir)))
        c.check("...and so are the narration and alignment",
                len(list((media_dir / "audio").glob("*"))) == 2 and len(list((media_dir / "align").glob("*"))) == 1)

    print("\n-- media: negative control, the same takeover with no store --")
    r = _takeover(store, url, payload, None)
    before = {s["shot"] for s in r["before"]}
    c.check("without a store, B regenerates A's shots (so the check above can fail)",
            before and all(s["generated"] for s in r["after"] if s["shot"] in before),
            str([(s["shot"], s["source"]) for s in r["after"]]))
    store.close()


class _Bell:
    """A stand-in for the web app's doorbell route."""

    def __init__(self) -> None:
        import http.server

        bell = self
        self.ring, self.hits, self.status = "r0", 0, 200

        class H(http.server.BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                bell.hits += 1
                ok = self.headers.get("Authorization") == "Bearer t0k"
                code = bell.status if ok else 401
                body = f'{{"ring": "{bell.ring}"}}'.encode()
                self.send_response(code)
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.server.server_port}/api/worker/doorbell"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self) -> None:
        self.server.shutdown()


def doorbell(c: Checks, url: str) -> None:
    store = Store(url)
    payload = {**seed(store), "fake": True, "render_size": [320, 180]}
    print("\n-- doorbell: an idle worker leaves the database alone --")
    bell = _Bell()
    env = {"DOORBELL_URL": bell.url, "WORKER_TOKEN": "t0k"}

    def seen() -> float:
        row = store.conn.execute("SELECT last_seen_at FROM workers WHERE id = 'bell'").fetchone()
        return row["last_seen_at"].timestamp() if row else 0.0

    with tempfile.TemporaryDirectory() as td:
        proc = _worker(url, Path(td) / "work", "--worker-id", "bell", "--doorbell-every", "0.3",
                       "--idle-db", "3600", env=env)
        time.sleep(2.0)
        first = seen()
        hits = bell.hits
        time.sleep(2.0)
        c.check("the idle worker polls the doorbell", bell.hits > hits + 3, f"{bell.hits - hits} polls")
        c.check("...and not the database", first > 0 and seen() == first)

        job = store.enqueue("barbarians-01", "production", payload)
        time.sleep(2.0)
        c.check("a job enqueued without a ring waits (the database really is not polled)",
                store.job(job)["state"] == "queued", store.job(job)["state"])
        t = time.time()
        bell.ring = "r1"
        picked = _wait_for(store, job, lambda ev: any(e["kind"] == "claimed" for e in ev), timeout=10)
        c.check("a ring is answered within a couple of doorbell intervals",
                picked and time.time() - t < 2.0, f"{time.time() - t:.1f}s")
        c.check("...and the job completes", _wait_for(
            store, job, lambda ev: any(e["kind"] == "done" for e in ev), timeout=60))

        job2 = store.enqueue("barbarians-01", "production", payload)
        bell.status = 503
        bell.ring = "r2"
        time.sleep(2.0)
        c.check("a broken doorbell does not make the worker hammer the database",
                store.job(job2)["state"] == "queued")
        bell.status = 200
        c.check("the worker recovers when the doorbell does", _wait_for(
            store, job2, lambda ev: any(e["kind"] == "claimed" for e in ev), timeout=10))
        _wait_for(store, job2, lambda ev: any(e["kind"] == "done" for e in ev), timeout=60)
        proc.send_signal(signal.SIGTERM)
        out = proc.communicate(timeout=30)[0]
        c.check("the worker logs that it is on the doorbell", "doorbell every" in out, out[:300])
    bell.close()
    drain(store)
    store.close()


def writing(c: Checks, url: str) -> None:
    """The light lane: Claude writes research and scripts (a stand-in here)."""
    store = Store(url)
    seed(store)
    project = "barbarians-01"
    print("\n-- the light lane: research and script by claude -p --")
    with tempfile.TemporaryDirectory() as td:
        stub = Path(td) / "claude"
        # Claude runs in an empty temporary directory, so the stub finds the
        # package through PYTHONPATH rather than its working directory.
        stub.write_text(f"#!/bin/sh\nPYTHONPATH={shlex.quote(str(REPO))} "
                        f"exec {shlex.quote(sys.executable)} -m pipeline.fake_claude \"$@\"\n")
        stub.chmod(0o755)
        root = Path(td) / "work"

        def run(job: int, mode: str = "ok", extra: tuple = ()) -> str:
            proc = _worker(url, root, "--kinds", "research,script", "--exit-when-idle", *extra,
                           env={"CLAUDE_BIN": str(stub), "FAKE_CLAUDE_MODE": mode})
            return proc.communicate(timeout=60)[0]

        def latest(kind: str) -> dict:
            return store.conn.execute(
                "SELECT * FROM artifacts WHERE project_id = %s AND kind = %s "
                "ORDER BY version DESC LIMIT 1", (project, kind)).fetchone()

        before = latest("research")["version"]
        job = store.enqueue(project, "research", {"fake": True, "verify_sources": False})
        c.check("enqueueing research moves the project to staging",
                store.project(project)["state"] == "staging")
        out = run(job)
        j = store.job(job)
        art = latest("research")
        c.check("the light lane finishes a research job", j["state"] == "done", f"{j['state']}: {j['error']}\n{out[-600:]}")
        c.check("...as a new version written by claude, validated",
                art["version"] == before + 1 and art["source"] == "claude" and art["doc_status"] == "valid"
                and art["job_id"] == job, f"v{art['version']} {art['source']} {art['doc_status']} {art['validator_report']}")
        c.check("...with the document extracted from the reply, not the chatter around it",
                art["markdown_raw"].startswith("---") and "Sources:" not in art["markdown_raw"])
        log = store.conn.execute("SELECT * FROM prompt_log WHERE job_id = %s", (job,)).fetchall()
        c.check("...and exactly one prompt_log row, tied to the artifact",
                len(log) == 1 and log[0]["artifact_id"] == art["id"] and "[system]" in log[0]["prompt_text"]
                and "Topic: t\n" in log[0]["prompt_text"] and log[0]["response_raw"])
        c.check("research records hash(topic, angle) as its upstream", bool(art["upstream_hash"]))

        store.conn.execute("UPDATE artifacts SET doc_status = 'approved', approved_at = now() WHERE id = %s",
                           (art["id"],))
        job = store.enqueue(project, "script", {"fake": True, "research_id": art["id"]})
        run(job)
        s_art = latest("script")
        c.check("a script job writes from the approved research",
                store.job(job)["state"] == "done" and s_art["source"] == "claude"
                and s_art["upstream_hash"] == art["content_sha"], f"{store.job(job)['error']}")
        c.check("...and the script validates against that research's claims",
                s_art["doc_status"] == "valid", str(s_art["validator_report"]))

        n_art = latest("research")["version"]
        n_log = store.conn.execute("SELECT count(*) AS n FROM prompt_log").fetchone()["n"]
        job = store.enqueue(project, "research", {"fake": True, "verify_sources": False})
        run(job, mode="limit")
        j = store.job(job)
        c.check("a usage limit fails the job at once, without retrying",
                j["state"] == "failed" and j["attempts"] == 1 and "Claude did not run" in (j["error"] or ""),
                f"{j['state']} attempts={j['attempts']} {j['error']}")
        c.check("...and adds no document and no prompt_log row",
                latest("research")["version"] == n_art
                and store.conn.execute("SELECT count(*) AS n FROM prompt_log").fetchone()["n"] == n_log)

        job = store.enqueue(project, "research", {"fake": True, "verify_sources": False})
        run(job, mode="garbage")
        art = latest("research")
        c.check("a reply with no usable document is kept as an invalid version",
                store.job(job)["state"] == "done" and art["version"] == n_art + 1
                and art["doc_status"] == "invalid", f"{art['doc_status']} {art['validator_report']}")

        job = store.enqueue(project, "research", {"fake": True, "verify_sources": False})
        proc = _worker(url, root, "--kinds", "research,script",
                       env={"CLAUDE_BIN": str(stub), "FAKE_CLAUDE_MODE": "slow", "FAKE_CLAUDE_DELAY": "30"})
        _wait_for(store, job, lambda ev: any(e["kind"] == "stage" and e["data"]["stage"] == "writing" for e in ev))
        time.sleep(1.0)
        t = time.time()
        proc.send_signal(signal.SIGTERM)
        proc.communicate(timeout=30)
        j = store.job(job)
        c.check("a shutdown mid-write stops Claude and releases the job promptly",
                j["state"] == "queued" and time.time() - t < 10, f"{j['state']} after {time.time() - t:.1f}s")
        c.check("...without adding a version", latest("research")["version"] == n_art + 1)
    drain(store)
    store.close()


def looks(c: Checks, url: str) -> None:
    """The style stage: candidates painted, one locked with a crop, then used."""
    store = Store(url)
    payload = {**seed(store), "fake": True, "render_size": [320, 180]}
    print("\n-- the look: candidates, a locked hero, the crop built from it --")
    with tempfile.TemporaryDirectory() as tm, tempfile.TemporaryDirectory() as tw:
        media_dir, root = Path(tm) / "blob", Path(tw) / "work"
        env = {"MEDIA_DIR": str(media_dir)}
        job = store.enqueue("barbarians-01", "style", {
            "fake": True, "preset_id": "sty_phase1", "preset": "dark-oil-painting",
            "prompt_prefix": "dark oil painting, heavy impasto,", "beat_id": "B01",
            "visual": "pre-dawn longhouse interior", "mood": "cold, blue", "seeds": [11, 22, 33]})
        out = _worker(url, root, "--exit-when-idle", env=env).communicate(timeout=120)[0]
        run = store.conn.execute("SELECT * FROM style_runs WHERE job_id = %s", (job,)).fetchone()
        c.check("a style job paints three candidates of the hero beat",
                store.job(job)["state"] == "done" and run and len(run["candidates_json"]) == 3,
                f"{store.job(job)['state']} {store.job(job)['error']}\n{out[-500:]}")
        keys = [cand["key"] for cand in run["candidates_json"]] if run else []
        c.check("...each a different image, all in the store",
                len(set(keys)) == 3 and all((media_dir / k).is_file() for k in keys))

        chosen = run["candidates_json"][1]
        store.upsert_style("sty_test_locked", "locked", {
            "preset": "dark-oil-painting", "prompt_prefix": "dark oil painting, heavy impasto,",
            "seed": chosen["seed"], "hero_full": chosen["key"], "crop_box": [0.3, 0.1, 0.7, 0.95]})
        job = store.enqueue("barbarians-01", "production", {**payload, "style_id": "sty_test_locked"})
        out = _worker(url, root, "--exit-when-idle", env=env).communicate(timeout=180)[0]
        j = store.job(job)
        crop = store.style("sty_test_locked")["preset_json"].get("hero_crop", "")
        c.check("a film renders with the locked look", j["state"] == "done", f"{j['error']}\n{out[-600:]}")
        c.check("...after the worker built the hero crop and recorded it on the style",
                crop.startswith("refs/") and (media_dir / crop).is_file(), crop)
        from PIL import Image

        with Image.open(media_dir / crop) as im:
            size = im.size
        c.check("...cropped to exactly the chosen box", size == (round(0.7 * 832) - round(0.3 * 832),
                                                             round(0.95 * 480) - round(0.1 * 480)), str(size))
        tl = store.latest_timeline("barbarians-01")["timeline_json"]
        c.check("...and every shot was conditioned on that crop",
                all(s["image"]["refs"] == [Path(crop).name] for s in tl["shots"]),
                str({s["image"]["refs"][0] for s in tl["shots"]}))
    drain(store)
    store.close()


def main() -> int:
    try:
        psycopg.connect(database_url(), connect_timeout=3).close()
    except Exception as exc:
        host = conninfo_to_dict(database_url()).get("host")
        print(f"Postgres not reachable at {host} ({exc}).\nStart it: docker compose up -d --wait")
        return 2

    c = Checks()
    with ThrowawayDB() as url:
        queue_semantics(c, url)
        resume(c, url)
        media_takeover(c, url)
        doorbell(c, url)
        writing(c, url)
        looks(c, url)

    print(f"\n{c.run - len(c.failures)}/{c.run} checks passed")
    if c.failures:
        print("failed: " + ", ".join(c.failures))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
