-- How each film is told (pipeline/writer.py NARRATIVES): a life, a mystery,
-- a chronicle, you are there, an explainer. Chosen when the film is created
-- and again whenever a script is asked for; carried into the research and
-- script prompts. Without it Claude's scripts read as lessons.
--
-- No CHECK: the ids live in writer.NARRATIVES, which refuses an unknown one,
-- and adding a narrative should not need a migration. NULL is a film from
-- before this column, written as writer.DEFAULT_NARRATIVE.

ALTER TABLE projects ADD COLUMN narrative text;
