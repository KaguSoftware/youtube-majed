# HANDOFF — read this first

Written for a session picking this project up cold. Everything below was
measured on the target machine, not assumed. Where a conclusion was wrong and
later corrected, both the wrong turn and the correction are kept, because the
wrong turns are the expensive part to rediscover.

Depth lives in [PLAN.md](PLAN.md) (stack, phases, failure modes, findings
§8.1–§8.11) and [DESIGN.md](DESIGN.md) (state machine, artifact contracts,
validators, schema). This file is the orientation layer.

---

## 1. What the product is

An internal web tool. A user enters a topic ("how did barbarians live"), the
pipeline researches it with sources, writes a narrated script, generates one
image per beat, assembles them into a narrated video, and hands it to an editing
page where an AI applies changes like "the mood at 1:24 doesn't match".

Pipeline order, which is load-bearing:

```
idea → staging(research.md) → scripting(script.md) → style(hero + crop)
     → production(TTS → align → images → ffmpeg) → editing → finalized → posted
```

**Audio is generated before images.** Shot boundaries come from real word-level
timestamps of the narration, so sync is structural rather than something fixed
later. Reversing this is the single most common way these pipelines end up
permanently out of sync.

**The video is never the artifact — a timeline JSON is.** Every renderer, agent
and view is a pure function of it. Edits mutate the timeline and re-render only
the dirty shots.

---

## 2. Status

**Phase 5 (hardening) is done, and its exit criterion is met:** every row of
the failure table in PLAN.md section 5 has a test or an explicit
accepted-risk note, mapped row by row in PLAN.md 13.1. Three things are new:

- **Pins** (`pipeline/pins.py`). `requirements.lock` is committed; the model
  register holds the repository, commit and licence of each model;
  `pins.lock.json` holds the SHA-256 of every file the loaders read. Nothing
  was pinned before: Kokoro and wav2vec2 loaded `main`, and mflux pins the
  base klein repo but not the 4-bit checkpoint (13.2). A worker whose install
  drifts claims nothing.
- **Smoke test** (`pipeline/smoke.py`). It renders the first two beats of the
  Phase 1 script on the real models from an empty cache and checks them
  against recorded goldens. Repeat runs are identical (dHash distance 0,
  byte-identical narration), so drift is meaningful (13.3). The idle GPU
  worker runs it nightly, and `deploy/install-worker.sh` refuses to deploy
  unless it passes with `--strict`.
- **Flags and health in the studio.** The editing room lists shots worth a
  look: a picture that never passed QA, or a *run* of words the aligner could
  not hear. Single weak words were measured as noise (25 of ~150 good shots),
  so they are not flagged (13.4). The header and a banner say when the
  machine has refused work and why (`workers.health`, migration 006).

**Shipped on 26 Oct 2026** (PLAN.md 13.6): the worker install and the web app
are on Phase 5, Neon is at migration 006, and the production worker's first
smoke test passed with no drift (177 s) and no pin problems. The weights are
archived at `~/Desktop/youtube-majed-model-archive`, verified by hash. That
copy is on the same disk, and the workers cannot read the Desktop (TCC), so a
restore means copying it into the hub cache. Still outstanding, from earlier
phases: `prune-films --apply` and the Phase 3 exit run.

**Phase 4 (the editing page and edit agent) is built, and its exit criterion
was met on this machine:** "the mood at 1:24 doesn't match", typed into the
editing page, put a corrected film on screen in 47.9 s (PLAN.md 12.1). The
film is now delivered as one chunk per shot played as HLS, so an edit re-cuts
two chunks instead of re-encoding six minutes; every edit is a new immutable
cut and undo moves a pointer. **Production still runs Phase 3 code**: run
migration 005 on Neon, deploy `web/`, then re-run `deploy/install-worker.sh`,
in that order (PLAN.md 12.11). Also
pending: `jobs prune-films --apply` frees 519 MB of the 1 GB store. The
Phase 3 exit run below is also still outstanding; Phase 4 was started ahead of
it at the owner's request.

