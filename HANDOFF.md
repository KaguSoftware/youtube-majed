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

**Phase 0 (benchmark gate) and Phase 1 (vertical slice) are both complete.**

Phase 1's exit criterion is met: `python slice.py` produces a 61.7s narrated,
illustrated video on this Mac from a hardcoded topic and style, plus a timeline
JSON that fully describes it. Cold run 279s; warm cache 33s.

Sync was *verified*, not asserted — three independent ways, see PLAN.md 9.2.

**Phase 2 — timeline, queue, worker — is next.** Note that two of its pieces
already exist in substance: artifacts are content-addressed, and a re-run
regenerates only what genuinely changed (measured: 33s against 279s). What
Phase 2 adds is Postgres, job claim with lease and heartbeat, and the worker
loop. Its exit criterion — kill the worker mid-job, restart, resume without
redoing finished shots — is a property of the addressing scheme that is already
in place.

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
  assemble.py   ffmpeg Ken Burns segments -> cross-dissolved film
  run.py        the CLI; stage order is cheap-stages-first by design
  selftest.py   weights-free checks, incl. the sync arithmetic against ffmpeg
  fixtures/     the hardcoded Phase 1 script and research documents
slice.py        entry point
```

Run `python -m pipeline.selftest` first — 51 checks, no weights, a few seconds.

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
3. **Multi-reference with 3–4 crops is still untested** — only one crop has been
   validated. The code path takes a list and needs no change to try more.
4. **Narration quality may cap perceived quality.** Kokoro is behind a `TTS`
   interface with an abstract voice map, so ElevenLabs is a config change. Not
   yet judged on a finished video.
5. **The narration gate's calibration rests on one script and one voice.** The
   zero-deletion baseline is clean but has a single sample behind it.

---

## 11. Running things

```bash
# the Phase 1 slice: topic -> out.mp4 + timeline.json
.venv/bin/python slice.py --allow-fixture-sources

# weights-free checks, including the xfade sync arithmetic (a few seconds)
.venv/bin/python -m pipeline.selftest

# see the plan without spending the GPU budget
.venv/bin/python slice.py --allow-fixture-sources --dry-run
.venv/bin/python slice.py --allow-fixture-sources --skip-render
```

Output lands in `work/<project>/` (`out.mp4`, `timeline.json`, `narration.wav`,
`alignment.json`) with content-addressed images and segments in `work/cache/`.
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

## 12. Working agreements

- **All frontend work goes through the `/impeccable` skill** — every page and
  every revision, from Phase 3 on. Not for the worker, harness or ffmpeg code.
- **Commits carry no AI attribution**: no `Co-Authored-By`, no "Generated with",
  no session links. Message only.
- **Look at the artifacts.** Three conclusions in Phase 0 were contradicted by
  opening the images or reading the source, after the metrics said everything was
  fine: the swap FAIL that wasn't, the battery hypothesis the control refuted,
  and the consistency "pass" that was reproducing the reference. The benchmark
  said 19.09s and PASS while generating near-duplicate frames.
