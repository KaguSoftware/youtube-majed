# worker/

Runs the story engine's `claude -p` steps inside `engine/`, validates every
answer with `@studio/schema` (zod), saves it under `projects/<id>/`, and logs
Claude usage per step. One job at a time.

## Claude runs on the subscription, never the API

Every step is a child process `claude -p … --output-format json
--json-schema <schema>` (`src/claude.ts`). **`ANTHROPIC_API_KEY` and
`ANTHROPIC_AUTH_TOKEN` are removed from the child's environment**, so the CLI
uses its own sign-in (your Claude subscription in the keychain) even if a key
is set in your shell. `--bare` is never used, because bare mode skips the
keychain. A test (`src/runner.test.ts`) sets a key in the parent and checks
that the child never sees it.

Each run also:

- loads only `engine/CLAUDE.md` (the repo's and your global CLAUDE.md are
  excluded via `claudeMdExcludes`), project settings only, no MCP servers, no
  saved session;
- has no tools, except the fact-check of a true story (`WebSearch`,
  `WebFetch`);
- retries once if the output fails zod, sending the validator's errors back;
  a usage limit or sign-in problem is not retried;
- keeps the prompt and the raw CLI result in `projects/<id>/runs/`.

Environment variables (names only):

| Variable | Default | |
| --- | --- | --- |
| `STUDIO_CLAUDE_MODEL` | `sonnet` | model for every step |
| `STUDIO_CLAUDE_MODEL_<STEP>` | | per step, e.g. `STUDIO_CLAUDE_MODEL_FACTCHECK=opus` |
| `STUDIO_CLAUDE_EFFORT` | (CLI default) | `--effort` for every step |
| `STUDIO_CLAUDE_EFFORT_<STEP>` | | per step. An option, unset by default: `STUDIO_CLAUDE_EFFORT_NARRATION=medium` cuts the narration step's thinking (most of its ~41k output tokens for an 8-minute script at Gate 2) |
| `STUDIO_CLAUDE_BIN` | `claude` | tests point it at `fake/claude.mjs` |
| `STUDIO_PROJECTS_DIR` | `projects/` | tests use a temp folder |

## Commands

```bash
pnpm story new "<sentence>" --type <narrative> --format youtube|reel --minutes N [--true|--fiction]
pnpm story pick <id> <A|B|C>      # loop map + narration, then the loop checker
pnpm story check <id>             # loop checker; writes projects/<id>/tension.svg
pnpm story review <id>            # fact-check + critic in parallel; a failed review sends the flagged lines back
pnpm story rewrite <id> L2.3,L2.4 "make this the reveal"
pnpm story accept|reject <id> <comment>
pnpm story lock <id>              # writes projects/<id>/script.json for pnpm voice
pnpm story usage [<id>]
pnpm story storyboard <id> [--force]   # cast + scene JSON for the locked script (Phase 3)
pnpm mix <id> [--force]              # sound design: plan + mix, cached (Phase 3)
pnpm voice <id> [--line L3.4]        # the voice step without the UI (needs the audio service)
pnpm worker                       # the same steps as an HTTP API for the app, one job at a time
```

The worker's job queue lives in SQLite (`projects/studio.sqlite`, local
only, `src/queue.ts`, via `node:sqlite`, so nothing native to build). A job
stores its kind and arguments; if the worker stops, jobs that were queued,
waiting or running are resumed on the next start.

A finished step is not run again for the same input (`projects/<id>/steps.json`
keeps the input hash); `--force` redoes it. An edited narration is never
overwritten by a new one without `--force`. The CLI and the worker share one
lock file, so only one Claude job runs at a time on the machine.

## Storyboard (Phase 3)

`pnpm story storyboard <id>` (or `POST /projects/:id/storyboard`, a queued
job) runs the `plan-scenes` skill in two steps and checks the result in code
(`src/storyboard.ts`):

1. `cast`, one call: the cast (each look as JSON following the live
   `CastMember` schema, sent as JSON Schema), each loop's locations, grade and
   music mood, and how each plant is shown.
2. `storyboard`, one call per batch of whole loops (at most 40 lines,
   `STUDIO_STORYBOARD_BATCH_LINES`), three at a time
   (`STUDIO_STORYBOARD_CONCURRENCY`). The library is generated from
   `catalogue.ts` on every run, so new items show up without edits.
3. Code: unknown ids → the closest library item (flagged); repairs that keep a
   shot's meaning (a held prop with no hand, a `to` on an action that doesn't
   travel, a line skipped inside a scene's range); every head-fake line starts
   its own shot with a reveal device; the variety guard (below).
