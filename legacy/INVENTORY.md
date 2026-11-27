# v1 inventory

Snapshot of the old system, written before it was moved into `legacy/`.
The exact pre-move state is the git tag `v1-final` (commit `c55fdca`).
`legacy/` is read-only reference until Phase 3 of `docs/PLAN.md`, and will be
deleted once v2 has produced real videos.

## What v1 did

A research-to-video pipeline for history explainers. Topic → `claude -p` writes
`research.md` (with sources) and `script.md` → Kokoro-82M TTS narrates →
wav2vec2 forced alignment gives word timestamps → shots are cut on those
timestamps → FLUX.2 klein 4B (mflux, MLX) paints one still per shot,
conditioned on a locked character crop → ffmpeg Ken Burns + captions + SFX →
`out.mp4`. The `timeline.json` was the real artifact; every render was a pure
function of it, and an edit agent (`claude -p` + MCP tools) mutated it.

Structure:

- `pipeline/` (Python 3.12): the stages, a Postgres job queue and worker with
  lease and resume, the edit agent, the SFX library, a YouTube uploader, and
  self-tests with fakes for Claude, YouTube and the models.
- `web/` (Next.js 16, React 19, Tailwind 4, pnpm): the "studio" stepper
  (Idea → Research → Script → Look → Render → Film → YouTube), deployed on
  Vercel with Neon Postgres and Vercel Blob, with the Mac as a remote worker.
- `bench/`: image-model benchmarks (speed, memory, swap, consistency).
- `deploy/`: launchd plists and installer for the worker on the Mac.
- `PLAN.md`, `DESIGN.md`, `HANDOFF.md`: the v1 plan, contracts and handoff.
  (The v1 `PLAN.md` is now `legacy/PLAN.md`; the v2 plan is `docs/PLAN.md`.)

## Keep / rewrite / delete

"Keep" means copy into v2 more or less as is, in Phase 3 or wherever noted.
"Rewrite" means the idea or logic is worth porting, but the code is tied to v1
(Postgres, Vercel, Python, stills). "Delete" means it belongs to the
video-model pipeline or the hosted setup and has no place in v2.

### Keep

| Path | Why | Used in |
| --- | --- | --- |
| `web/app/globals.css` (the `@theme` tokens) | Dark "screening room" palette with one film-stock yellow accent, contrast already checked for WCAG 2.2 AA | Phase 3 UI |
| `web/components/ui.ts` | Shared button and field class vocabulary | Phase 3 UI |
| `web/components/stage-strip.tsx` | Stepper strip with a word for every state, not colour alone. Change the 7 stages to the 9 steps | Phase 3 stepper |
| `web/components/copy-button.tsx`, `live-refresh.tsx`, `filmstrip.tsx` | Small, generic | Phase 3 |
| `web/lib/format.ts` | Duration and size formatting | Phase 3 |
| `web/PRODUCT.md` | Design brief (principles, anti-references, accessibility). Change the user from "non-technical teammate" to Majed | Phase 3 design context |
| `pipeline/fonts/SourceSans3-Semibold.ttf` + `OFL.txt` | Caption font, OFL licence | Phase 0/1 captions (optional) |
| `pipeline/sounds/*.mp3` + licence records in `pipeline/sfx.py` | About 66 short SFX: 19 CC0, 20 public domain, 3 CC BY 3.0 (need credit, or replace them), the rest synthesized in `sfx_synth.py`. Import into `assets/sfx/` with the `licence` field. Drop or credit the CC BY ones (plan section 7 wants CC0 or Sonniss only) | Phase 3 sound library |

### Rewrite (port the logic, not the code)