**Phases 0, 1 and 2 are complete; Phase 3 (web app) is nearly done.** Every
stage, idea through research, script, look and render, is built in `web/` and
was driven through the browser on real output: Claude research and scripts on
the worker's light lane, real klein looks, and a first real film (6:00, 50
shots, drift +8 ms) published to Blob and played in the browser. What remains
is the exit run by the non-technical user on the deployed app: deploy to
production, create accounts, install the two launchd agents. Findings, and
what the artifacts taught (the image model does not know history), in
PLAN.md section 11.

Phase 1's exit criterion is met: `python slice.py` produces a 61.7s narrated,
illustrated video on this Mac from a hardcoded topic and style, plus a timeline
JSON that fully describes it. Cold run 279s; warm cache 33s.

Sync was *verified*, not asserted — three independent ways, see PLAN.md 9.2.

**Phase 2 — Postgres queue and worker — is done, and its exit criterion was
met on the real model.** A worker was SIGKILLed after shot 4 of a cold job,
restarted, and finished the film. All 7 images made before the kill came back as
cache hits; only S05–S10 were generated; drift was +0ms (PLAN.md 10.1). Three
findings matter going forward:

- **Resume is "re-run the job"**, with every stage content-addressed. The
  Postgres checkpoint is a record and is never consulted to skip work. What it
  did need was **atomic writes**: a kill mid-write used to leave a half-file the
  cache trusted (10.2).
- **Every worker write is fenced by a per-claim `lease_token`**, so a Mac that
  wakes from sleep after its job was reclaimed cannot write over the new owner
  (10.3).
- **Kokoro was not deterministic**; it is now seeded per beat (10.4).

```
pipeline/
  config.py     locked production config, every value cited to a measurement
  docs.py       research.md + script.md parsing and the grounding validators
  tts.py        Kokoro behind a swappable TTS interface; synthesis is per beat
  align.py      CTC forced alignment in numpy + the ASR gate (one forward pass)
  shots.py      beats + measured word timings -> shots
  timeline.py   the artifact: schema, content addressing, contiguity validators
  images.py     warm Flux2KleinEdit, content-addressed, QA-driven rerolls
  qa.py         blur/artefact checks + near-duplicate detection
  assemble.py   ffmpeg Ken Burns segments -> per-shot chunks (HLS) -> mp4 on request
  run.py        the CLI; stage order is cheap-stages-first by design
  selftest.py   weights-free checks, incl. the sync arithmetic against ffmpeg
  gatecheck.py  negative control: splices words out and proves the gate fires
  sheet.py      character-sheet generation, anchored to one reference crop
  production.py the production stage as one resumable function (slice + worker)
  edits.py      the edit operations on a draft timeline (mood, repaint, retouch, cuts)
  edit_tools.py those operations as an MCP server for `claude -p` (stdio, no deps)
  editor.py     the edit agent: prompt, the claude run, what changed
  media.py      local cache in front of Blob; chunks, narration, stills, refs
  upkeep.py     heal-cuts and prune-films: the store whole and under 1 GB
  pins.py       pinned packages, tools and weights; the licence register by hash; archive
  pins.lock.json  SHA-256 of every weight file, plus the Python and ffmpeg versions
  smoke.py      the smoke test: real models, a 20 s film, goldens in fixtures/
  writer.py     Claude writes research and scripts (`claude -p`, light lane)
  store.py      Postgres: claim / lease / heartbeat / fenced writes, artifacts
  worker.py     the polling worker: host lock, heartbeat thread, signals
  jobs.py       operator CLI: migrate, seed, enqueue, status, cancel, retry
  fakes.py      weights-free TTS / aligner / generator for testing the machinery
  queuetest.py  52 queue + kill/resume checks against a throwaway database
  migrations/   SQL, applied in order by `Store.migrate()`
  fixtures/     the hardcoded Phase 1 script and research documents
requirements.lock  `uv pip freeze` of the tested venv; the worker installs exactly this
slice.py        entry point (no DB; same stages as the worker)
compose.yaml    local Postgres 17 on 127.0.0.1:54329
deploy/         launchd agent for the worker (KeepAlive, graceful exit)
```

