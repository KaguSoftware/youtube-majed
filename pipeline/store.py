"""Postgres: the job queue, and the rows a production job reads and writes.

The queue is Postgres rather than a broker because the jobs are few and long —
a handful a day, twenty minutes each — and the job row is also the progress
record, the checkpoint and the audit trail. A broker would hold the first and
leave the other three to be rebuilt somewhere else.

### Claim, lease, heartbeat, fence

A worker *claims* a job with `FOR UPDATE SKIP LOCKED`, so two workers polling
at the same instant cannot both get it. The claim sets a lease that the worker
keeps extending with a heartbeat. If the worker dies, the lease runs out and
the next poll reclaims the job (PLAN.md failure mode 4).

Every claim also mints a fresh `lease_token`, and **every write a worker makes
is conditioned on it**. That is the part a heartbeat alone gets wrong. A worker
that was frozen — lid closed, SIGSTOP, a 40-second GC pause in the wrong place
— wakes up believing it still owns its job. If the job was reclaimed meanwhile,
its token no longer matches, its next write touches zero rows, and it gets
`LeaseLost` instead of quietly overwriting the new owner's progress.

The flip side is deliberate: a heartbeat does *not* check whether the lease has
expired, only whether the token still matches. A Mac that slept through its
lease with nobody else waiting for the job just carries on when it wakes. The
lease is a permission for someone else to take over, not a deadline the owner
must beat.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .timeline import text_sha

#: Matches compose.yaml. Production sets DATABASE_URL to Neon; nothing else in
#: the worker knows or cares which it is talking to.
DEFAULT_URL = "postgresql://ytm:ytm@127.0.0.1:54329/ytm"

MIGRATIONS = Path(__file__).resolve().parent / "migrations"


def database_url() -> str:
    return os.environ.get("DATABASE_URL", DEFAULT_URL)


class LeaseLost(RuntimeError):
    """This worker no longer owns the job. Stop work; write nothing further."""


@dataclass(frozen=True)
class Claim:
    """A worker's hold on one job. `token` fences every write it makes."""

    job_id: int
    project_id: str
    kind: str
    payload: dict
    checkpoint: dict
    attempts: int
    max_attempts: int
    token: str
    worker: str


