-- Phase 4: the editing page. PLAN.md section 3, Phase 4.
--
--   timelines.parent_version  the version an edit was made on. Versions stay
--                             immutable; an edit adds one. A production
--                             render starts a new line (NULL parent).
--   timelines.change          what made this version: the request in the
--                             user's words, Claude's summary, the operations
--                             it applied. NULL for a render.
--   timelines.created_by      who asked for it.
--   projects.timeline_version the version the film *is*. Undo moves this
--                             pointer to the parent and costs nothing: every
--                             version's chunks are already in the store. An
--                             edit made after an undo branches from there,
--                             and the undone version stays in the history.
--   jobs.kind                 edit: Claude changes the timeline through tools
--                             and the worker repaints and re-cuts what changed.
--                             export: one mp4 of a version, for download.

ALTER TABLE timelines
    ADD COLUMN parent_version  integer,
    ADD COLUMN change          jsonb,
    ADD COLUMN created_by      bigint REFERENCES users(id);

ALTER TABLE projects ADD COLUMN timeline_version integer;
UPDATE projects p SET timeline_version = (
    SELECT max(version) FROM timelines t WHERE t.project_id = p.id);

ALTER TABLE jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_kind_check
    CHECK (kind IN ('production', 'research', 'script', 'style', 'edit', 'export'));