Run `python -m pipeline.selftest` first — 148 checks, no weights, about a
minute (it renders real chunks through ffmpeg). `pipeline.queuetest` is 127
checks including a full edit round trip with a scripted stand-in for Claude.
`python -m pipeline.smoke` is the one that loads the models (~2 min).
`python -m pipeline.gatecheck` is the negative control for the narration gate
and needs the aligner weights plus one completed run.

Two Phase 1 loose ends are now closed, both against their predictions:
multi-reference is **not** worth it (9.9), and the narration gate works but not
via the detector that was documented as primary (9.6).

---

## 3. The locked production configuration

| | |
|---|---|
| model | **FLUX.2 [klein] 4B**, `mlx-community/flux2-klein-4b-4bit` (Apache 2.0) |
| runtime | **mflux** on MLX, warm in-process (`Flux2KleinEdit`) |
| resolution | **832×480**, upscale afterwards |
| steps / guidance | **4 / 1.0** (1.0 is mandatory — see §5) |
| conditioning | **character-crop** reference via `image_paths` |
| measured | **15.26s median per image → ~15.3 min per 60-shot job** |
| peak memory | 5.4 GB of 36 GB |

Host: MacBook Pro, Apple M3 Pro, 36 GB, macOS 26. Python 3.12.15, mlx 0.32.4,
pillow **12.3.0** (pinned, see §6), ffmpeg 9.0.2.

Measured alternatives, for context:

| resolution | median | pattern | 60-shot |
|---|---|---|---|
| **832×480** | **13.06s** (no ref) | flat | 13.5 min |
| 1216×704 | 83.43s | climbing 65→96s | 91.6 min |
| 1024×1024 | 65.14s | erratic | 84.9 min |

Large resolutions fail on memory pressure — 1216×704 generated ~28 GB of swap
traffic against ~134 MB at 832×480. Plugging in does not rescue them.

---

## 4. The finding that matters most: crop the reference

Character consistency across 60 shots is the hardest creative problem here, and
it is solved — but with one non-obvious requirement.

Conditioning on a **full-scene** hero frame makes the model reproduce the scene
as well as the character. Shots near the hero's setting came back as near-copies
with the prompt ignored. Cropping the hero to the character (face, costume, no
background) fixed it completely and made it ~20% faster, since reference cost
scales with reference area.

| shot | full-scene reference | **character crop** |
|---|---|---|
| dusk ridge, wind | near-copy, no ridge | **dusk sky, ridge, cloak streaming** |
| falling snow, birches | near-copy | **real birch bark, falling snow** |

Control arm, same seed and prompt with **no** reference, produced a visibly
different man — so the reference is doing real work, not the seed.

**Consequence, already in DESIGN.md:** the style stage stores the hero twice —
the approved full frame and a character crop with a user-adjustable `crop_box`.
Shot generation conditions on the crop, never the full frame.

---

## 5. Levers that do not exist — do not retry these

- **No temperature.** Diffusion has none. The analogue is guidance scale.
- **No guidance tuning.** klein's distilled checkpoints *require* guidance 1.0
  and exit with an error otherwise. Only non-distilled `base` variants accept
  real values, and those need ~20–28 steps instead of 4.
- **No negative prompt.** FLUX.2 has no negative branch; mflux rejects the flag.
- **`image_strength` is a no-op** with `image_paths`. Reading
  `Flux2KleinEdit.generate_image`: latents start from fresh noise and references
  are injected as attention tokens. It is in-context conditioning, not img2img.
  A sweep over 0.15/0.25/0.35 gave byte-different, perceptually identical output.
  **Reference influence is architectural and always fully on** — the only lever
  is what the reference image contains.

---

## 6. Traps already paid for

- **`pillow==13.0.0` crashes on Python 3.12** (its `_typing` imports a private
  name from `numbers`). Pinned to 12.3.0. Do not upgrade blindly.
