-- Phase 3: what the web app and the media store need. PLAN.md section 3.
--
--   jobs.kind            research and script run `claude -p` on the worker's
--                        light lane; style generates hero candidates on the
--                        GPU lane. Same queue, same lease and fence.
--   users                named accounts. The audit trail needs a name: who
--                        promoted a document past its validator, who demoted
--                        a stage and why.
--   artifacts.*          how the slot was filled (paste, claude, seed), by
--                        whom, and any validator override with the errors it
--                        overrode, so "promote anyway" is never silent.
--   project_events       promote / demote / override log per project.
--   media                the index of what the Blob store holds. Written
--                        after each upload (upload first, pointer second), it
--                        spares metered `head` calls and lets the UI show
--                        usage against the free tier's 1 GB without listing
--                        the store.
--   prompt_log.*         ties each `claude -p` call to its job and artifact.
--   workers.kinds        which lane a worker serves, for the offline banner.

ALTER TABLE jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_kind_check
    CHECK (kind IN ('production', 'research', 'script', 'style'));

CREATE TABLE users (
    id             bigserial PRIMARY KEY,
    username       text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9][a-z0-9_.-]{1,31}$'),
    display_name   text NOT NULL,
    password_hash  text NOT NULL,
    -- Bumped to sign a user out everywhere: sessions carry the epoch they
    -- were issued under.
    session_epoch  integer NOT NULL DEFAULT 0,
    disabled_at    timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE projects
    ADD COLUMN hero_beat   text,
    ADD COLUMN created_by  bigint REFERENCES users(id),
    ADD COLUMN updated_at  timestamptz NOT NULL DEFAULT now();

ALTER TABLE artifacts
    ADD COLUMN source       text NOT NULL DEFAULT 'paste'
                            CHECK (source IN ('paste', 'claude', 'seed')),
    ADD COLUMN created_by   bigint REFERENCES users(id),
    ADD COLUMN approved_by  bigint REFERENCES users(id),
    ADD COLUMN override     jsonb,
    ADD COLUMN job_id       bigint REFERENCES jobs(id);
-- Everything before this migration came from `jobs seed`.
UPDATE artifacts SET source = 'seed';

CREATE TABLE project_events (
    id          bigserial PRIMARY KEY,
    project_id  text NOT NULL REFERENCES projects(id),
    kind        text NOT NULL,
    from_state  text,
    to_state    text,
    reason      text,
    data        jsonb NOT NULL DEFAULT '{}',
    user_id     bigint REFERENCES users(id),
    at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_events_by_project ON project_events (project_id, id);

ALTER TABLE style_runs
    ADD COLUMN job_id         bigint REFERENCES jobs(id),
    ADD COLUMN preset_id      text REFERENCES styles(id),
    ADD COLUMN beat_id        text,
    ADD COLUMN prompt_prefix  text;

-- Keyed by store as well as key: the index describes one store, and pointing
-- the worker at a new or emptied store must not inherit the old one's rows,
-- or nothing would be uploaded to it.
CREATE TABLE media (
    store       text NOT NULL,
    key         text NOT NULL,
    size        bigint NOT NULL,
    kind        text NOT NULL,
    project_id  text REFERENCES projects(id),
    job_id      bigint REFERENCES jobs(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (store, key)
);

ALTER TABLE prompt_log
    ADD COLUMN job_id       bigint REFERENCES jobs(id),
    ADD COLUMN artifact_id  bigint REFERENCES artifacts(id),
    ADD COLUMN meta         jsonb NOT NULL DEFAULT '{}';

ALTER TABLE workers ADD COLUMN kinds text[] NOT NULL DEFAULT '{production}';
