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

## Edit engine (Phase 4)

docs/PLAN.md section 8, without the UI. Every change works on project data,
lands in a new version, and redoes only what it touched. The format is
`EditRequest` in `packages/schema/src/edit.ts` (zod; the CLI shorthand maps
one to one onto it).

| Operation | What is redone |
| --- | --- |
| `scene.set` (bg, grade, camera, transition, caption, weather, framing, a character's action/expr/pos, props, overlays; library ids only), `scene.replace` | the segments that show the scene |
| `line.set` (text, energy, delivery, seed) | that line's take; the track is re-assembled; its scenes stretch, later ones move by whole frames and keep their segments |
| `insert` (a line, a scene, or both, after/before a line or scene) | only the new line is voiced; a scene it lands inside is cut in two |
| `sfx.add` / `sfx.move` / `sfx.delete` on a word | the mix only (a sound draws nothing) |
| `fx` (a voice preset on a line or one word, or `none`) | the track (the effected take is cached like a take); no picture |
| `scene.trim` (move its edges by whole lines), `scene.move` (within its loop), `scene.delete` (`merge`: the lines join a neighbour; `cut`: the lines go too) | the track when lines go or move; captions and music re-flow |
| `line.delete` | as `cut` |

Locked script lines change only through `line.set`, `line.delete` or a
`cut`; any other change to a line's text is refused (`checkDraft` in
`src/edit-ops.ts`). Scene ids are never renumbered (an id seeds the scene's
idle motion); new scenes take the next free id, new lines the next free
number in their loop.

```bash
pnpm edit <id> set S12 bg=office camera=zoom_face action=ines:panic expr=ines:shock
pnpm edit <id> line L3.4 text="…" [energy=4] [delivery="…"] [seed=7]
pnpm edit <id> insert --after L3.4 line="A dog barks." [scene=like:S12 action=ines:jump]
pnpm edit <id> sfx add door_slam L3.4:2 · sfx move door_slam L3.4:2 L3.5:0 · sfx delete door_slam L3.4:2
pnpm edit <id> fx L3.4 echo_thought [--word 5]       # chipmunk giant phone_call echo_thought robot underwater | none
pnpm edit <id> trim S12 start=1 · move S12 --after S10 · delete S12 merge|cut · cut-line L3.4
pnpm edit <id> apply edit.json                      # an EditRequest
pnpm edit <id> check <command …>                    # what it would do; changes nothing
pnpm edit <id> regenerate S12 "<note>" [--count 3]  # Claude: 2–3 options, then: pnpm edit <id> pick <optionsId> <n>
pnpm edit <id> beat "<beat in plain words>" --after L3.4 [--check]
pnpm edit <id> fix S3 "<note>" S9 "<note>"          # flagged scenes, one call
pnpm edit <id> render preview|final|both            # draw the current version (missing segments only)
pnpm edit <id> align [--force]                      # once, for a project voiced before Phase 4: line starts on frames
#   every edit command takes --label "…" and --render preview|final|both
pnpm versions <id> [list] · show <n> · diff <a> <b> · rollback <n> [--render …] · init
```

How it works (`src/edit.ts`): the operations are applied to a draft copy of
HEAD and checked (coverage, scene order, consecutive lines, the strict
`SceneFile`, the narration, locked lines, then `validateProject` with the new
voice). Then:

1. **voice**: lines whose text, effective energy or seed changed, and new
   lines, get a take from the audio service (`POST /line`, cached by key).
   The service is needed only then.
2. **track**: if a take, the order of lines or an effect changed, the takes
   are assembled and mastered again by `audio/studio_audio/track.py` (a
   child process, no model, ~27 s for 6 minutes). Every line starts on a
   video frame, and word frames are counted from their line
   (`remotion/src/scene/timeline.ts`), so a line moved by whole frames keeps
   every word's frame and every later segment is reused.
3. **mix**: re-planned from the draft and mixed only for a new plan
   (`audio/mix/<key>.wav`). Plans name the narration by its stored copy
   (`audio/narration/<sha256>.wav`), so equal tracks give equal plans.
4. **commit**: a new version; its files become the working files.

**Versions** (`src/versions.ts`): `projects/<id>/versions/NNNN.json` per
version (operations, label, what changed, what it cost), `HEAD`, and
`objects/<hash>.json` for the tracked JSON (script, narration, scenes,
storyboard report, voice.json, overrides, fx, mix plan and result). Takes,
effected takes, narration tracks, mixes and render segments are never copied
per version; each lives in its own cache by content and a version only names
it. Rolling back writes the old JSON back and clones the old narration and
mix out of their caches (copy-on-write on APFS): nothing is voiced, mixed or
drawn. Working files changed outside the editor (a re-voice, a new
storyboard) become a version of their own before the next edit.