- **Battery was a red herring.** Large-resolution slowdown looked like power
  throttling; re-running on AC made 1216×704 *worse*. The cause is memory
  pressure. Still keep the worker on AC with `caffeinate -s`, because
  `--battery-percentage-stop-limit` defaults to 5% and will hard-stop a batch.
- **Do not measure HF download progress with `du`.** The Xet backend stages
  chunks elsewhere and materializes blobs only on completion, so the directory
  reads far too small and then jumps by gigabytes. This produced a wildly
  pessimistic ETA and nearly triggered a pointless restart.
- **Quantize-at-load is a trap.** `mlx-community/flux2-klein-4b-4bit` is 4.30 GB
  against 22.11 GB for the bf16 base. Ship the pre-quantized checkpoint.
- **The harness's swap classifier is not trustworthy.** It compares swap against
  process-level peak memory, but on unified memory neither MLX's counter nor RSS
  captures true system pressure. **Read the raw swapout count, not the `ext`
  label.** Millions of swapouts means trouble regardless of what it says.

---

## 7. Licence rules — a business constraint, not a preference

**Cleared (Apache 2.0):** `flux2-klein-4b`, `flux2-klein-base-4b`,
`mlx-community/flux2-klein-4b-4bit`, `Runpod/FLUX.2-klein-4B-mflux-4bit`,
Qwen-Image-Edit-**2511**, Kokoro-82M, FLUX.1-schnell.

**Never ship:** FLUX.1-**dev** · FLUX **Redux** · FLUX.1 **Kontext [dev]** ·
klein **9B** (all variants) · **FLUX.3** klein (`license: other`, gated, 40 GB) ·
XTTS-v2 · F5-TTS weights · Fish-Speech.

The trap: **Redux's non-commercial licence governs the combined setup even on an
Apache-licensed base.** A clean base does not launder an adapter.

Enforced in code — `assert_licence_ok()` in
[bench/backends/mflux_klein.py](bench/backends/mflux_klein.py) raises on blocked
aliases, including via the `checkpoint` override.

---

## 8. Verified mflux API

Confirmed by introspection, not documentation:

```python
from mflux.models.flux2.variants import Flux2Klein, Flux2KleinEdit
from mflux.models.common.config.model_config import ModelConfig

model = Flux2KleinEdit(                      # multi-reference + editing
    quantize=None,                           # None: checkpoint is pre-quantized
    model_config=ModelConfig.from_name(
        "mlx-community/flux2-klein-4b-4bit",
        base_model="flux2-klein-4b"),
)
img = model.generate_image(
    seed=88412, prompt="...", num_inference_steps=4,
    height=480, width=832, guidance=1.0,
    image_paths=[hero_crop],                 # a LIST — multi-reference
)
img.save(path=dest, overwrite=True)          # overwrite defaults to False
```

`Flux2Klein` is the same but single-image (`image_path`). CLI equivalents:
`mflux-generate-flux2`, `mflux-generate-flux2-edit --image-paths A B C`.

**One warm process covers generation and editing** — same class, same weights,
same licence. This removes the need for a separate Phase 4 edit model.

---

## 9. Remaining stack choices (researched, not yet built)

- **Research + script**: Claude. A local LLM will invent historical facts, and
  accuracy is the product's only real claim. Two interchangeable modes behind
  one endpoint — human paste, or `claude -p` on the existing subscription.
- **TTS**: Kokoro-82M (Apache 2.0). No native timestamps; that is expected.
- **Alignment**: a real CTC forced aligner (WhisperX align stage or
  `ctc-forced-aligner`) — **not** whisper.cpp's own timestamps, which are
  estimates. We have the exact transcript, so this is alignment, not ASR.
- **Assembly**: raw ffmpeg (`zoompan`, `xfade`), not MoviePy.
- **Hosting**: Vercel for UI, Postgres, Blob, job queue, edit agent (every
  function <60s). A **polling** worker on this Mac does all long work — it pulls,
  Vercel never calls in, so no tunnels or static IP. Worker holds no state, so
  relocating it to a GPU box is a config change.

