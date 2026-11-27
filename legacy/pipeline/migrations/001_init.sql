-- Phase 2 schema. DESIGN.md "Schema sketch", plus what the job queue needs to
-- survive a worker that dies mid-job (PLAN.md failure mode 4).
--
-- Additions over the sketch, each one load-bearing:
--
--   jobs.lease_token       fences every write a worker makes. A worker that was
--                          frozen (lid closed, SIGSTOP) and wakes after its job
--                          was reclaimed must not be able to write over the new
--                          owner's progress. Heartbeat alone cannot tell the
--                          two apart; a token that changes on every claim can.
--   jobs.lease_expires_at  reclaim is "the lease ran out", not "the heartbeat
--                          is old by some number the reader picked".
--   jobs.attempts          a job that kills its worker every time (OOM on one
--                          prompt) must stop being retried eventually.
--   jobs.checkpoint        per-stage outputs, so a resumed job knows where it is.
--                          The bytes themselves are content-addressed on disk,
--                          which is what actually makes resume free.
--   job_events             append-only per-attempt log. Phase 3's progress view
--                          streams it, and it is the evidence for the Phase 2
--                          exit criterion: which shots a resumed attempt
--                          generated and which it took from the cache.
--   workers                one row per worker, touched on every poll. Failure
--                          mode 4's "worker-offline banner from heartbeat age"
--                          reads this, independent of whether a job is running.

CREATE TABLE styles (
    id           text PRIMARY KEY,
    name         text NOT NULL,
    preset_json  jsonb NOT NULL,
    is_library   boolean NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
    id               text PRIMARY KEY,
    topic            text NOT NULL,
    angle            text,
    target_duration  real,
    state            text NOT NULL DEFAULT 'idea' CHECK (state IN (
                         'idea', 'staging', 'scripting', 'style',
                         'production', 'editing', 'finalized', 'posted')),
    style_id         text REFERENCES styles(id),
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- Immutable versions. A job pins the exact artifact ids it was enqueued
-- against, so an edit after enqueue cannot change what a running job reads
-- (DESIGN.md "Staleness").
CREATE TABLE artifacts (
    id                bigserial PRIMARY KEY,
    project_id        text NOT NULL REFERENCES projects(id),
    kind              text NOT NULL CHECK (kind IN ('research', 'script')),
    version           integer NOT NULL,
    markdown_raw      text NOT NULL,
    content_sha       text NOT NULL,
    parsed_json       jsonb,
    doc_status        text NOT NULL CHECK (doc_status IN (
                          'awaiting', 'invalid', 'valid', 'approved')),
    upstream_hash     text,
    validator_report  jsonb,
    approved_at       timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, kind, version)
);

CREATE TABLE style_runs (
    id               bigserial PRIMARY KEY,
    project_id       text NOT NULL REFERENCES projects(id),
    candidates_json  jsonb NOT NULL DEFAULT '[]',
    selected_seed    integer,
    hero_blob        text,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
    id                bigserial PRIMARY KEY,
    project_id        text NOT NULL REFERENCES projects(id),
    kind              text NOT NULL CHECK (kind IN ('production')),
    state             text NOT NULL DEFAULT 'queued' CHECK (state IN (
                          'queued', 'running', 'done', 'failed', 'cancelled')),
    payload           jsonb NOT NULL DEFAULT '{}',
    progress          jsonb NOT NULL DEFAULT '{}',
    checkpoint        jsonb NOT NULL DEFAULT '{}',
    claimed_by        text,
    lease_token       uuid,
    lease_expires_at  timestamptz,
    heartbeat_at      timestamptz,
    attempts          integer NOT NULL DEFAULT 0,
    max_attempts      integer NOT NULL DEFAULT 3,
    run_after         timestamptz NOT NULL DEFAULT now(),
    error             text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    started_at        timestamptz,
    finished_at       timestamptz
);

-- The claim query scans only live jobs.
CREATE INDEX jobs_live ON jobs (created_at) WHERE state IN ('queued', 'running');

-- Two production jobs for one project would race on the same run directory
-- and the same timeline version number.
CREATE UNIQUE INDEX jobs_one_live_per_project
    ON jobs (project_id, kind) WHERE state IN ('queued', 'running');

CREATE TABLE job_events (
    id       bigserial PRIMARY KEY,
    job_id   bigint NOT NULL REFERENCES jobs(id),
    attempt  integer NOT NULL,
    worker   text,
    kind     text NOT NULL,
    data     jsonb NOT NULL DEFAULT '{}',
    at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_events_by_job ON job_events (job_id, id);

CREATE TABLE timelines (
    id             bigserial PRIMARY KEY,
    project_id     text NOT NULL REFERENCES projects(id),
    version        integer NOT NULL,
    timeline_json  jsonb NOT NULL,
    job_id         bigint REFERENCES jobs(id),
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, version)
);

CREATE TABLE workers (
    id            text PRIMARY KEY,
    hostname      text NOT NULL,
    pid           integer NOT NULL,
    started_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    current_job   bigint REFERENCES jobs(id)
);

CREATE TABLE prompt_log (
    id            bigserial PRIMARY KEY,
    project_id    text REFERENCES projects(id),
    kind          text NOT NULL,
    prompt_text   text NOT NULL,
    response_raw  text,
    hash          text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);
