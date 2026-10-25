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
    c.check("migrations apply", store.migrate() == ["001_init.sql"])
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
    from .production import Engines, Gate

    job3 = store.enqueue("barbarians-01", "production", payload)
    h = store.claim("w", 30)
    script = (FIXTURES / "barbarians-01.script.md").read_text()
    store.add_artifact("barbarians-01", "script", script + "\n<!-- v2 -->\n", doc_status="approved")
    w = Worker(url=url, work_root=Path(tempfile.gettempdir()), worker_id="w", engines=Engines(),
               log=lambda *a: None)
    try:
        w.load_inputs(h)
        c.check("a job pinned to a superseded script refuses to run", False)
    except Gate as gate:
        c.check("a job pinned to a superseded script refuses to run",
                gate.stage == "inputs" and "superseded" in str(gate), str(gate))
    w.store.close()
    drain(store)
    store.close()


# ------------------------------------------------------------------- resume


def _worker(url: str, root: Path, *extra: str) -> subprocess.Popen:
    env = {**os.environ, "DATABASE_URL": url, "PYTHONUNBUFFERED": "1"}
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

    print(f"\n{c.run - len(c.failures)}/{c.run} checks passed")
    if c.failures:
        print("failed: " + ", ".join(c.failures))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