---

## 10. Highest-value unresolved risks

Risks 1 and 2 were addressed in Phase 1, and both turned out to need a different
shape than planned. Details in PLAN.md 9.4 and 9.6.

1. ~~**TTS silently dropping a word.**~~ Gated — but **not** by the WER
   threshold the plan called for. Measured on *correct* narration, per-beat WER
   runs 0–16%, all of it the acoustic model's own compound splits and rare-word
   spellings. A threshold high enough to avoid false positives cannot catch one
   dropped word in a 26-word beat, which moves WER by under four points. The
   real gates are **zero-length words in the forced alignment** (a word the TTS
   never spoke has nowhere to go, so this observes the drop rather than
   inferring it) and **ASR deletions specifically**. Both measured a clean zero.
   WER stays as a backstop.
2. ~~**Per-image QA must catch near-duplicates.**~~ Done, with thresholds
   calibrated against labelled Phase 0 output — the bad arms hash at distance
   0–9, the good arm at 17+. The addition the plan did not anticipate:
   **adjacency matters**. Two similar images thirty seconds apart read as a
   motif; back to back they read as a video that has stopped. The preceding
   shot is judged on the stricter threshold.
3. ~~**Multi-reference with 3–4 crops is untested.**~~ Tested and **rejected**.
   Three crops cost 3.4x per image rising to nearly 6x by the third image, and
   drove the machine to 15.6 GB of swap — 8.9's disqualifying signature, with
   the 1-crop arm flat in the same process immediately before. With identical
   seeds the two arms produced near-identical images, so there is no quality
   gain to pay for. Reference cost is **superlinear** in reference area, which
   follows from references being attention tokens. One character crop stays the
   production configuration. PLAN.md 9.9.
4. **Narration quality may cap perceived quality.** Kokoro is behind a `TTS`
   interface with an abstract voice map, so ElevenLabs is a config change. Not
   yet judged on a finished video.
5. **The narration gate's calibration rests on one script and one voice.** The
   zero-deletion baseline is clean but has a single sample behind it. A
   negative control (`python -m pipeline.gatecheck`) now proves the gate fires:
   it splices words out of the real narration and catches **6/6 content words**
   while staying silent on untouched audio. It also showed the detector I had
   documented as primary — zero-length words — never fires at all; **ASR
   deletions do the work**. PLAN.md 9.6.
6. **There is no automatic identity check on a character sheet, by decision.**
   A colour-palette metric was built and removed: a known-different man scored
   *higher* than the real matches. Consistency rests on the single-anchor rule
   and human review until an embedding model clears a licence review. PLAN.md
   9.10.

---

## 11. Running things

```bash
# Phase 2: the queue and the worker
docker compose up -d --wait                       # Postgres
.venv/bin/python -m pipeline.queuetest            # 52 checks incl. SIGKILL/resume, ~15s
.venv/bin/python -m pipeline.jobs seed --allow-fixture-sources
.venv/bin/python -m pipeline.jobs enqueue barbarians-01 --allow-fixture-sources
.venv/bin/python -m pipeline.worker               # polls forever; Ctrl-C releases cleanly
.venv/bin/python -m pipeline.jobs status [JOB]    # per-shot generated/cached log
.venv/bin/python -m pipeline.jobs workers         # online/offline from heartbeat age

# Phase 5: pins and the smoke test
.venv/bin/python -m pipeline.pins check [--deep]  # this machine vs requirements.lock + pins.lock.json
.venv/bin/python -m pipeline.pins fetch           # download the pinned model revisions
.venv/bin/python -m pipeline.pins archive DEST    # weights as a hub cache; restore with HF_HUB_CACHE=DEST
.venv/bin/python -m pipeline.smoke [--strict]     # real models, 20 s film, vs fixtures/smoke.golden.json
.venv/bin/python -m pipeline.smoke --record       # after a deliberate change, having looked at work/smoke/

# Phase 4: edits and downloads (the editing page does the same)
.venv/bin/python -m pipeline.jobs edit PROJECT "the mood at 1:24 doesn't match"
.venv/bin/python -m pipeline.jobs export PROJECT [--version N]
.venv/bin/python -m pipeline.jobs heal-cuts [--project P]   # every cut playable from the store
.venv/bin/python -m pipeline.jobs prune-films [--apply]     # delete mp4s no cut needs

# the Phase 1 slice: topic -> out.mp4 + timeline.json
.venv/bin/python slice.py --allow-fixture-sources

# weights-free checks, including the xfade sync arithmetic (a few seconds)
.venv/bin/python -m pipeline.selftest

# see the plan without spending the GPU budget
.venv/bin/python slice.py --allow-fixture-sources --dry-run
.venv/bin/python slice.py --allow-fixture-sources --skip-render
```

