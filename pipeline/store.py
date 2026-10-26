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


class FilmMoved(RuntimeError):
    """An edit finished on a version that is no longer the film."""


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


#: Every job kind, and the lane each runs on. The GPU lane holds the warm image
#: model; the light lane runs `claude -p` and uploads to YouTube, which need no
#: GPU and should not wait twenty minutes behind someone else's render.
GPU_KINDS = ("production", "style", "edit", "export")
LIGHT_KINDS = ("research", "script", "publish")
#: The light-lane kinds that run `claude -p`.
WRITING_KINDS = ("research", "script")


class Store:
    def __init__(self, url: str | None = None) -> None:
        self.url = url or database_url()
        self.conn = self._connect()

    def _connect(self) -> psycopg.Connection:
        return psycopg.connect(self.url, autocommit=True, row_factory=dict_row)

    def reconnect(self) -> None:
        """Replace a connection the server dropped.

        Neon closes connections when an idle compute scales to zero, which on
        the free tier is the normal state of an idle worker's database. The
        worker calls this when a poll fails with an OperationalError and
        tries again, rather than treating the database as down.
        """
        try:
            self.conn.close()
        except Exception:
            pass
        self.conn = self._connect()

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

    #: The project state a job of each kind belongs to. Enqueueing moves the
    #: project there, so the studio shows the stage the work is happening in.
    STATE_FOR_KIND = {"production": "production", "style": "style",
                      "research": "staging", "script": "scripting",
                      "edit": "editing", "export": "editing", "publish": "finalized"}

    def enqueue(self, project_id: str, kind: str, payload: dict, *, max_attempts: int = 3) -> int:
        with self.conn.transaction():
            row = self._one(
                "INSERT INTO jobs (project_id, kind, payload, max_attempts) "
                "VALUES (%s, %s, %s, %s) RETURNING id",
                (project_id, kind, Jsonb(payload), max_attempts),
            )
            # Posted stays posted: publishing again does not undo the first video.
            self.conn.execute("UPDATE projects SET state = CASE WHEN state = 'posted' AND %s = 'publish' "
                              "THEN state ELSE %s END, updated_at = now() WHERE id = %s",
                              (kind, self.STATE_FOR_KIND[kind], project_id))
        return row["id"]

    def claim(self, worker: str, lease_seconds: float, *, reclaim_own: bool = False,
              fake: bool = False, kinds: tuple[str, ...] | None = None) -> Claim | None:
        """Take the oldest runnable job, or reclaim one whose lease ran out.

        `reclaim_own` is for a worker's first poll after starting. The worker
        holds a per-host lock (see worker.py), so a job still marked running
        under this worker's id belongs to a process that is certainly dead —
        there is no reason to sit out the rest of its lease before resuming.

        `fake` partitions the queue: a weights-free worker only takes jobs
        enqueued for it, and a real worker never does. Otherwise a smoke test
        left running could pick up a real job and publish a timeline of noise.

        `kinds` restricts the claim to one lane's job kinds; None takes any.
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
                      AND (%(kinds)s::text[] IS NULL OR kind = ANY(%(kinds)s::text[]))
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
                {"own": reclaim_own, "worker": worker, "lease": lease_seconds, "fake": fake,
                 "kinds": list(kinds) if kinds else None},
            )
        if row is None:
            return None
        return Claim(
            job_id=row["id"], project_id=row["project_id"], kind=row["kind"],
            payload=row["payload"], checkpoint=row["checkpoint"], attempts=row["attempts"],
            max_attempts=row["max_attempts"], token=str(row["lease_token"]), worker=worker,
        )

    def next_due(self, *, fake: bool = False, kinds: tuple[str, ...] | None = None):
        """When the queue next has something for this lane without anyone
        enqueuing: a retry's backoff ending, or a dead worker's lease running
        out. None if nothing is pending.

        A worker on the doorbell only reads the database when the bell rings,
        and the bell rings on enqueue. These two cases change state with no
        enqueue, so the worker schedules its next poll for this moment.
        """
        row = self._one(
            "SELECT min(CASE WHEN state = 'queued' THEN run_after ELSE lease_expires_at END) AS at "
            "FROM jobs WHERE state IN ('queued', 'running') "
            "AND coalesce((payload->>'fake')::boolean, false) = %(fake)s "
            "AND (%(kinds)s::text[] IS NULL OR kind = ANY(%(kinds)s::text[]))",
            {"fake": fake, "kinds": list(kinds) if kinds else None},
        )
        return row["at"] if row else None

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
            self.conn.execute("UPDATE projects SET state = 'editing', timeline_version = %s, "
                              "updated_at = now() WHERE id = %s", (version, claim.project_id))
        return version

    def finish_edit(self, claim: Claim, timeline_json: dict, *, parent: int, change: dict,
                    created_by: int | None) -> int:
        """Add an edited version on top of `parent` and make it the film, all
        or nothing. Refused if the film moved off `parent` while the edit ran
        (an undo, or a new render): committing anyway would silently throw
        that away."""
        with self.conn.transaction():
            self._fenced(
                claim,
                "state = 'done', finished_at = now(), lease_token = NULL, error = NULL, "
                "progress = progress || '{\"stage\": \"done\"}'::jsonb",
            )
            current = self._one("SELECT timeline_version FROM projects WHERE id = %s FOR UPDATE",
                                 (claim.project_id,))
            if current is None or current["timeline_version"] != parent:
                raise FilmMoved(f"the film is at version {current and current['timeline_version']}, "
                                f"not {parent}, which this edit was made on")
            version = self._one(
                "SELECT coalesce(max(version), 0) + 1 AS v FROM timelines WHERE project_id = %s",
                (claim.project_id,),
            )["v"]
            self.conn.execute(
                "INSERT INTO timelines (project_id, version, timeline_json, job_id, parent_version, "
                " change, created_by) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (claim.project_id, version, Jsonb(timeline_json), claim.job_id, parent,
                 Jsonb(change), created_by),
            )
            self.conn.execute("UPDATE projects SET timeline_version = %s, updated_at = now() "
                              "WHERE id = %s", (version, claim.project_id))
        return version

    def finish_job(self, claim: Claim) -> None:
        """Close a job that produced nothing to store (an edit Claude decided
        not to make); its outcome is in its events."""
        self._fenced(
            claim,
            "state = 'done', finished_at = now(), lease_token = NULL, error = NULL, "
            "progress = progress || '{\"stage\": \"done\"}'::jsonb",
        )

    def finish_export(self, claim: Claim, *, film_key: str, size: int) -> None:
        """An mp4 of one version is in the store; the job records where."""
        self._fenced(
            claim,
            "state = 'done', finished_at = now(), lease_token = NULL, error = NULL, "
            "checkpoint = checkpoint || jsonb_build_object('film', %(k)s::text, 'size', %(n)s::bigint), "
            "progress = progress || '{\"stage\": \"done\"}'::jsonb",
            {"k": film_key, "n": size},
        )

    # ------------------------------------------------------------ publishing

    def add_publication(self, project_id: str, version: int, *, title: str, description: str,
                        tags: list[str], privacy: str, thumbnail_shot: str | None, synthetic: bool,
                        made_for_kids: bool = False, requested_by: int | None = None,
                        fake: bool = False) -> tuple[int, int]:
        """A publication and the job that uploads it, together. The studio
        writes the same two rows (web/app/(studio)/films/[id]/publish-actions.ts).
        -> (publication id, job id)"""
        with self.conn.transaction():
            pub = self._one(
                "INSERT INTO publications (project_id, version, title, description, tags, privacy, "
                " thumbnail_shot, synthetic, made_for_kids, requested_by) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (project_id, version, title, description, tags, privacy, thumbnail_shot, synthetic,
                 made_for_kids, requested_by))["id"]
            job = self.enqueue(project_id, "publish", {"publication_id": pub, **({"fake": True} if fake else {})},
                               max_attempts=3)
            self.conn.execute("UPDATE publications SET job_id = %s WHERE id = %s", (job, pub))
        return pub, job

    def publication(self, pub_id: int) -> dict | None:
        return self._one("SELECT * FROM publications WHERE id = %s", (pub_id,))

    def uploads_today(self) -> int:
        """Upload sessions opened since midnight Pacific, when YouTube's day
        starts: what the Video Uploads bucket has been charged."""
        return self._one(
            "SELECT count(*) AS n FROM publications WHERE (youtube->>'session_at')::timestamptz >= "
            "(date_trunc('day', now() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles')"
        )["n"]

    def publish_session(self, claim: Claim, pub_id: int, *, session: str, size: int) -> None:
        """An upload session is open. Recorded before any bytes are sent, so a
        resumed job continues it instead of uploading the film a second time."""
        with self.conn.transaction():
            self._fenced(claim, "checkpoint = checkpoint || jsonb_build_object('upload', %(u)s::jsonb)",
                         {"u": Jsonb({"session": session, "size": size})})
            # On the publication too: "try again" in the studio is a new job,
            # and it must resume this session, not open a second upload.
            self.conn.execute(
                "UPDATE publications SET youtube = youtube || jsonb_build_object("
                "'session_at', now(), 'session', %s::text, 'size', %s::bigint) WHERE id = %s",
                (session, size, pub_id))

    def set_published(self, claim: Claim, pub_id: int, *, video_id: str, channel_id: str | None,
                      youtube: dict) -> None:
        """YouTube has the video. From here the publication is never uploaded
        again, and the film is posted."""
        with self.conn.transaction():
            self._fenced(claim, "checkpoint = checkpoint || jsonb_build_object('video_id', %(v)s::text)",
                         {"v": video_id})
            self.record_video(claim.project_id, pub_id, video_id=video_id, channel_id=channel_id,
                              youtube=youtube)

    def record_video(self, project_id: str, pub_id: int, *, video_id: str, channel_id: str | None,
                     youtube: dict) -> None:
        """The video exists on YouTube. Unfenced on its own: when a publish is
        stopped just as its last bytes go, the job is no longer ours, but the
        video is real, and the studio must not say nothing was posted."""
        self.conn.execute(
            "UPDATE publications SET video_id = %s, channel_id = %s, uploaded_at = now(), "
            "youtube = youtube || %s WHERE id = %s AND video_id IS NULL",
            (video_id, channel_id, Jsonb(youtube), pub_id))
        self.conn.execute("UPDATE projects SET state = 'posted', updated_at = now() WHERE id = %s",
                          (project_id,))

    def finish_publish(self, claim: Claim, pub_id: int, youtube: dict) -> None:
        """Close the job with what YouTube reported after the upload."""
        with self.conn.transaction():
            self._fenced(
                claim,
                "state = 'done', finished_at = now(), lease_token = NULL, error = NULL, "
                "progress = progress || '{\"stage\": \"done\"}'::jsonb",
            )
            self.conn.execute("UPDATE publications SET youtube = youtube || %s WHERE id = %s",
                              (Jsonb(youtube), pub_id))

    def timeline(self, project_id: str, version: int) -> dict | None:
        return self._one("SELECT * FROM timelines WHERE project_id = %s AND version = %s",
                         (project_id, version))

    def record_prompt(self, *, project_id: str, kind: str, prompt: str, response_raw: str,
                      job_id: int | None, meta: dict) -> None:
        self.conn.execute(
            "INSERT INTO prompt_log (project_id, kind, prompt_text, response_raw, hash, job_id, meta) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (project_id, kind, prompt, response_raw, text_sha(prompt), job_id, Jsonb(meta)),
        )

    def finish_document(self, claim: Claim, *, kind: str, markdown: str, verdict: dict,
                        upstream_hash: str | None, prompt: str, response_raw: str,
                        meta: dict) -> dict:
        """Store what Claude wrote and close the job, all or nothing.

        The artifact, its prompt_log row and the job's completion commit in one
        transaction, fenced on the lease. A worker that lost its lease cannot
        add a version, and a crash between the three cannot leave a document
        without its prompt or a finished job without its document.
        """
        with self.conn.transaction():
            self._fenced(
                claim,
                "state = 'done', finished_at = now(), lease_token = NULL, error = NULL, "
                "progress = progress || '{\"stage\": \"done\"}'::jsonb",
            )
            self.conn.execute("SELECT 1 FROM projects WHERE id = %s FOR UPDATE", (claim.project_id,))
            version = self._one(
                "SELECT coalesce(max(version), 0) + 1 AS v FROM artifacts "
                "WHERE project_id = %s AND kind = %s", (claim.project_id, kind))["v"]
            row = self._one(
                "INSERT INTO artifacts (project_id, kind, version, markdown_raw, content_sha, "
                " parsed_json, doc_status, upstream_hash, validator_report, source, job_id) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'claude', %s) RETURNING *",
                (claim.project_id, kind, version, markdown, text_sha(markdown),
                 Jsonb(verdict.get("parsed")), verdict["doc_status"], upstream_hash,
                 Jsonb({"errors": verdict["errors"], "warnings": verdict["warnings"],
                        "sources_checked": verdict.get("sources_checked")}), claim.job_id),
            )
            self.conn.execute(
                "INSERT INTO prompt_log (project_id, kind, prompt_text, response_raw, hash, "
                " job_id, artifact_id, meta) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                (claim.project_id, kind, prompt, response_raw, text_sha(prompt), claim.job_id,
                 row["id"], Jsonb(meta)),
            )
            self.conn.execute("UPDATE projects SET updated_at = now() WHERE id = %s", (claim.project_id,))
        return row

    def finish_style(self, claim: Claim, *, candidates: list[dict], preset_id: str | None,
                     beat_id: str, prompt_prefix: str) -> dict:
        """Record a set of candidate looks and close the job, all or nothing.
        The images are already in the media store (upload first, pointer second)."""
        with self.conn.transaction():
            self._fenced(
                claim,
                "state = 'done', finished_at = now(), lease_token = NULL, error = NULL, "
                "progress = progress || '{\"stage\": \"done\"}'::jsonb",
            )
            row = self._one(
                "INSERT INTO style_runs (project_id, candidates_json, job_id, preset_id, beat_id, prompt_prefix) "
                "VALUES (%s, %s, %s, %s, %s, %s) RETURNING *",
                (claim.project_id, Jsonb(candidates), claim.job_id, preset_id, beat_id, prompt_prefix),
            )
            self.conn.execute("UPDATE projects SET updated_at = now() WHERE id = %s", (claim.project_id,))
        return row

    def set_style_crop(self, style_id: str, crop_key: str) -> None:
        """The worker fills in a project style's hero crop the first time it is
        needed. Idempotent: the crop is a pure function of the frame and box."""
        self.conn.execute(
            "UPDATE styles SET preset_json = preset_json || jsonb_build_object('hero_crop', %s::text) "
            "WHERE id = %s", (crop_key, style_id))

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

    def current_timeline(self, project_id: str) -> dict | None:
        """The version the film is (projects.timeline_version), which after an
        undo is not the newest one."""
        return self._one(
            "SELECT t.* FROM timelines t JOIN projects p ON p.id = t.project_id "
            "AND t.version = p.timeline_version WHERE p.id = %s", (project_id,),
        )

    # -------------------------------------------------------------- workers

    def touch_worker(self, worker: str, *, hostname: str, pid: int, current_job: int | None,
                     kinds: tuple[str, ...] = GPU_KINDS, health: dict | None = None) -> None:
        """`health` replaces the stored report when given and is kept when not,
        so the heartbeat thread need not carry it (migration 006)."""
        self.conn.execute(
            "INSERT INTO workers (id, hostname, pid, current_job, kinds, health) "
            "VALUES (%s, %s, %s, %s, %s, %s) "
            "ON CONFLICT (id) DO UPDATE SET hostname = EXCLUDED.hostname, pid = EXCLUDED.pid, "
            "current_job = EXCLUDED.current_job, kinds = EXCLUDED.kinds, last_seen_at = now(), "
            "health = COALESCE(EXCLUDED.health, workers.health), "
            "started_at = CASE WHEN workers.pid = EXCLUDED.pid THEN workers.started_at ELSE now() END",
            (worker, hostname, pid, current_job, list(kinds), Jsonb(health) if health is not None else None),
        )

    def workers(self) -> list[dict]:
        return self._all(
            "SELECT *, extract(epoch FROM now() - last_seen_at) AS age_seconds "
            "FROM workers ORDER BY last_seen_at DESC"
        )

    # ---------------------------------------------------------------- media

    def media_size(self, store: str, key: str) -> int | None:
        row = self._one("SELECT size FROM media WHERE store = %s AND key = %s", (store, key))
        return row["size"] if row else None

    def media_record(self, store: str, key: str, *, size: int, kind: str,
                     project_id: str | None = None, job_id: int | None = None) -> None:
        """Called after the upload succeeded, never before (failure mode 9)."""
        self.conn.execute(
            "INSERT INTO media (store, key, size, kind, project_id, job_id) "
            "VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (store, key) DO NOTHING",
            (store, key, size, kind, project_id, job_id),
        )


class MediaIndex:
    """`media.Index` over the `media` table for one remote store, attributing
    uploads to one job."""

    def __init__(self, store: Store, remote: str, *, project_id: str | None = None,
                 job_id: int | None = None):
        self.store, self.remote = store, remote
        self.project_id, self.job_id = project_id, job_id

    def size(self, key: str) -> int | None:
        return self.store.media_size(self.remote, key)

    def known(self, key: str) -> bool:
        return self.size(key) is not None

    def known_many(self, keys: list[str]) -> set[str]:
        rows = self.store._all("SELECT key FROM media WHERE store = %s AND key = ANY(%s)",
                               (self.remote, list(keys)))
        return {r["key"] for r in rows}

    def record(self, key: str, *, size: int, kind: str) -> None:
        self.store.media_record(self.remote, key, size=size, kind=kind,
                                project_id=self.project_id, job_id=self.job_id)
