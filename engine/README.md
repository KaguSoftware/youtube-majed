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

- `.claude/skills/plan-scenes`: the storyboard (Phase 3). Step `cast` plans
  the cast, locations, music mood per loop and plant shots once per video;
  step `storyboard` writes scene JSON for one batch of loops. The library it
  may use is generated from `packages/schema/src/catalogue.ts` at run time
  and sent with the input, so new library items show up without editing the
  skill. Code then maps unknown ids, repairs, adds head-fake payoffs and runs
  the variety guard (`worker/src/storyboard.ts`).

- `.claude/skills/reel-cut`: a 60 to 90 second Reel from a finished long video
  (Phase 4). Picks the strongest loop from the critic's scores and the loop
  map, chooses the existing lines to keep, and may add one hook and one ending
  line. Code checks the result and builds the child project
  (`worker/src/reel-cut.ts`).

- `.claude/skills/custom-shot`: a one-off Remotion component for one moment the library cannot show (Phase 5).
  One call per shot, no tools, the kit's API in the skill. Code lints its imports, typechecks it and draws it alone
  in both frames before it is used; a failure falls back to the library scene (`worker/src/custom-shots.ts`).

- Variety across videos (Phase 5): `plan-scenes` reads an `avoid` input (what the
  last videos leaned on) as a strong preference. The lists and the score are
  code, in `worker/src/variety.ts` (`pnpm variety`).
