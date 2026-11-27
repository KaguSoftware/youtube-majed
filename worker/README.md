# worker/

The Node job worker: takes one job at a time from the SQLite queue, runs the
`claude -p` steps inside `engine/`, validates their JSON with
`@studio/schema`, and logs Claude usage per step.

Built in **Phase 2** (story engine), extended in **Phase 3** (full pipeline).
See `docs/PLAN.md` section 10. Empty until then.
