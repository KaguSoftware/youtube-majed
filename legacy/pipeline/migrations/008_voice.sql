-- Who narrates each film, and how (pipeline/tts.py VOICES and PACES). Chosen
-- in the studio when the film is rendered; carried into the render's payload,
-- where it overrides the script's `voice:` line.
--
-- No CHECK, as for narrative (004): the ids live in tts.VOICES and tts.PACES,
-- and adding a voice should not need a migration. NULL is a film from before
-- these columns: the script's voice at the natural pace.

ALTER TABLE projects ADD COLUMN voice text, ADD COLUMN pace text;