**Claude steps** (`src/edit-claude.ts`, skill `engine/.claude/skills/edit-scenes`):
`regenerate`, `beat`, `fixscenes`, each one `claude -p` call through
`src/call.ts` (zod, one retry with the errors, usage logged). Every draft
shot goes through the storyboard step's code: id mapping (`normaliseShot`),
reveal devices (`ensurePayoffs`), and the variety guard on the new or changed
scenes only (camera repeats swapped, recent-video combos re-cameraed,
repeated pictures flagged). Regenerate options are saved in
`projects/<id>/edits/options/`; picking one commits it.

**HTTP** (`src/edit-api.ts`; long work is a queued job with progress):

| Route | |
| --- | --- |
| `GET /projects/:id/versions` · `/versions/:n` · `/versions/diff?a=&b=` | history, one version, a diff |
| `POST /projects/:id/versions/:n/rollback` `{render?}` | job `rollback` |
| `POST /projects/:id/edits` `{label?, ops, render?}` | job `edit`; an impossible edit is refused at once (409) |
| `POST /projects/:id/edits/check` `{ops}` | dry run: lines to voice, track re-assembled, notes |
| `POST /projects/:id/edits/regenerate` `{scene, note, count?}` · `GET …/edits/options/:oid` · `POST …/edits/options/:oid/pick` `{n, render?}` | options, then a pick (job `edit`) |
| `POST /projects/:id/edits/beat` `{beat, after\|before, render?}` · `POST /projects/:id/edits/fix` `{scenes: [{scene, note}], render?}` | jobs `beat`, `fixscenes` |
| `GET /projects/:id/timeline` | scene frames, whether each segment is drawn (preview, final), lines with words and effects, mix cues |
| `GET /projects/:id/editor` · `/editor/options?scene=` · `GET /editor/sfx` · `/editor/sfx/audio?asset=` | for the editor UI (`src/editor-api.ts`): the live draft with its timeline and soundtrack, a scene's newest options, the SFX tags with a file to preview (byte ranges) |

`render`: `none` (default), `preview`, `final` or `both`, drawn after the commit.

**Rendering** in segments is the default for the preview and the export
(`remotion/README.md`, "Partial re-render"); `STUDIO_RENDER_SEGMENTS=0` draws
the whole video in one call as before. `render.json` / `export.json` record
how many segments were drawn and reused.

## Reels (Phase 4, Part C)

docs/PLAN.md section 9, "Reels / Shorts". Two things, both usable on any project:

```bash
pnpm reel <id> export     # the 9:16 file: renders/reel/<id>.mp4, <id>.srt, reel.json
pnpm reel <id> cut        # Claude cuts a 60-90 s Reel from a long video: creates the project <id>-reel
pnpm reel <id> status
```

**Reel export** (`src/reel-export.ts`). Works for a native Reel (brief format
`reel`) and for a Reel cut. The segment renderer draws the `reel` profile
(1080×1920, 30 fps, H.264 High, CRF 21, preset slow, AAC 192 kbps, captions
burned in), so after an edit only the scenes that changed are drawn again. Over
40 MB (`STUDIO_REEL_MAX_MB`) it is re-encoded once at CRF 23, audio copied,
then fast start. The `.srt` follows the old system's caption rules. Flat
animation is small: the two proof Reels came out at 9 to 13 MB, under the plan's
15 to 40 MB estimate.

**Reel cut** (`src/reel-cut.ts`, skill `engine/.claude/skills/reel-cut`, step
`reelcut`). One `claude -p` call, zod-checked, usage logged under the long
video, one retry with the errors:

1. Input: the loop map with the critic's scores per loop, every line with its
   id, text, energy, beats and the seconds it takes to speak, the scenes.
2. Output: the loop it is built around and why, the existing lines to keep
   (script order), and optionally one `hook` before and one `ending` after,
   each with a `showScene` whose picture plays under it. Code checks the ids,
   the order, 16 and 22 words at most, spoken forms only, and 60 to 90 s.
3. The child `<id>-reel` is made from the long video's current version: kept
   lines keep their ids, takes (cloned by hash, never voiced again), scenes and
   cast. The track is assembled from those takes (no model), the sound mixed
   again, and the result committed as version 1 of the child. `reel.json`
   records the parent, its version, the choice and the measured length.
4. The hook and ending go in as an ordinary `insert` edit (version 2): only
   they are voiced, so the audio service must be running if the cut adds one.

The child has its own scenes, versions and edit pass, so the editor, the
preview and both exports work on it unchanged. A name is never reused:
`<id>-reel`, then `<id>-reel-2`.

| Route | |
| --- | --- |
| `GET /projects/:id/reel` | the Reel export, whether it is out of date, the cuts made from this video (or where this one came from) |
| `POST /projects/:id/reel/export` / `reel/cut` | jobs `reelexport` and `reelcut`; a cut is refused for a Reel and for a Reel cut |
| `POST /projects/:id/reveal` `{file}` | shows a file of `renders/` in the Finder |

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