4. One repair call for the scenes code could not fix and the repeated
   pictures; anything still broken gets a plain fallback shot, flagged.
5. `projects/<id>/storyboard/scenes.json` (strict `SceneFile`) and
   `storyboard.json` (music moods, reveal words, flags, stats). Claude's drafts
   are kept in `storyboard/drafts/` with their input hash, so a rerun asks
   nothing twice.

**Variety guard.** Within 30 s: the same background with the same actions is
sent back to Claude; the same moving camera is swapped by code (unless every
other moving camera has been used since: with a 5-camera library a strict
30 s rule is impossible). Across videos: a shot whose background · actions ·
camera combo appeared in one of the last 3 storyboarded projects gets another
camera.

A project without a story-engine narration (the lighthouse sample: only a
script.json) is storyboarded from its script, with its energy-5 lines as the
head fakes.

## Local jobs, pipeline status, export (Phase 3)

The queue also runs the steps that do not use Claude, so the app can show their
progress: `voice` (one /line call per script line, then the master track),
`mix` (async, so the HTTP server stays responsive while Python mixes),
`render` (mix, then the 720p preview) and `export` (the YouTube file). A job
reports `{label, done, total, detail}` while it runs (live only, not stored);
cancelling kills Remotion's whole process group, Chrome included.

| Route | |
| --- | --- |
| `POST /projects/:id/voice` `{line?, seed?, energy?}` | voice the locked script, or retake one line |
| `POST /projects/:id/mix` / `render` / `export` | queued; refused until the voice and the scenes exist |
| `GET /projects/:id/pipeline` | the nine steps, each `waiting` / `running` / `needs_you` / `done`, plus `stale`, computed from the files and the queue (`src/pipeline.ts`) |
| `GET /projects/:id/voice`, `/mix`, `/renders`, `/scenes`, `/storyboard` | what the step pages show |
| `GET`/`PUT /projects/:id/cast` | the characters' looks; saved into `storyboard/scenes.json` and checked with the strict `SceneFile` schema |
| `GET /projects/:id/file/<path>` | renders, takes, `audio/mix.wav`; byte ranges; nothing else |

**Out of date, not thrown away.** voice: a script line's text differs from what
was voiced. storyboard: the scenes no longer cover the script's lines, or the
library changed. render and export: content hashes of `scenes.json`,
`voice.json` and the soundtrack differ from the ones recorded in
`render.json` / `export.json`. Scenes carry no timing, so a re-voice alone does
not invalidate them.

### Export profiles (docs/PLAN.md section 9)

Defined once in `packages/schema/src/export.ts`.

| | YouTube | Quick preview |
| --- | --- | --- |
| frame | 1920×1080, 30 fps | 1280×720, 30 fps |
| video | H.264 High, CRF 20, x264 `slow`, yuv420p | CRF 26, `veryfast` |
| audio | AAC 320 kbps | AAC 128 kbps |
| size cap | 250 MB (`STUDIO_EXPORT_MAX_MB`); over it, re-encoded once at CRF 22 with the audio copied | none |

Files land in `projects/<id>/renders/`: `preview.mp4` + `preview.json`, and
`youtube/<id>.mp4`, `<id>.srt`, `chapters.txt`, `thumbnails/thumb-1..3.jpg`,
`export.json` (inputs, timings, encode settings, an ffprobe summary, fast
start). The `.srt` follows the old system's caption rules (38 characters, break
on pauses over 0.55 s, never end on a weak word, at least 0.8 s). Chapters are
one per loop at its first spoken word, 0:00 first, nothing under 10 s.
Thumbnails are the ending twist plus the strongest head-fake reveal words at
least 45 s apart, rendered without captions (`src/sidecars.ts`).

`STUDIO_RENDER_CONCURRENCY` sets Remotion's parallel frames (default 8 on the
M3 Pro; see `remotion/README.md` for what was measured).

## Usage log

`projects/<id>/usage.jsonl`, one line per call: step, model, attempt, ok,
duration, turns, input/output/cache tokens, web searches, and the
API-equivalent cost the CLI reports (`total_cost_usd`; nothing is billed per
call on a subscription). JSONL rather than SQLite: per project by
construction, append-only (a crash cuts at most the last line), readable
with `cat`/`jq`, no migrations, nothing native. Node 24's `node:sqlite` works
but is still experimental and warns on every run.

## Tests

`pnpm --filter @studio/worker test` runs everything against `fake/claude.mjs`
(port of `legacy/pipeline/fake_claude.py`) in a temp projects folder. It never
touches your account. `FAKE_CLAUDE_MODE` = `ok` | `limit` | `garbage` |
`invalid-once` | `invalid` | `slow` | `crash`.