Output lands in `work/<project>/` (`out.mp4`, `timeline.json`, `narration.wav`,
`alignment.json`) with content-addressed audio, alignments, images and segments
in `work/cache/`. `DATABASE_URL` points the worker and CLI at a database
(default: the compose one); moving to Neon is that variable and nothing else.
Deleting `work/<project>/` re-renders; deleting `work/cache/` regenerates.

`--allow-fixture-sources` is required because the Phase 1 research fixture is
hand-written and its claims carry a `FIXTURE` source sentinel. The validator
rejects it by default, so hand-written claims can never be mistaken for
researched output. `--force` overrides any validator or the narration gate, and
prints what it is overriding.

```bash
# validate the Phase 0 harness, no weights needed
python3 -m bench.run_bench --backend synthetic

# the production config
.venv/bin/python -m bench.run_bench --backend mflux-edit-warm --quant int4 \
  --res 832x480 --n 6 --warmup 0 --prompts consistency.txt \
  --refs bench/refs/hero_crop.png
```

Backends: `synthetic`, `mflux-warm`, `mflux-edit-warm`, `mflux-cli`, `comfyui`.
Results land in `bench/results/` as JSON plus a markdown report with verdicts.
`bench/refs/hero_crop.png` is a working character reference.

---

## 12. Phase 4 in one paragraph

An edit is a job on the GPU lane. `claude -p --effort low` (Opus) runs with
`pipeline/edit_tools.py` as its only MCP server and changes a draft timeline:
it resolves the timecode, views the frame, and sets a mood, repaints, retouches
a boxed region, nudges a cut onto a word boundary, or splits or merges shots.
Tools never paint. The worker then paints the marked shots on the warm model
(QA holds a repaint to the picture it replaces), re-encodes the chunks they
touch, uploads only those, and commits the draft as a new cut whose parent is
the cut it was made from. The browser plays a cut from per-request HLS
playlists of presigned chunk URLs (`/api/films/[id]/cuts/[version]/...`).
Three traps are written up in PLAN.md 12: timestamps (12.2), whole-frame
retouches changing what they were told to keep (12.5), and QA rerolling an
edit against a likeness the film already had (12.6).

## 13. Working agreements

- **All frontend work goes through the `/impeccable` skill** — every page and
  every revision, from Phase 3 on. Not for the worker, harness or ffmpeg code.
- **Moving a pin is a reviewed change**: edit `pins.MODELS` (and the licence
  if it changed), `pins fetch`, `pins lock`, then `smoke --record` after
  looking at the film. Upgrading a package: change the venv, regenerate
  `requirements.lock` with `uv pip freeze`, run all three test suites.
- **Commits carry no AI attribution**: no `Co-Authored-By`, no "Generated with",
  no session links. Message only.
- **Look at the artifacts.** Three conclusions in Phase 0 were contradicted by
  opening the images or reading the source, after the metrics said everything was
  fine: the swap FAIL that wasn't, the battery hypothesis the control refuted,
  and the consistency "pass" that was reproducing the reference. The benchmark
  said 19.09s and PASS while generating near-duplicate frames.
