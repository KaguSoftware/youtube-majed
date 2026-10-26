-- Phase 5: hardening. PLAN.md section 3, Phase 5.
--
--   workers.health  what the worker last found wrong with itself, for the
--                   studio's machine banner. Written on the polls the worker
--                   makes anyway, never on a timer of its own, so an idle
--                   worker still leaves the database asleep (PLAN.md 11.2).
--                     pins   {problems, notes}: drift from requirements.lock
--                            or pins.lock.json (pipeline/pins.py). A problem
--                            stops the worker claiming anything.
--                     smoke  the last smoke test (pipeline/smoke.py). A
--                            failure stops it claiming GPU work until a later
--                            run passes; drift is reported, not blocking.
--                   NULL until a Phase 5 worker has reported.

ALTER TABLE workers ADD COLUMN health jsonb;