| Path | What to take from it | Phase |
| --- | --- | --- |
| `pipeline/writer.py` (`run_claude`) | `claude -p --output-format json` invocation, timeout, error parsing, turn and usage logging | 2 (worker) |
| `pipeline/fake_claude.py` | A fake `claude -p` for tests that use no account | 2 |
| `pipeline/align.py` | Forced alignment against the known script, plus the ASR "did the voice say the words" gate. v2 uses WhisperX | 1 |
| `pipeline/captions.py` | Caption chunking rules: max 38 chars, break on pauses over 0.55 s, never end on a weak word, minimum 0.8 s | 1 (captions on word timestamps) |
| `pipeline/timeline.py`, `edits.py`, `editor.py`, `edit_tools.py` | Timeline as the artifact; edits mutate a draft copy; dirty-shot re-render; edit agent as `claude -p` + MCP tools | 4 (video editor) |
| `pipeline/sfx.py` (mix part) | Placing cues on a timeline and mixing them into the soundtrack | 3 |
| `pipeline/jobs.py`, `worker.py`, `store.py` | Single-job worker with kill and resume that never redoes finished work. Postgres → SQLite | 2–3 |
| `pipeline/docs.py` | Validators for human-reviewed documents, with clear errors. Becomes zod schemas | 2 |
| `web/lib/narratives.ts`, `components/narrative-picker.tsx` | Narrative type picker for the Brief step. The list changes | 3 |
| `web/lib/stages.ts` (`DURATIONS`) | Length picker. Now YouTube vs Reel | 3 |
| `web/app/api/films/[id]/events/route.ts`, `films/[id]/progress.tsx` | Live progress over SSE during long renders | 3 |
| `web/components/voice-picker.tsx` | Voice choice UI. Now reference clips of the signature voice | 3 |
| `web/components/machine-status.tsx` | "Is the machine busy" indicator. Now local, no remote worker | 3 |
| `web/app/(studio)/films/[id]/editing-room.tsx`, `editing.tsx`, `sounds.tsx` | Editing page layout ideas | 4 |
| `deploy/worker.plist`, `install-worker.sh` | launchd service for a long-running local worker, if wanted | 3 |
| `pipeline/pins.py` | Pinning model weights by commit and SHA-256. Apply to Chatterbox and WhisperX | 1 |
| `pipeline/youtube.py`, `publish.py`, `fake_youtube.py` | YouTube upload. Not in the v2 plan; park unless publishing is added | — |

### Delete (tied to the video-model pipeline or the hosted setup)

- `bench/`, `slice.py`: image-model benchmarks and the Phase 1 slice.
- `pipeline/images.py`, `sheet.py`, `qa.py`, `shots.py`, `assemble.py`,
  `production.py`, `run.py`, `smoke.py`, `fakes.py`, `gatecheck.py`,
  `selftest.py`: FLUX stills, character sheets, image QA, Ken Burns assembly.
- `pipeline/tts.py`: Kokoro. Chatterbox-Turbo replaces it.
- `pipeline/media.py`, `upkeep.py`, `webapi.py`, `queuetest.py`,
  `migrations/`, `compose.yaml`: Vercel Blob, Postgres, Neon.
- `pipeline/config.py`, `pins.lock.json`, `fixtures/`: v1 config and fixtures.
- `web/` hosting and auth: `lib/auth.ts`, `session.ts`, `db.ts`, `doorbell.ts`,
  `media.ts`, `cuts.ts`, `env.ts`, `app/login/`, `app/api/worker/`,
  `api/pipeline.py`, `scripts/vendor-pipeline.mjs`, `proxy.ts`. v2 is local
  only, with no login.
- `web/app/(studio)/films/[id]/look/` and `lib/looks.ts`: hero crop and paint
  look, specific to image conditioning.
- `web/public/sfx/`: a duplicate of `pipeline/sounds/`.
- `.vercel/`, `.vercelignore`, `.agents/` + `.claude/skills/neon*`,
  `skills-lock.json`: Vercel link and Neon skills.
- `pyproject.toml`, `requirements.lock`, `.venv/`: v1 Python env. The v2 audio
  service gets its own.
- `work/` (about 35 GB, gitignored): v1 renders and model cache.

## Environment variables (names only)

From `.env.local` (moved to `legacy/.env.local`, still gitignored):
`BLOB_READ_WRITE_TOKEN`, `INTERNAL_API_KEY`, `VERCEL_OIDC_TOKEN`.

Read by the code:

- Claude: `CLAUDE_BIN`, `CLAUDE_MODEL`, `CLAUDE_EDIT_MODEL`, `CLAUDE_EDIT_EFFORT`,
  `FAKE_CLAUDE_MODE`, `FAKE_CLAUDE_DELAY`, `FAKE_CLAUDE_EDIT`
- Database and worker: `DATABASE_URL`, `PGHOST`, `WORKER_ID`, `WORKER_TOKEN`,
  `WORKER_ENV_FILE`, `DOORBELL_URL`, `INTERNAL_API_KEY`
- Storage: `BLOB_READ_WRITE_TOKEN`, `MEDIA_DIR`, `MEDIA_DIR_FAIL_PUTS`,
  `WORK_ROOT`, `MIN_FREE_GB`
- Model caches: `HF_HOME`, `HF_HUB_CACHE`, `XDG_CACHE_HOME`
- YouTube: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`,
  `YOUTUBE_TOKEN_URL`, `YOUTUBE_API_ROOT`, `YOUTUBE_CHUNK_BYTES`,
  `YOUTUBE_DAILY_UPLOADS`, `YOUTUBE_BACKOFF_SECONDS`,
  `YOUTUBE_PROCESSING_POLL`, `YOUTUBE_PROCESSING_WAIT`

Secrets that may still be live and should be revoked when v1 is retired:
the Vercel Blob token, `INTERNAL_API_KEY`, the YouTube OAuth refresh token (in
the worker's env file outside the repo), and the Neon `DATABASE_URL`.
