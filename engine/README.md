# engine/

The Claude Code working folder. Every story step runs here, headless, as

```
claude -p "/<skill> step: <name> …input JSON…" --model sonnet \
  --output-format json --json-schema "$(cat schemas/<step>.json)"
```

started by the worker (`worker/src/claude.ts`), never by hand. Only this
folder's `CLAUDE.md` is loaded: the runner excludes the repo's and the
user's CLAUDE.md files (those are rules for developing Studio, not for
writing stories).

- `CLAUDE.md`: the retention loop, the length budget, the voice rules and the
  id conventions every step shares.
- `.claude/skills/write-story`: master loop options → loop map → narration,
  as separate steps, plus "rewrite these lines with a direction".
- `.claude/skills/fact-check`: web-searched fact check (true stories) or
  internal consistency check (fiction).
- `.claude/skills/critic`: retention scores per loop, the weakest three
  moments with rewrites.
- `schemas/`: one JSON Schema per step, **generated** from the zod schemas in
  `packages/schema/src/story.ts` by `pnpm schemas`. A test fails when they
  are out of date.

`plan-scenes` arrives in Phase 3 and `custom-shot` in Phase 5 (docs/PLAN.md).
