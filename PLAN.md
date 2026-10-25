# Build Plan

Companion to `DESIGN.md` (state machine, artifact contracts, validators).
This file covers stack selection, phasing, efficiency design, and failure hardening.

---

## 1. Research-driven stack decisions

Five decisions changed after researching current (late 2026) options. Each is
recorded with the reason, because the reasons will outlive the choices.

### 1.1 Base image model: FLUX.2 [klein] 4B — not FLUX.1-schnell

| Property | Value |
|---|---|
| License | **Apache 2.0** (4B only) |
| Params | 4B, distilled 4-step variant available |
| Memory | ~13 GB VRAM target per BFL; ~8 GB per official repo; MLX int4 weights ~2.1 GB, int8 ~3.9 GB |
| Multi-reference | **Yes, up to 4 reference images** |

The deciding factor is native multi-reference conditioning. Character and world
consistency across 60 shots is the hardest creative problem in this pipeline, and
klein solves it in the base model rather than through a bolted-on adapter whose
license we would have to clear separately.

> **Pin the 4B.** The klein 9B variants are under Black Forest Labs'
> **non-commercial** license. A careless model download is a licensing incident.

### 1.2 Runtime: MLX primary, ComfyUI as fallback — decided by benchmark, not opinion

No trustworthy M3-class benchmarks exist for these models. Published Mac figures:
**~25–30 s** per 1024² on an M5, **~52 s** on an M2 Pro at 4-bit. An M3 Pro should
land between, but that is an interpolation, not a measurement.

So Phase 0 is a mandatory benchmark gate. MLX is the Apple-native path and is
expected to win on speed; ComfyUI wins on ecosystem and workflow-as-JSON. Measure
**warm steady-state** separately from cold model load, and record median *and*
worst case, not the best sample.

### 1.3 Editing model: Qwen-Image-Edit-2509

20B parameters, **Apache 2.0**. Instruction-driven editing that preserves
composition — exactly what "change the image at 2:14" needs, versus regenerating
from scratch and losing the framing the user already approved.

Local feasibility on 36 GB is **unconfirmed**; 20B at int4 is roughly 10–12 GB of
weights, so it is plausible but unproven. Phase 4 evaluates it with a defined
fallback: if it will not run acceptably, the edit agent degrades to full
regeneration with an adjusted prompt, which is worse UX but not a blocker.

### 1.4 TTS: Kokoro-82M

**Apache 2.0**, small, fast, good narration voice, runs well on Apple Silicon.
No native word timings — expected, and handled by 1.5.

Chatterbox (MIT) is the fallback if expressive range matters, but reports indicate
it **watermarks its output**; verify the exact release's behaviour before shipping.

### 1.5 Alignment: a real CTC forced aligner — not Whisper's own timestamps

Correction to an earlier assumption. whisper.cpp's word timestamps are Whisper's
internal *estimates*, not forced alignment, and are less stable at word boundaries.

We have the exact transcript (we wrote it), so this is an **alignment** problem,
not a transcription problem. Use WhisperX's wav2vec2/CTC alignment stage or
`ctc-forced-aligner`. MFA is the escalation path if pronunciation control over
names and archaic terms becomes an issue — it uses an explicit pronunciation
dictionary, which matters for historical content full of proper nouns.

Metal acceleration on the WhisperX/CTranslate2 path is not dependable; CPU is
acceptable here because alignment is cheap relative to image generation.

### 1.6 Licensing register — business-critical

Build this as a real table in the repo, keyed by **checkpoint file hash**, covering
base weights, text encoder, VAE, LoRAs, and adapters. "The base model is open" is
not a licence audit.

**Cleared for commercial use:** FLUX.2 [klein] **4B** (Apache 2.0) ·
Qwen-Image-Edit-2509 (Apache 2.0) · Kokoro-82M (Apache 2.0) · Chatterbox (MIT,
check watermark) · FLUX.1-schnell (Apache 2.0, viable alternative)

**Do not ship:** FLUX.1-**dev** (non-commercial) · FLUX **Redux**
(non-commercial, and it governs the combined setup even on a schnell base) ·
FLUX.1 **Kontext [dev]** (non-commercial) · klein **9B** (non-commercial) ·
**XTTS-v2** (Coqui CPML, non-commercial) · **F5-TTS** released weights (CC-BY-NC)
· **Fish-Speech / OpenAudio** (research licence)

Note that a cleared weight licence says nothing about rights to depicted people,
trademarks, or training data.

