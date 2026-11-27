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
