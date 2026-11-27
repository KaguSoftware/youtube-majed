-- Phase 6: publishing to YouTube. PLAN.md section 3, Phase 6.
--
--   publications       one row per "publish this cut", with what YouTube is
--                      told about it. The metadata lives here and not on the
--                      timeline: a cut is immutable and is the film, while a
--                      title is something said about the film, and can be
--                      said again (a second publication of the same cut).
--     version          the cut uploaded. Pinned at the click, so choosing
--                      another cut while the upload runs cannot change it.
--     thumbnail_shot   the shot whose still becomes the thumbnail; NULL lets
--                      YouTube pick a frame.
--     synthetic        status.containsSyntheticMedia: the disclosure that
--                      the film contains realistic altered or synthetic
--                      content. Recorded with the name of who chose it.
--     made_for_kids    status.selfDeclaredMadeForKids, a legal declaration,
--                      so it is asked, not assumed.
--     video_id         set the moment YouTube has the video. A publication
--                      with a video_id is never uploaded again.
--     youtube          what YouTube reported afterwards: the privacy it
--                      actually applied, processing, the thumbnail outcome.
--   jobs.kind          publish: on the light lane, beside research and
--                      script, so an upload never waits behind a render.

ALTER TABLE jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_kind_check
    CHECK (kind IN ('production', 'research', 'script', 'style', 'edit', 'export', 'publish'));

CREATE TABLE publications (
    id              bigserial PRIMARY KEY,
    project_id      text NOT NULL REFERENCES projects(id),
    version         integer NOT NULL,
    title           text NOT NULL,
    description     text NOT NULL DEFAULT '',
    tags            text[] NOT NULL DEFAULT '{}',
    privacy         text NOT NULL CHECK (privacy IN ('private', 'unlisted', 'public')),
    thumbnail_shot  text,
    synthetic       boolean NOT NULL,
    made_for_kids   boolean NOT NULL DEFAULT false,
    requested_by    bigint REFERENCES users(id),
    job_id          bigint REFERENCES jobs(id),
    video_id        text,
    channel_id      text,
    youtube         jsonb NOT NULL DEFAULT '{}',
    uploaded_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (project_id, version) REFERENCES timelines (project_id, version)
);
CREATE INDEX publications_by_project ON publications (project_id, id);
-- The quota check counts today's uploads (Pacific time, YouTube's day).
CREATE INDEX publications_uploaded ON publications (uploaded_at) WHERE uploaded_at IS NOT NULL;
