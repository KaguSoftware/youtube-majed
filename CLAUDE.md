# Studio (v2): project rules

A personal tool for Majed's YouTube channel. One user, one Mac (M3 Pro, 36 GB).
Nothing here is sold or shared; optimise for the result and for simplicity, not
for scale or multi-tenancy.

## Source of truth

- `docs/PLAN.md` is the plan. Follow it. If something in it looks wrong or
  impossible, say so and propose an alternative. Don't silently change it.
- Build **phase by phase** (plan section 11). Stop at each phase gate and wait
  for Majed's verdict before starting the next phase.
- `legacy/` is the v1 system: **read-only reference**. Never edit, move or
  delete anything in it. `legacy/INVENTORY.md` lists what is worth reusing.

## Code

- TypeScript `strict` everywhere (`tsconfig.base.json`). pnpm workspaces:
  `app`, `worker`, `remotion`, `packages/*`.
- Python only where the audio models need it (`audio/`), in its own venv.
- **Validate all JSON with zod** at every boundary (files read from disk,
  Claude output, API input). The schemas live in `packages/schema`, and the
  JSON Schemas in `engine/schemas/` are generated from them, not hand-written.
- The library catalogue (`packages/schema/src/catalogue.ts`) is the only list
  of ids that scene JSON may use. Adding a library item means adding it there
  and implementing it in `remotion/`; TypeScript enforces that the two match.
- Scenes carry no timing. Timing comes from word timestamps (Phase 1+), or
  from a separate `timing.json` in Phase 0.
- All frontend/UI work goes through the `/impeccable` skill.

## Process

- Keep commits small, with clear conventional messages (`feat:`, `fix:`,
  `chore:`, `docs:`).
- Ask before deleting any file. Moving into `legacy/` is fine.
- Never commit secrets. `.env*` is gitignored; reference env vars by name only.
- `projects/`, `assets/{sfx,music,voices}/` and `renders/` are local only (gitignored).

## Commands

```bash
pnpm install
pnpm studio            # Remotion Studio (preview the library and samples)
pnpm validate          # validate sample scene files
pnpm render            # final 1080p render of the lighthouse sample
pnpm render:preview    # fast 720p preview render
pnpm typecheck
pnpm test              # all unit tests (story engine tests use a fake claude)
pnpm schemas           # regenerate engine/schemas/*.json from packages/schema
pnpm worker            # job worker for the app (127.0.0.1:8766)
pnpm app               # the Studio website (http://localhost:3100)
pnpm story <command>   # the story engine without the UI (pnpm story for help)
pnpm story storyboard <id>   # scene JSON for a locked script (Phase 3)
pnpm assets seed|index # the sound library: assets/sources.json -> assets/index.sqlite
pnpm mix <id>          # sound design: SFX, risers, ambience, music, -14 LUFS (cached)
pnpm render:project <id>     # preview render of a storyboarded project with its mix
```
