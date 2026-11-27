-- The studio's own sound effects (pipeline/sfx.py), beside the stock ones
-- committed in pipeline/sounds. A person uploads one in the editing room; it
-- goes into the media store at a content address (sounds/<sha>.<ext>, also
-- recorded in `media`, so the worker's mirror fetches it like any other
-- file) and is listed here for everyone in the studio to use.
--
-- A cue on a timeline copies the sound's key, so a cut keeps playing the
-- sound it was made with even after the row is deleted: deleting takes a
-- sound out of the library, not out of any film.

CREATE TABLE sounds (
    id          bigserial PRIMARY KEY,
    name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
    key         text NOT NULL UNIQUE,
    bytes       integer NOT NULL,
    seconds     real NOT NULL,
    created_by  bigint REFERENCES users(id),
    created_at  timestamptz NOT NULL DEFAULT now()
);
