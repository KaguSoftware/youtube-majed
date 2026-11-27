# engine/

The Claude Code working folder. Each pipeline step runs here as
`claude -p "<step prompt>" --output-format json --json-schema schemas/<step>.json`.

- `CLAUDE.md`: loop rules, JSON formats and the library catalogue
- `.claude/skills/`: write-story, fact-check, critic, plan-scenes, custom-shot
- `schemas/`: one JSON Schema per step, generated from the zod schemas in
  `packages/schema`

Built in **Phase 2** (story engine and review); `plan-scenes` in **Phase 3**,
`custom-shot` in **Phase 5**. See `docs/PLAN.md` sections 3, 4, 6 and 10.