class Store:
    def __init__(self, url: str | None = None) -> None:
        self.url = url or database_url()
        self.conn = psycopg.connect(self.url, autocommit=True, row_factory=dict_row)

    def close(self) -> None:
        self.conn.close()

    def __enter__(self) -> "Store":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def _one(self, sql: str, params: Any = None) -> dict | None:
        return self.conn.execute(sql, params).fetchone()

    def _all(self, sql: str, params: Any = None) -> list[dict]:
        return self.conn.execute(sql, params).fetchall()

    # ----------------------------------------------------------- migrations

    def migrate(self) -> list[str]:
        """Apply every `migrations/NNN_*.sql` not yet recorded. Idempotent.

        The advisory lock serializes two processes migrating at once, which
        happens the first time a worker and the CLI start together.
        """
        applied: list[str] = []
        with self.conn.transaction():
            self.conn.execute("SELECT pg_advisory_xact_lock(7240001)")
            self.conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                " name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
            )
            done = {r["name"] for r in self._all("SELECT name FROM schema_migrations")}
            for path in sorted(MIGRATIONS.glob("*.sql")):
                if path.name in done:
                    continue
                self.conn.execute(path.read_text())
                self.conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (path.name,))
                applied.append(path.name)
        return applied

    # ------------------------------------------------- projects and artifacts

    def upsert_style(self, style_id: str, name: str, preset: dict, *, is_library: bool = False) -> None:
        self.conn.execute(
            "INSERT INTO styles (id, name, preset_json, is_library) VALUES (%s, %s, %s, %s) "
            "ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, "
            "preset_json = EXCLUDED.preset_json, is_library = EXCLUDED.is_library",
            (style_id, name, Jsonb(preset), is_library),
        )

    def style(self, style_id: str) -> dict | None:
        return self._one("SELECT * FROM styles WHERE id = %s", (style_id,))

    def upsert_project(self, project_id: str, *, topic: str, target_duration: float | None,
                       style_id: str | None, angle: str | None = None) -> None:
        self.conn.execute(
            "INSERT INTO projects (id, topic, angle, target_duration, style_id) "
            "VALUES (%s, %s, %s, %s, %s) ON CONFLICT (id) DO UPDATE SET "
            "topic = EXCLUDED.topic, angle = EXCLUDED.angle, "
            "target_duration = EXCLUDED.target_duration, style_id = EXCLUDED.style_id",
            (project_id, topic, angle, target_duration, style_id),
        )

    def project(self, project_id: str) -> dict | None:
        return self._one("SELECT * FROM projects WHERE id = %s", (project_id,))

    def add_artifact(self, project_id: str, kind: str, markdown: str, *, doc_status: str,
                     report: dict | None = None, upstream_hash: str | None = None) -> dict:
        """Append a new immutable version. Identical content returns the existing row.

        Re-seeding the same fixture should not mint version 7 of an unchanged
        document — that would make every downstream artifact look stale.
        """
        sha = text_sha(markdown)
        with self.conn.transaction():
            self.conn.execute("SELECT 1 FROM projects WHERE id = %s FOR UPDATE", (project_id,))
            latest = self._one(
                "SELECT * FROM artifacts WHERE project_id = %s AND kind = %s "
                "ORDER BY version DESC LIMIT 1", (project_id, kind),
            )
            if latest and latest["content_sha"] == sha and latest["doc_status"] == doc_status:
                return latest
            return self._one(
                "INSERT INTO artifacts (project_id, kind, version, markdown_raw, content_sha, "
                " doc_status, validator_report, upstream_hash, approved_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, "
                " CASE WHEN %s = 'approved' THEN now() END) RETURNING *",
                (project_id, kind, (latest["version"] + 1) if latest else 1, markdown, sha,
                 doc_status, Jsonb(report or {}), upstream_hash, doc_status),
            )

    def artifact(self, artifact_id: int) -> dict | None:
        return self._one("SELECT * FROM artifacts WHERE id = %s", (artifact_id,))

    def latest_approved(self, project_id: str, kind: str) -> dict | None:
        return self._one(
            "SELECT * FROM artifacts WHERE project_id = %s AND kind = %s "
            "AND doc_status = 'approved' ORDER BY version DESC LIMIT 1", (project_id, kind),
        )

    # ------------------------------------------------------------------ jobs

    def enqueue(self, project_id: str, kind: str, payload: dict, *, max_attempts: int = 3) -> int:
        with self.conn.transaction():
            row = self._one(
                "INSERT INTO jobs (project_id, kind, payload, max_attempts) "
                "VALUES (%s, %s, %s, %s) RETURNING id",
                (project_id, kind, Jsonb(payload), max_attempts),
            )
            self.conn.execute("UPDATE projects SET state = 'production' WHERE id = %s", (project_id,))
        return row["id"]

    def claim(self, worker: str, lease_seconds: float, *, reclaim_own: bool = False,
              fake: bool = False) -> Claim | None:
        """Take the oldest runnable job, or reclaim one whose lease ran out.

        `reclaim_own` is for a worker's first poll after starting. The worker
        holds a per-host lock (see worker.py), so a job still marked running
        under this worker's id belongs to a process that is certainly dead —
        there is no reason to sit out the rest of its lease before resuming.

        `fake` partitions the queue: a weights-free worker only takes jobs
        enqueued for it, and a real worker never does. Otherwise a smoke test
        left running could pick up a real job and publish a timeline of noise.
        """
        with self.conn.transaction():
            # A job that has already used its attempts is failed rather than
            # handed out again: something in it is killing workers.
            self.conn.execute(
                "UPDATE jobs SET state = 'failed', lease_token = NULL, finished_at = now(), "
                " error = format('worker lost %%s times (last: %%s); not retrying', "
                "                attempts, claimed_by) "
                "WHERE state = 'running' AND attempts >= max_attempts AND ("
                " lease_expires_at < now() OR (%(own)s AND claimed_by = %(worker)s))",
                {"own": reclaim_own, "worker": worker},
            )
            row = self._one(
                """
                WITH next AS (
                    SELECT id FROM jobs
                    WHERE ((state = 'queued' AND run_after <= now())
                       OR (state = 'running' AND (
                               lease_expires_at < now()
                            OR (%(own)s AND claimed_by = %(worker)s))))
                      AND coalesce((payload->>'fake')::boolean, false) = %(fake)s
                    ORDER BY created_at, id
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                )
                UPDATE jobs j SET
                    state = 'running',
                    claimed_by = %(worker)s,
                    lease_token = gen_random_uuid(),
                    lease_expires_at = now() + make_interval(secs => %(lease)s),
                    heartbeat_at = now(),
                    attempts = j.attempts + 1,
                    started_at = coalesce(j.started_at, now())
                FROM next WHERE j.id = next.id
                RETURNING j.*
                """,
                {"own": reclaim_own, "worker": worker, "lease": lease_seconds, "fake": fake},
            )
        if row is None:
            return None
        return Claim(
            job_id=row["id"], project_id=row["project_id"], kind=row["kind"],
            payload=row["payload"], checkpoint=row["checkpoint"], attempts=row["attempts"],
            max_attempts=row["max_attempts"], token=str(row["lease_token"]), worker=worker,
        )

    def _fenced(self, claim: Claim, assignments: str, params: dict | None = None) -> None:
        """UPDATE the job only if this claim still owns it, else raise LeaseLost."""
        cur = self.conn.execute(
            f"UPDATE jobs SET {assignments} "
            "WHERE id = %(job_id)s AND lease_token = %(token)s AND state = 'running'",
            {**(params or {}), "job_id": claim.job_id, "token": claim.token},
        )
        if cur.rowcount == 0:
            row = self._one("SELECT state, claimed_by FROM jobs WHERE id = %s", (claim.job_id,))
            now = f"{row['state']} under {row['claimed_by']}" if row else "deleted"
            raise LeaseLost(f"job {claim.job_id} is no longer ours (now {now})")

    def heartbeat(self, claim: Claim, lease_seconds: float) -> None:
        self._fenced(
            claim,
            "heartbeat_at = now(), lease_expires_at = now() + make_interval(secs => %(lease)s)",
            {"lease": lease_seconds},
        )

    def checkpoint(self, claim: Claim, key: str, value: Any, progress: dict | None = None) -> None:
        """Record one stage's output. Top-level keys are replaced whole."""
        self._fenced(
            claim,
            "checkpoint = checkpoint || jsonb_build_object(%(key)s::text, %(value)s::jsonb), "
            "progress = coalesce(%(progress)s::jsonb, progress), heartbeat_at = now()",
            {"key": key, "value": Jsonb(value),
             "progress": Jsonb(progress) if progress is not None else None},
        )

    def progress(self, claim: Claim, progress: dict) -> None:
        self._fenced(claim, "progress = %(p)s, heartbeat_at = now()", {"p": Jsonb(progress)})

    def event(self, claim: Claim, kind: str, data: dict | None = None) -> None:
        """Append to the job's log — fenced like everything else, except that the
        outcome events (`done`, `failed`, `released`, `error`) are written right after
        the claim is given up, so they are accepted from the last holder too."""
        self.conn.execute(
            "INSERT INTO job_events (job_id, attempt, worker, kind, data) "
            "SELECT %(job)s, %(attempt)s, %(worker)s, %(kind)s, %(data)s FROM jobs "
            "WHERE id = %(job)s AND (lease_token = %(token)s "
            "  OR (%(kind)s IN ('done', 'failed', 'released', 'error') AND claimed_by = %(worker)s))",
            {"job": claim.job_id, "attempt": claim.attempts, "worker": claim.worker,
             "kind": kind, "data": Jsonb(data or {}), "token": claim.token},
        )

    def complete(self, claim: Claim, timeline_json: dict) -> int:
        """Write the timeline as the project's next version and close the job, atomically."""
        with self.conn.transaction():
            self._fenced(
                claim,
                "state = 'done', finished_at = now(), lease_token = NULL, error = NULL, "
                "progress = progress || '{\"stage\": \"done\"}'::jsonb",
            )
            self.conn.execute("SELECT 1 FROM projects WHERE id = %s FOR UPDATE", (claim.project_id,))
            version = self._one(
                "SELECT coalesce(max(version), 0) + 1 AS v FROM timelines WHERE project_id = %s",
                (claim.project_id,),
            )["v"]
            self.conn.execute(
                "INSERT INTO timelines (project_id, version, timeline_json, job_id) "
                "VALUES (%s, %s, %s, %s)",
                (claim.project_id, version, Jsonb(timeline_json), claim.job_id),
            )
            self.conn.execute("UPDATE projects SET state = 'editing' WHERE id = %s", (claim.project_id,))
        return version

    def fail(self, claim: Claim, error: str) -> None:
        """Terminal. For deterministic failures a retry would only repeat."""
        self._fenced(
            claim, "state = 'failed', finished_at = now(), lease_token = NULL, error = %(e)s",
            {"e": error},
        )

    def retry_later(self, claim: Claim, error: str, delay_seconds: float) -> bool:
        """Back to the queue after a delay, or failed if attempts are spent. -> requeued?"""
        if claim.attempts >= claim.max_attempts:
            self.fail(claim, f"{error} (attempt {claim.attempts}/{claim.max_attempts}; not retrying)")
            return False
        self._fenced(
            claim,
            "state = 'queued', lease_token = NULL, lease_expires_at = NULL, error = %(e)s, "
            "run_after = now() + make_interval(secs => %(d)s)",
            {"e": error, "d": delay_seconds},
        )
        return True

    def release(self, claim: Claim) -> None:
        """Graceful shutdown: requeue without spending an attempt."""
        self._fenced(
            claim,
            "state = 'queued', lease_token = NULL, lease_expires_at = NULL, "
            "attempts = greatest(attempts - 1, 0)",
        )

    # ------------------------------------------------------------ operator

    def cancel(self, job_id: int) -> bool:
        cur = self.conn.execute(
            "UPDATE jobs SET state = 'cancelled', lease_token = NULL, finished_at = now() "
            "WHERE id = %s AND state IN ('queued', 'running')", (job_id,),
        )
        return cur.rowcount == 1

    def requeue(self, job_id: int) -> bool:
        """Operator retry of a failed or cancelled job, with a fresh attempt budget."""
        cur = self.conn.execute(
            "UPDATE jobs SET state = 'queued', attempts = 0, error = NULL, lease_token = NULL, "
            "lease_expires_at = NULL, run_after = now(), finished_at = NULL "
            "WHERE id = %s AND state IN ('failed', 'cancelled')", (job_id,),
        )
        return cur.rowcount == 1

    def job(self, job_id: int) -> dict | None:
        return self._one("SELECT * FROM jobs WHERE id = %s", (job_id,))

    def jobs(self, limit: int = 20) -> list[dict]:
        return self._all("SELECT * FROM jobs ORDER BY id DESC LIMIT %s", (limit,))

    def events(self, job_id: int) -> list[dict]:
        return self._all("SELECT * FROM job_events WHERE job_id = %s ORDER BY id", (job_id,))

    def latest_timeline(self, project_id: str) -> dict | None:
        return self._one(
            "SELECT * FROM timelines WHERE project_id = %s ORDER BY version DESC LIMIT 1",
            (project_id,),
        )

    # -------------------------------------------------------------- workers

    def touch_worker(self, worker: str, *, hostname: str, pid: int, current_job: int | None) -> None:
        self.conn.execute(
            "INSERT INTO workers (id, hostname, pid, current_job) VALUES (%s, %s, %s, %s) "
            "ON CONFLICT (id) DO UPDATE SET hostname = EXCLUDED.hostname, pid = EXCLUDED.pid, "
            "current_job = EXCLUDED.current_job, last_seen_at = now(), "
            "started_at = CASE WHEN workers.pid = EXCLUDED.pid THEN workers.started_at ELSE now() END",
            (worker, hostname, pid, current_job),
        )

    def workers(self) -> list[dict]:
        return self._all(
            "SELECT *, extract(epoch FROM now() - last_seen_at) AS age_seconds "
            "FROM workers ORDER BY last_seen_at DESC"
        )