Sources: [FLUX.2 overview](https://docs.bfl.ml/flux_2/flux2_overview) ·
[flux2 repo](https://github.com/black-forest-labs/flux2) ·
[ComfyUI klein guide](https://docs.comfy.org/tutorials/flux/flux-2-klein) ·
[Qwen-Image-Edit-2509](https://huggingface.co/Qwen/Qwen-Image-Edit-2509) ·
[local model licences](https://localaimaster.com/blog/local-image-model-licenses-commercial-use) ·
[TTS licensing](https://github.com/yapweijun1996/Local-TTS-Demo/blob/main/docs/LICENSING.md) ·
[NeMo aligner](https://docs.nvidia.com/nemo-framework/user-guide/latest/nemotoolkit/tools/nemo_forced_aligner.html) ·
[MFA](https://montreal-forced-aligner.readthedocs.io/en/v3.2.3/user_guide/index.html)

---

## 2. Architecture

```
┌─ VERCEL — control plane ──────────────┐      ┌─ WORKER — compute plane ──────┐
│ Next.js UI (all stages)               │      │ long-lived python process     │
│ Postgres (Neon): projects, artifacts, │ ←──  │ MLX / ComfyUI (model warm)    │
│   timelines, jobs, prompt_log         │ poll │ Kokoro TTS                    │
│ Blob: images, audio, renders          │      │ CTC forced aligner            │
│ Edit agent (mutates JSON only)        │      │ ffmpeg                        │
│ every function < 60 s                 │      │ uploads → Blob, PATCH status  │
└───────────────────────────────────────┘      └───────────────────────────────┘
```

Two rules that keep this honest:

1. **The worker pulls.** It is a stateless client behind NAT; Vercel never calls
   in. No tunnels, no static IP, no inbound firewall holes.
2. **The worker holds no state.** Where it runs is a config value, so moving from
   the MacBook to a rented GPU box is a deployment change, not a rewrite.

---

## 3. Phases

Each phase has an exit criterion. Do not start the next one until it is met.

### Phase 0 — Benchmark gate (1–2 days)

Prove throughput before building anything on top of it.

- klein 4B via MLX at int4 and int8; same prompts via ComfyUI
- measure warm steady-state s/image at 832×480 and 1024×1024
- measure peak memory; confirm no swap thrash at 36 GB
- test multi-reference conditioning quality with 4 refs
- spot-check Qwen-Image-Edit-2509 loadability

**Exit:** a table of measured s/image and peak RAM per runtime, a chosen runtime,
and a defensible estimate for a 60-shot job. If that estimate exceeds ~60 min,
decide *now* whether to rent GPU rather than discovering it in Phase 3.

### Phase 1 — Vertical slice, CLI only (~1 week)

One script. Hardcoded topic, hardcoded style, 10 shots, 60 seconds. No DB, no UI,
no queue. `python slice.py --topic "..."` → `out.mp4`.

**Exit:** a watchable 60-second video with audio in sync, generated end to end on
this Mac, and a timeline JSON that fully describes it.

### Phase 2 — Timeline, queue, worker (~1 week)

Postgres schema from `DESIGN.md`. Job claim with lease + heartbeat. Content-addressed
artifact cache. Worker loop with resumable per-shot checkpointing.

**Exit:** kill the worker mid-job, restart it, and the job resumes without
regenerating completed shots.

### Phase 3 — Web app, stages `idea` → `production` (1–2 weeks)

Staging and scripting slots with validators and inline error reporting. Style
candidate picker. Production progress view over SSE. Demote transitions. Staleness
banners.

**Exit:** a non-technical user drives a project from topic to finished video
without touching a terminal.

### Phase 4 — Editing page and edit agent (1–2 weeks)

Tool-calling agent over the timeline: `resolve_timecode`, `regenerate_shot`,
`edit_shot_image`, `set_shot_mood`, `nudge_shot_boundary`, `split_shot`, `merge_shots`.
Segment-level render cache so an edit re-renders one shot, not the film.
Immutable timeline versions for free undo and A/B.

**Exit:** "the mood at 1:24 doesn't match" produces a corrected video in under
60 seconds.

### Phase 5 — Hardening (~1 week)

Work the failure table in section 5. Add the smoke-test job. Pin every version and
model hash.

**Exit:** every row in section 5 has a test or an explicit accepted-risk note.

### Phase 6 — Publish

YouTube Data API v3. `videos.insert` costs ~1600 units against a default 10,000/day
quota — roughly 6 uploads/day, and raising it requires an audit. Title, description
and thumbnail live on the timeline, so publishing is a form submit.

---

## 4. Efficiency design

The pipeline is GPU-bound at exactly one step. Everything here protects that step.

- **Keep the model warm.** A long-lived worker process holds weights in memory
  across all 60 shots. Spawning a process per image adds tens of seconds of load
  time per image and is the single easiest way to make this pipeline slow.
- **Cheap stages first.** Research → script → TTS → alignment all complete before
  any image is generated, so a failure costs seconds instead of 40 minutes.
- **Content-addressed everything.** `hash(prompt, style, seed, model, refs)` → image.
  A re-render regenerates only genuinely changed shots.
- **Segment-level render cache.** Each shot renders to its own short mp4 keyed by
  content hash; the final video is a concat. One edited shot = one re-render plus a
  concat, which is what makes the editing page feel instant.
- **Generate modest, upscale after.** 832×480 generation plus upscale beats native
  1024p when the output is a Ken Burns pan inside a video frame.
- **Concurrency 1 on the GPU step.** Unified memory means parallel generation
  causes swap, and swap on this step is catastrophic rather than merely slow.
- **Prune aggressively.** Intermediates deleted after render; finals in Blob;
  per-project local disk quota.

---

## 5. Failure modes and hardening

Ordered by how badly each one hurts if unhandled.

| # | Failure | Why it's dangerous | Mitigation |
|---|---|---|---|
| 1 | **TTS silently drops or mangles words** | Audio no longer matches the script, so every downstream timestamp is wrong — and the video looks fine until someone watches it | ASR the generated audio, diff against the script, **fail the job** if WER exceeds threshold. Non-negotiable. |
| 2 | **Research hallucination reaches publish** | Destroys the product's only real claim: accuracy | Grounding contract; `cites` required per beat; source-URL validator; human approval gate |
| 3 | **Stale downstream artifact used silently** | A rewritten research doc with an old approved script = wrong claim, published | Upstream-hash staleness flags; never auto-delete, never auto-use |
| 4 | **Worker dies / Mac sleeps mid-job** | Job wedged in `running` forever; UI lies | Lease + heartbeat; reclaim jobs with stale heartbeat; idempotent resumable steps; `caffeinate -s`; launchd `KeepAlive`; **worker-offline banner from heartbeat age** |
| 5 | **Aligner drift** | Shots progressively desync; worst near the end, where nobody checks | Assert monotonic non-overlapping timestamps, no zero-length words, total within tolerance of audio length; flag suspicious spans in the editing UI |
| 6 | **Bad image: garbled text, artefacts, wrong subject** | Ships an embarrassing frame | Per-image QA (blur/aesthetic score, CLIP similarity to prompt); auto-reroll up to N; then flag for human |
| 7 | **OOM / swap thrash** | Crashes mid-batch and wastes the whole run | Concurrency 1; quantized weights; measured peak from Phase 0; per-shot checkpoints so a crash costs one shot |
| 8 | **Disk fills** | Opaque failures everywhere at once | Per-project quota; preflight free-space check; prune intermediates; alert under threshold |
| 9 | **Blob upload fails mid-job** | DB points at media that isn't there | Upload first, commit DB pointer second; content-addressed names make retries idempotent |
| 10 | **Dependency drift breaks a workflow** | A ComfyUI node update silently changes output | Pin every version; lock model file hashes; vendor workflow JSON; nightly smoke-test job |
| 11 | **ffmpeg edge case** | Odd dimensions, audio/video length mismatch | Force even dimensions; explicitly pad or trim audio to timeline length; validate before invoking |
| 12 | **Claude Code CLI rate limit mid-job** | Automated research stalls | Degrade to manual paste mode — the dual-mode slot design already covers this |
| 13 | **Model pulled or licence changes** | Can't reproduce past videos | Archive weights locally; licence register keyed by checkpoint hash |
| 14 | **YouTube quota exhausted** | Blind retries burn the remaining quota | Queue publishes; respect quota; never auto-retry on quota errors |
| 15 | **The MacBook is a single point of failure** | Whole business pauses when it's closed | Worker is stateless by design; rehost on a GPU box when this stops being a one-person tool |

---

## 6. Open risks

- **Phase 0 could invalidate the local-GPU premise.** If klein 4B lands above
  ~60 s/image on this Mac, a 60-shot job exceeds an hour and iteration becomes
  painful. The architecture survives it — the worker just runs on a rented GPU —
  but the cost model changes. Find out in week one.
- **Qwen-Image-Edit-2509 at 20B may not fit comfortably.** Fallback defined in 1.3.
- **Multi-reference consistency is unproven for this use case.** Four references
  anchoring 60 shots of one character is more than the published examples cover.
  Phase 0 tests it; the fallback is training a character LoRA, which adds a day or
  two and its own licence review of the training images.
- **Narration quality may cap perceived quality.** If Kokoro isn't good enough for
  the final product, ElevenLabs is the paid escape hatch. Keep TTS behind an
  interface so swapping is a config change.

---

## 7. Conventions

- **All frontend work goes through the `/impeccable` skill.** Every page,
  component and UI revision — the staging and scripting screens, the style
  candidate picker, the production progress view, the editing page. This applies
  from Phase 3 onward and to later revisions, not just first builds. It does not
  apply to the worker, the benchmark harness, or the ffmpeg assembly code.

---

## 8. Phase 0 findings — verified on this machine

Measured or read off the installed code, not inferred. Where these contradict
section 1, these win.

### 8.1 Ship the pre-quantized checkpoint — quantize-at-load is a trap

Both halves of section 1.1's assumption turned out to need correction, in
opposite directions.

**mflux does quantize at load.** `--quantize {3,4,5,6,8}` and
`Flux2Klein(quantize=N)` are real, so one weight set can serve every quant
level. That part of the HF model cards was misleading.

**But you should not use it.** Measured repository sizes:

| checkpoint | size | licence | notes |
|---|---|---|---|
| `black-forest-labs/FLUX.2-klein-4B` | **22.11 GB** | Apache 2.0 | bf16 base; ~7 GB of it is a duplicate layout of the same transformer |
| `mlx-community/flux2-klein-4b-4bit` | **4.30 GB** | Apache 2.0 | pre-quantized for mflux |
| `Runpod/FLUX.2-klein-4B-mflux-4bit` | **4.30 GB** | Apache 2.0 | identical mirror |

Quantizing at load means downloading 22.11 GB to produce what a 4.30 GB
checkpoint already is, then paying a quantization step on every cold start.
**The worker ships `mlx-community/flux2-klein-4b-4bit`:** 18 GB less disk, no
load-time quantize, same Apache 2.0 licence (verified on both mirrors via the
HF API, not inferred from the base model).

`resolve_model()` in `bench/backends/mflux_klein.py` encodes this — int4
resolves to the pre-quantized checkpoint, while int8 and bf16 fall back to the
bf16 base, since those rows genuinely need it. Those two rows are a refinement
of the int4 result, not part of the Phase 0 gate.

### 8.1b Model provisioning is a real deployment cost

Measured download throughput on this connection: **~128 MB/min (~2.1 MB/s)**.
So klein 4-bit is a ~35 minute provision and the bf16 base is ~3 hours.

That is a line item whenever a worker is rebuilt or relocated, and an argument
for baking weights into the worker image rather than fetching on first run —
particularly for the rented-GPU path in section 6, where a cold box that
spends 35 minutes downloading before its first image is a cost, not a detail.

For provisioning, set `HF_HUB_ENABLE_HF_TRANSFER=1` (the `hf_transfer`
package is already a mflux dependency) and an `HF_TOKEN`, both from the start.
Unauthenticated fetches are rate-limited.

**Do not measure download progress with `du` on the repo directory.** The Xet
backend stages chunks elsewhere and materializes a blob only when it finishes,
so the directory reads far too small and then jumps by gigabytes. Measuring
that way during Phase 0 produced a wildly pessimistic ETA and nearly triggered
a pointless restart of a healthy download. Read the fetch progress bar, or
count completed blobs, instead.

### 8.2 One runtime covers generation *and* editing

mflux ships `mflux-generate-qwen-edit` with `ModelConfig.qwen_image_edit` and
`qwen_image_edit_2511`. The Phase 4 editing model therefore runs in the **same
runtime as generation** — no second stack, no second dependency tree, one warm
process able to both generate and edit. This is a material simplification of
Phase 4.

### 8.3 Multi-reference consistency is reachable — via the edit variant

Resolved, and better than section 1.1 assumed. `Flux2Klein` exposes only a
single init image, but `Flux2KleinEdit` takes a **list**:

```python
Flux2KleinEdit(quantize=4, model_config=ModelConfig.flux2_klein_4b())
  .generate_image(seed, prompt, num_inference_steps=4, height=.., width=..,
                  image_paths=[hero, sheet_front, sheet_detail], ...)
```

CLI equivalent: `mflux-generate-flux2-edit --image-paths A.png B.png C.png`.

The consequence is architecturally significant: **one class, one warm process
and one licence-clean model (klein 4B, Apache 2.0) covers both
consistency-conditioned shot generation and the Phase 4 editing page.** The
hero frame plus character-sheet crops go in as `image_paths` for every shot,
and "change the image at 2:14" is the same call with a different prompt.

Redux remains closed to us — `Config.redux_image_paths` exists but Redux is
non-commercial — and is not needed.

Still to measure, not yet assumed: whether 3–4 references actually hold
identity across 60 shots, and what the extra conditioning costs per image.
Both are Phase 0 bench variables. The fallback remains a character LoRA via
`mflux-train` plus `--lora`.

### 8.4 MLX is the only proven local path

Native ComfyUI support for klein on macOS MPS is unverified; the one documented
Mac setup offloads conditioning to a second machine. Section 1.2 framed this as
an MLX-versus-ComfyUI bake-off. It is closer to a single viable option. The
ComfyUI backend stays for SDXL/schnell fallbacks and for driving a remote GPU
later, not as a klein competitor.

### 8.5 FLUX.3 klein — reviewed, and it stays blocked

Checked via the HF API rather than left open:

| repo | licence | gated | size |
|---|---|---|---|
| `black-forest-labs/flux-3-image-klein` | **other** | auto | **40.34 GB** |
| `black-forest-labs/flux-3-image-klein-base` | **other** | auto | 40.26 GB |

`license: other` on a Black Forest Labs repo is their non-commercial licence,
the same family as FLUX.1-dev and klein 9B — not Apache 2.0 — and `gated: auto`
means terms must be accepted before download. Three independent reasons to
decline: not commercially licensed, gated, and 40 GB against 4.3 GB for a model
that already passes the Phase 0 gate with room to spare. It stays in
`LICENCE_BLOCKED`.

### 8.5b Qwen-Image-Edit: use 2511, not 2509

`Qwen/Qwen-Image-Edit-2511` is **apache-2.0 and not gated**, and is newer than
the 2509 release section 1.3 selected. mflux exposes it as
`ModelConfig.qwen_image_edit_2511`. Prefer it for Phase 4, noting that klein's
own edit variant (section 8.3) may make a second edit model unnecessary
altogether.

### 8.6 Operational gotchas, both already failure modes

- **Battery cutoff.** `--battery-percentage-stop-limit` defaults to **5%**:
  an unplugged laptop worker stops mid-batch. Sharpens failure mode 4 — the
  worker needs AC, `caffeinate -s`, *and* an explicit battery limit.
- **Dependency drift, immediately.** `pillow==13.0.0` ships a `_typing` module
  that imports a private name from `numbers` and crashes on Python 3.12; the
  venv is pinned to `pillow==12.3.0`. A live instance of failure mode 10 on day
  one, which is the argument for pinning everything and running a smoke-test job.

### 8.7 Useful memory controls

`--low-ram`, `--vae-tiling`, `--vae-tile-size` and `--mlx-cache-limit-gb` all
exist and are plumbed through `RunConfig.extra`. These are the levers to reach
for if a configuration swaps — which section 5 treats as disqualifying, not as
a slow result.

`--compute-precision float16` is documented as helping on M1/M2 and being
roughly neutral on M4/M5. M3 is unmeasured either way, so it is a bench variable
rather than an assumption.

### 8.8 Generation resolution: 832×480, then upscale — decided

Measured on this machine (int4, 4 steps, klein 4B, **on battery — see 8.9**):

| resolution | MP | median | p90 | pattern across the run | 60-shot |
|---|---|---|---|---|---|
| **832×480** | 0.40 | **13.93s** | 14.14s | 14 → 14 → 13 → 14s, steady | **14.1 min** |
| 1216×704 | 0.86 | 63.86s | 78.98s | 40 → 55 → 73 → 79s, climbing | 79.0 min |
| 1024×1024 | 1.05 | 65.14s | 84.91s | 60 → 85 → 63 → 67s, erratic | 84.9 min |

832×480 is **~4.7× faster** than 1024² and the only configuration that held a
steady rate across a run. The output is Ken-Burns-panned inside a 1080p frame,
so native 1024² buys nothing a good upscale does not. The large resolutions
would only earn their cost for full-frame static shots.

**Decision: generate at 832×480 and upscale.** This is what PLAN.md section 4
assumed; it is now measured rather than assumed.

### 8.9 Battery was NOT the cause — the control refuted it

The Phase 0 sweep ran unplugged, and the large-resolution degradation (1216×704
climbing 40 → 55 → 73 → 79s) looked like classic power limiting. That
hypothesis was wrong, and re-running the same configuration on AC disproved it:

| config | battery median | **AC median** | AC pattern |
|---|---|---|---|
| 832×480 | 13.93s | **13.06s** | 13.5 → 13.1 → 13.0 → 13.0 → 13.0 → 14.0s, flat |
| 1216×704 | 63.86s | **83.43s** | 65 → 80 → 92 → 84 → 83 → 96s, still climbing |

832×480 improved ~6% and held perfectly flat. 1216×704 got **worse** on AC and
kept degrading. Power was not the constraint.

The real cause is memory pressure. The 1216×704 run recorded **7,312,646
swapouts — roughly 28 GB** of swap traffic, against 34,323 (~134 MB) for
832×480. That is three orders of magnitude apart and is not background noise.

**This also exposes a limitation in the harness's own swap classifier.** It
labelled both runs `ext` (exogenous) because neither MLX's counter (9.4 GB) nor
process RSS showed enough usage to justify swapping. On unified memory that
inference does not hold: mmapped weights, MLX's cache and page cache create
system-level pressure that neither process-level counter captures. Peak memory
as measured is not a reliable proxy for whether a configuration fits.

Treat the swap figure itself as the signal, not the headroom ratio derived from
it. A run showing millions of swapouts is in trouble regardless of what the
memory counters claim.

**None of this changes the decision in 8.8 — it strengthens it.** 832×480 is
fast, flat under sustained load, and generates essentially no swap. The large
resolutions fail for a more fundamental reason than power, and plugging in does
not rescue them.

Still worth keeping the worker on AC with `caffeinate -s`: the
`--battery-percentage-stop-limit` hard stop at 5% is real, even though
throttling was not the issue here.

### 8.10 Harness bug: peak memory was understated

`peak_mb` preferred MLX's own counter, which tracks only MLX buffers — not the
interpreter, mmapped weights or VAE staging. That understated the footprint and
let the headroom check mislabel genuine memory pressure as another process's
swap. Now `max(mlx_peak, rss_peak)`.

With the correction, the large-resolution runs sit at **31% of RAM** (MLX 11.1
GB, RSS 4.0 GB), still well under the 60% pressure threshold — so the ~3.8M
swapouts recorded during them remain attributed elsewhere, and battery
throttling stays the leading explanation for the slowdown. Confirming that is
what the AC re-run is for.

### 8.11 Multi-reference consistency works — measured, with a control

The last Phase 0 unknown, and the one most likely to have forced a redesign.

**Method.** Six prompts describing the same character in different scenes and
light (dawn stream, midday treeline, night fire, falling snow, hide work, dusk
ridge). Two arms, identical seed and identical prompts: `mflux-warm` with no
reference, and `mflux-edit-warm` with a single hero frame passed through
`image_paths`.

**Result.** With the reference, identity holds — face, beard, the fur-trimmed
wool cloak and the green under-layer all carry across, including through a
dawn-mist → night-firelight change that alters the whole palette. The scene
still changes as the prompt directs, so the reference is not simply pinning the
composition.

Without the reference, the same prompt and seed produced **a different person**:
darker hair pulled back, a fuller red beard, heavier build, a thick fur mantle
instead of the cloak. Prompt description alone does not hold a character across
shots.

The control is what makes this a finding rather than an impression. Had only
the referenced arm been run, a fixed seed plus a detailed prompt would have been
an equally good explanation for consistent-looking output.

**Cost.** Conditioning is not free:

| arm | median | p90 | 60-shot |
|---|---|---|---|
| no reference | 13.31s | 13.68s | 13.7 min |
| **one reference** | **19.09s** | 20.09s | **20.1 min** |

**+5.8s per image, +44%** — and still comfortably inside the 60-minute budget.
Peak memory was unchanged at 5.4 GB.

**Scene obedience initially failed — and the cause was the reference, not a
setting.** At first, shots close to the hero's setting came back as near-copies
of it: "falling snow between birches" and "dusk ridge, wind pulling the cloak"
both reproduced the hero frame, ignoring the prompt. Only the night-fire shot,
furthest from the reference's scene, adapted.

Two dead ends, both worth recording so they are not retried:

1. **There is no temperature.** Diffusion has no such parameter; the analogue is
   guidance scale. klein's distilled checkpoints **require guidance 1.0 and exit
   with an error on any other value** — mflux only permits real guidance on the
   non-distilled `base` variants. FLUX.2 also **has no negative branch at all**,
   so `--negative-prompt` is rejected outright. Both standard levers are closed.
2. **`image_strength` is a no-op on this path.** Reading
   `Flux2KleinEdit.generate_image`: generation latents come from fresh noise via
   `prepare_generation_latents`, while references go through
   `prepare_reference_image_conditioning` and are injected as **attention
   tokens** (`num_ref_tokens`). This is in-context conditioning, not img2img.
   `image_strength` is stored in `Config` and unused here — it governs how much
   noise to add when *starting from* an image, which never happens. A sweep over
   0.15 / 0.25 / 0.35 produced byte-different but perceptually identical output.
   **Reference influence is architectural and always fully on.**

**The actual lever is what the reference contains.** The hero used at first was
a full scene — the man standing in misty forest — so the model faithfully
reproduced the man *and the misty forest*. Correct behaviour, bad input.
Re-running with a tight character crop (face, beard, cloak, costume; background
removed) fixed it outright:

| shot | full-scene reference | **character crop** |
|---|---|---|
| dusk ridge, wind | near-copy of hero, no ridge | **dusk sky, ridge, cloak streaming in wind** |
| falling snow, birches | near-copy of hero | **real birch bark, falling snow, snow ground** |
| night fire | adapted | adapted |

Identity held in every case. Scene obedience was fully restored.

**And it is cheaper.** A smaller reference means fewer attention tokens:

| reference | median | 60-shot |
|---|---|---|
| full scene 832×480 | 19.09s | 20.1 min |
| **character crop 399×480** | **15.26s** | **15.3 min** |

**-20% per image**, which also confirms the token-conditioning mechanism:
reference cost scales with reference area, so crops are both more correct and
faster.

**Consequence for the architecture.** Section 8.3's prediction holds — one
model, one warm process, one Apache-2.0 licence covers both
consistency-conditioned generation and the Phase 4 editing page.

### 8.12 Dependency drift, a second live instance: `preshed==3.0.14`

Phase 1 hit the same class of failure as 8.6's pillow pin, in a different
package, on the first day of use.

`preshed==3.0.14` breaks spaCy model loading outright:

```
OverflowError: Python int too large to convert to C ssize_t
  spacy/tokenizer.pyx in Tokenizer._flush_specials
```

It surfaces while iterating the tokenizer's special-case keys, so it only fires
on a model with populated rules — a bare `Tokenizer` loads fine, which makes it
look like a model problem rather than a dependency one. Versions were *not*
mismatched: spaCy 3.8.16 with `en_core_web_sm` 3.8.0, which declares
`spacy>=3.8.0,<3.9.0`. Checking the version matrix would have cleared it.

It takes TTS down with it. Kokoro's English G2P (`misaki.en.G2P`) needs the
spaCy POS tagger to disambiguate homographs, so there is no narration at all
until this is pinned. **`preshed==3.0.9` is correct**; the pin is in
`pyproject.toml` with the reason attached.

The lesson is the one already in 8.6 and failure mode 10, now with two
instances: pin everything, and record *why* beside the pin.

---

## 9. Phase 1 findings — verified on this machine

The vertical slice is built and has produced a complete video end to end.
Measured, not assumed.

### 9.1 The slice runs in under five minutes

| stage | time | notes |
|---|---|---|
| validate | <0.1s | document contracts and the grounding check |
| narrate (Kokoro-82M) | 12.0s | 61.67s of audio, ~3x real time, CPU |
| align + ASR gate | 2.3s | 153 words timed, both jobs from one forward pass |
| plan shots | <0.1s | 10 shots from 6 beats |
| generate images | 229.5s | 12 images including 4 QA rerolls |
| render | 35.2s | 10 Ken Burns segments plus the dissolve pass |
| **total** | **279.3s** | cold cache |
| **total, warm cache** | **32.6s** | nothing regenerated but the render |

Per-image median was **19.4s**, against the 15.26s Phase 0 measured for the same
resolution and reference. The difference is prompt length: production prompts
carry the style prefix, the beat's visual, a framing clause and a mood — roughly
forty words against the bench's short lines. A 60-shot job therefore lands near
**19.4 min**, still comfortably inside the hour.

### 9.2 Sync was verified three ways, not asserted

The pipeline's central claim is that audio and image cannot drift. That claim
was checked rather than trusted:

1. **Duration.** The rendered file is 61.667s against a 61.675s timeline — 8ms,
   under a quarter of a frame.
2. **Image placement.** Every shot's frame was extracted at `start + 0.5s` and
   perceptually hashed against all ten source images. All ten matched their own
   shot, each time with a clear margin over the runner-up.
3. **Word placement.** The audio was sliced at the timeline's shot boundaries
   and re-transcribed. Every slice returned the words the timeline assigns that
   shot, with no word leaking across a cut.

### 9.3 `xfade` silently shortens the film — compensate explicitly

The one real trap in assembly. `xfade` consumes its transition from the output,
so cross-dissolving n clips removes `(n-1) * t` from the total. At ten shots and
a 0.4s dissolve that is 3.6s, and the result is a video that plays perfectly
while every shot after the first sits progressively early against its narration.

The fix is arithmetic, not a flag: render each segment one dissolve *longer*
than its visible duration and place transition i at `start(i+1) - t`. Then each
shot becomes fully visible exactly at its own start and the total equals the sum
of the durations. `pipeline/selftest.py` asserts this against real ffmpeg on
uniform, ragged, single-shot and two-shot timelines, and separately asserts the
output is *not* the uncompensated length — the check that would actually fail if
someone removed the compensation.

### 9.4 Near-duplicate QA needed a proximity rule, and the thresholds are calibrated

Risk 2 was understated. A duplicate threshold alone passed images that play as a
stuck video.

The detector is a 64-bit dHash, with thresholds calibrated against *labelled*
Phase 0 output rather than chosen by feel — Phase 0 conveniently left both a
known-bad and a known-good arm on disk:

| arm | distance |
|---|---|
| `image_strength` sweep, all six shots, 0.15 vs 0.25 vs 0.35 | **0** |
| full-scene reference, shot 3, against the hero frame | **0** |
| full-scene reference, shot 5, against the hero frame | 9 |
| character-crop reference, six shots vs the hero crop | 27–36 |
| character-crop reference, closest pair among themselves | 17 |

Bad cases sit at 0–9, good ones at 17+, nothing between. A duplicate threshold
of 8 separates them with margin. It also independently confirms 8.11's two
findings: the strength sweep really is perceptually identical, and the
full-scene reference really was being reproduced.

**But proximity changes what similarity means.** The first full run produced
S03/S04 at distance 11 and S06/S07 at distance 9. Both passed the duplicate
check; both play as a single held image for ten seconds, because they are
adjacent. Two similar images thirty seconds apart read as a motif; back to back
they read as a video that has stopped.

So the immediately preceding shot is judged at the stricter `SIMILAR_DISTANCE`
of 14. On the re-run that gate fired on all three pairs and the rerolls cleared
them — the tightest adjacent pair is now 16.

### 9.5 The root cause was the prompt, not the seed

Shots within one beat share `visual` and `mood`, so the framing clause is the
only thing distinguishing their prompts. The original ladder — "wide
establishing shot" / "close detail shot" — was too weak to move the composition,
and the model obligingly produced the same picture twice.

Rerolling on a new seed rescues it, but that is a lottery against a prompt that
is asking for the same image. Making the ladder directive about vantage,
distance and what fills the frame fixed it at the source. This is the same shape
as 8.11's conclusion: **the lever is what you put in, not a strength dial.**

### 9.6 A WER ceiling is the wrong gate for a dropped word

Failure mode 1 is TTS silently dropping a word, and the planned defence — ASR
the audio, diff against the script, fail over a WER threshold — turns out to be
poorly matched to the failure.

Measured on correct narration, per beat: 15.4%, 0%, 4.2%, 16.0%, 0%, 0%. The
non-zero rows are entirely the acoustic model's own behaviour — compound splits
(`TREELINE` → `TREE LINE`, `SOMEONE` → `SOME ONE`) and rare-word spellings
(`WOAD` → `WODE`, `BYRED` → `BIRED`). None is a narration defect.

So the gate has to sit above ~16% to avoid firing on correct audio. But one
dropped word in a 26-word beat moves WER by under four points. **The threshold
that avoids false positives cannot catch the failure it exists for.**

Two sharper signals replace it, both measured at a clean zero on correct audio:

- **Zero-length words — the direct observation.** Forced alignment must place
  every script word somewhere. A word the TTS never spoke has nowhere to go and
  collapses to no duration. This sees the dropped word rather than inferring it.
- **ASR deletions specifically.** The acoustic model's errors on this material
  are substitutions and splits; a word it finds no trace of is a different
  signal. Zero deletions across all 153 words.

The WER ceiling stays as a backstop for catastrophe. It is no longer the gate.

### 9.7 Licence-clean alignment: not MMS

`ctc-forced-aligner` is the obvious package for this and its default checkpoint
is MMS, which is **cc-by-nc-4.0** — verified via the HF API, and a licensing
incident under 1.6. The LibriSpeech wav2vec2 models are apache-2.0, so the
clean path is to drive one directly.

`torchaudio` was also declined: it is frozen at 2.11 against torch 2.14 here,
and coupling to its compiled `forced_align` op for one function is a version
risk. The CTC Viterbi pass is ~50 lines of numpy in `pipeline/align.py`, has no
build step, and yields per-word confidence for 5's drift assertions as a
by-product.

Every model in the slice is apache-2.0, recorded on the timeline.

### 9.8 Unresolved, carried into Phase 2

- **The WER gate's calibration rests on one script and one voice.** The
  zero-deletion baseline is clean but has a single sample behind it. Confirm it
  holds before relying on `MAX_DELETIONS_PER_BEAT = 0`.
- **Multi-reference is still untested** (8.3). The slice passes one crop. The
  code path takes a list and needs no change to try more.
- **Research and script generation are not wired.** Phase 1 runs from a
  hand-written fixture whose claims carry a `FIXTURE` source sentinel that the
  validator rejects unless explicitly allowed. The dual-mode slot from
  DESIGN.md — human paste or `claude -p` — is Phase 3's work.
