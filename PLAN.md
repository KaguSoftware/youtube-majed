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

**Carried in from Phase 2.** Three pieces were held back deliberately because
they only earn their keep once there is a UI and a second machine (10.5):

1. **Blob storage for media.** The worker uploads each finished image, segment,
   narration wav and film to Blob under its content hash, *then* commits the DB
   pointer (failure mode 9: upload first, pointer second). The local
   `work/cache/` becomes a read-through cache in front of Blob: local, then
   Blob, then generate. Style references (`hero_full`, `hero_crop`) move from
   repo-relative paths in `styles.preset_json` to Blob URLs, and timeline media
   paths become Blob URLs. This is what makes resume work *across machines*.
   Today a different worker reuses finished shots only if it shares the work
   root, as the `queuetest` takeover check does. A worker on a rented GPU box
   with its own disk would regenerate everything.
2. **The HTTP control plane.** Next.js routes for claim, heartbeat,
   checkpoint, event, complete, fail and release, carrying the same
   `lease_token` fencing as `store.py`. The worker gets an HTTP client behind
   the same interface as `Store`; that interface is the seam. Each call is a
   single short query, well inside Vercel's 60s limit. Decide at the start of
   the phase whether to switch or stay direct. Direct Postgres to Neon over TLS
   already satisfies "the worker pulls"; HTTP keeps database credentials off
   the worker, which matters once it runs on a box you do not own.
3. **`prompt_log` writes.** The table exists and nothing writes to it yet. Every
   `claude -p` research or script generation records its prompt, raw response
   and hash, arriving with the dual-mode slot. Image prompts need no entry: the
   timeline already records each shot's prompt and seed.

The progress view and the worker-offline banner need no new plumbing. The SSE
stream reads `job_events` (one row per stage and per shot, marked
generated/cached), and the banner reads `workers.last_seen_at`. Offline after
45s: `jobs.OFFLINE_AFTER_SECONDS`.

**Exit:** a non-technical user drives a project from topic to finished video
without touching a terminal.

### Phase 4 — Editing page and edit agent (1–2 weeks)

Tool-calling agent over the timeline: `resolve_timecode`, `regenerate_shot`,
`edit_shot_image`, `set_shot_mood`, `nudge_shot_boundary`, `split_shot`, `merge_shots`.
Segment-level render cache so an edit re-renders one shot, not the film.
Immutable timeline versions for free undo and A/B.

**Exit:** "the mood at 1:24 doesn't match" produces a corrected video in under
60 seconds. **Met: 47.9 s from the click to the new cut on screen, 50.1 s to
playable (section 12.1).** The film is delivered as per-shot chunks rather than
one mp4 (12.2), and the editing model is the generation model (8.2), so
Qwen-Image-Edit (1.3) was never needed.

### Phase 5 — Hardening (~1 week)

Work the failure table in section 5. Add the smoke-test job. Pin every version and
model hash.

**Exit:** every row in section 5 has a test or an explicit accepted-risk note.
**Met: section 13.1 maps all fifteen rows.** Versions and weights are pinned
(`pipeline/pins.py`), and a smoke test renders a real 20-second film nightly
and at every deploy (`pipeline/smoke.py`).

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

Two sharper signals replace it, both measured at a clean zero on correct audio.
**A negative control then showed only one of them does the work**, which is the
sort of thing that stays hidden if a gate is only ever tested on good input.

`pipeline/gatecheck.py` splices individual words out of the real narration,
leaves the script untouched, and checks the gate notices. Results:

| | |
|---|---|
| control, untouched audio | gate silent (no false positives) |
| **content words** (longest per beat, 0.42–0.76s) | **6 / 6 caught** |
| function words (shortest per beat, 0.02–0.04s) | 0 / 6 caught |
| caught by ASR deletion | 5 |
| caught by WER backstop | 1 |
| caught by the duration check | **0** |

- **ASR deletions are the real gate.** The acoustic model's own errors on this
  material are substitutions and splits; a word it finds no trace of is a
  different kind of event. This caught five of six.
- **The zero-length check never fired, and the reasoning behind it was wrong.**
  The prediction was that a word the TTS never spoke has nowhere to go and
  collapses to no duration. In practice forced alignment reassigns a frame or
  two from the neighbouring words, so the word is short but not empty.
  Length-normalizing it (flagging under 15 ms/char for words of 5+ characters,
  against a measured floor of 31.5 ms/char on real content words) did not
  change this — it still fired on nothing. It is kept as a cheap invariant, not
  counted as a defence.
- **The missed function words are not a real gap.** They are `A`, `IN`, `OF`,
  `IS`, `ON` — words the aligner assigned 20–40ms, the floor, because English
  elides them. Removing 20ms of audio is not what a dropped word sounds like,
  and losing an article does not change what the video claims.

The WER ceiling stays as a backstop for catastrophe. It is no longer the gate.

**This is why the control was worth building.** Before it, "no errors on good
audio" was equally consistent with a gate that works and a gate that does
nothing, and the detector documented here as primary would have been the one
that never fires.

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

### 9.9 Multi-reference: tested, and not worth it

Risk 3 from section 6, open since Phase 0, is now closed — against the
prediction in 8.3.

**Method.** A character sheet was generated first (see 9.10), cropped to the
character, and the two best views added as extra references. Both arms ran the
same six consistency prompts at the same seed in the same warm process, back to
back, 1 reference against 3.

| arm | references | reference area | per image |
|---|---|---|---|
| 1 ref | hero crop | 191k px | **19.0s, flat** (21.2, 19.0, 19.0, 18.5, 22.3, 18.5) |
| 3 ref | + front + detail crops | 628k px | **64.6s, 108.2s, 115.2s — climbing** |

**Cost is superlinear in reference area, and it ends in swap.** 3.3x the
reference area produced 3.4x the time on the first image and nearly 6x by the
third, still rising. During the 3-ref arm the machine reached **15.6 GB of swap
in use and 18.7M swapouts, with 7,747 pages free**; killing the run dropped
swap back to 7.3 GB. That is 8.9's signature exactly, and by the standard set
there it disqualifies the configuration regardless of speed.

The within-run control is what makes this attributable: the 1-reference arm was
*flat* in the same process immediately before. Nothing else changed.

Superlinearity is expected once the mechanism from 8.11 is taken seriously.
References are attention tokens, and attention is quadratic in sequence length,
so reference area compounds rather than adds. 8.11 already measured the gentle
end of this curve — 2x area for +25% time — without extrapolating it.

**And there is no quality gain to pay for.** With identical seeds the two arms
produced near-identical images: same pose, same composition, same character,
same light. Whatever a single character crop is doing, it is already doing it.

**Decision: one character crop stays the production configuration.** The run was
stopped after three images of the second arm because the result was monotonic
and the machine was suffering; four more images would have added nothing but
risk.

Not ruled out: *much* smaller references, such as a tight 200x200 face crop,
sit at a different point on the cost curve. But with no visible identity
improvement from 3.3x the area, the upside looks small.

### 9.10 Generating a character sheet, and the identity check that does not exist

Making the model draw the character from other angles works, with one
structural rule and one honest admission.

**The rule: one anchor.** Every view is generated conditioned on the same
original hero crop, never on another generated view. Chaining view onto view is
how drift compounds; anchoring all of them to one ground-truth frame bounds it.
Three views — front, three-quarter profile, head-and-shoulders detail — came
back unmistakably the same man as the anchor: same face, beard, olive wool
layers, fur-trimmed mantle, leather chest strap.

Views are generated against a flat studio background so the crop carries
costume and face and nothing else. Cropping still matters for cost, and the
background is textured enough in an impasto style that a naive
background-difference threshold selects the whole frame; 130 summed over RGB was
measured as the level at which the box stops moving.

**The admission: there is no automatic identity check, and one was tried.** A
saturation-weighted hue histogram over the character region, compared by
Bhattacharyya coefficient, calibrated against a *matched* control — a view
generated with no reference under the same prompt, background and light, which
8.11 established yields a different man:

| pair | score |
|---|---|
| anchor ~ front (same man) | 0.056 |
| anchor ~ profile (same man) | 0.229 |
| front ~ profile (same man) | 0.935 |
| **front ~ control (different man)** | **0.968** |
| detail ~ control (different man) | 0.931 |

The different man scores **higher than any real match**. The metric tracks
background and dominant garment hue, not identity: everything generated on grey
in olive clothing looks alike to it. An earlier attempt to calibrate the same
metric against Phase 0's full-scene arms failed the same way (same-character
0.154–0.412 overlapping different-person up to 0.603), which is what prompted
building the matched control.

It was removed. A gate that cannot tell two different men apart is worse than no
gate, because it gets trusted. A real check needs an image embedding model,
which is a new dependency, a new download and a new licence review under 1.6 —
a Phase 2 decision, not something to fake.

What protects consistency instead: the single-anchor rule, which is the
mechanism that actually produced the result; human review, which DESIGN.md
already requires at the style stage; and an automatic *distinctness* check,
which is mechanically decidable — two views that came back near-identical cost
reference area and add nothing.

---

## 10. Phase 2 findings — verified on this machine

The exit criterion is met on the real model, not only in a test: a worker was
SIGKILLed mid-job, restarted, and finished the film without regenerating a
single completed shot.

### 10.1 The exit criterion, measured

Job 2, `barbarians-01`, the production klein config, an **empty** cache:

| | attempt 1 (killed) | attempt 2 (resumed) |
|---|---|---|
| narration, alignment | synthesized, aligned | **cache hits** |
| S01–S04 | generated: 7 images (3 QA rerolls) | **7 cache hits**, QA recomputed, same verdicts |
| S05–S10 | — | generated: 7 images (1 reroll) |
| render | — | 10 segments, film 61.67s, drift +0ms |

Restart to finished film took 192s, and the worker started at once rather than
waiting out the 90s lease, because a restarted worker reclaims its own orphan
immediately (10.3). The resumed attempt's QA reproduced the dead attempt's
reroll decisions exactly, which only works because QA is recomputed from the
cached bytes rather than trusted from the checkpoint.

`python -m pipeline.queuetest` repeats this weights-free in about ten seconds,
along with the variant where a *different* worker takes over after the lease
expires, a graceful SIGTERM, and the queue semantics in 10.2: 52 checks.

### 10.2 Resume needs no resume logic — but it did need atomic writes

Phase 1 predicted resume would come free from content addressing, and the
mechanism is indeed just "re-run the job; every finished stage is a cache hit".
The checkpoint written to Postgres is a record for the progress view and the
audit, never consulted to decide what to skip, so a stale or missing checkpoint
cannot make the output wrong.

The prediction missed one thing. Every cache treated "file exists and is
non-empty" as "done", and every writer — mflux's `save`, ffmpeg, the wav writer
— wrote straight to the final name. A kill mid-write leaves a non-empty
half-file that the next attempt trusts: a truncated PNG or an mp4 without its
moov atom, read back as a finished shot. Every write now goes to a `.partial`
name and is `os.replace`d into place (`config.partial`). The worker sweeps
leftover partials on start.

### 10.3 Leases are fenced, not just timed

Heartbeat-and-expiry alone cannot distinguish a dead worker from a frozen one.
A Mac that sleeps through its lease wakes up believing it still owns the job;
if another worker reclaimed it meanwhile, both would write. Each claim mints a
`lease_token`, and every worker write — heartbeat, checkpoint, event, outcome —
is conditioned on it, so the zombie's next write touches zero rows and it
abandons the job. Conversely a heartbeat does *not* check expiry: a worker that
slept with nobody waiting simply continues.

The heartbeat runs on its own thread and connection. It was confirmed live
during generation — "beat 8s ago" while the main thread sat inside an MLX
forward pass — so a slow image or a model load cannot cost the lease.

Same-host restart is instant because the worker id is `<LocalHostName>:<work
root>` and the worker holds an exclusive `flock` on that root. Holding the lock
proves no other live process has this id, so a job still marked running under it
is an orphan. macOS `gethostname()` returned a DHCP address here, which would
have changed the id across network changes; `scutil --get LocalHostName` does
not.

### 10.4 Kokoro is not deterministic — now it is

Two cold syntheses of the same script produced the same length but different
samples (peak difference 0.30), and word timings up to 20 ms apart. Its vocoder
draws from torch's global RNG. A resume that re-synthesized would therefore have
aligned different audio and could have planned different shot boundaries.

Two fixes, both in place. Narration is content-addressed and alignment always
reads the wav back from disk, even on a cold run, so a resume aligns the
identical bytes. And `KokoroTTS.say` now seeds torch from `(voice, text)` inside
`fork_rng`. Two cold syntheses in separate processes are now byte-identical, and
the narration gate still passes on the seeded audio: overall WER 5.9%, zero
deletions.

### 10.5 Other decisions

- **Postgres is the queue.** `FOR UPDATE SKIP LOCKED` claim, tested with eight
  simultaneous claimers and exactly one winner. Jobs are few and long, and the
  job row is also the progress record, checkpoint and audit trail.
- **Jobs pin artifact versions.** The payload carries the exact `artifacts` ids.
  If a newer research or script version is approved before the job starts, it
  fails at `inputs` rather than narrating a superseded script (DESIGN.md
  "Staleness").
- **Gates fail, accidents retry.** A validator, the narration gate or an
  unrenderable timeline fails the job outright, since a retry repeats it.
  Anything else requeues with backoff, up to `max_attempts` (3). Losing the
  worker three times also fails the job, so a prompt that OOMs the machine
  cannot crash-loop it.
- **The worker keeps klein warm across jobs** (`unload_images=False`). The
  per-job reload is small (0.7s from page cache) but it is the cost PLAN.md
  section 4 is about.
- **Fake engines partition the queue.** `worker --fake` only claims jobs
  enqueued with `--fake`, and the image hash now includes the generator's name.
  A smoke test can therefore never take a real job or poison klein's cache.
- **Not yet:** Blob storage (media stays in the local content-addressed cache),
  the HTTP control plane (the worker talks to Postgres directly over TLS, which
  still satisfies "the worker pulls"), and prompt logging. All three are now in
  Phase 3's scope (section 3), with what each involves.

---

## 11. Phase 3 findings, so far — verified on this machine

Steps 0 (spikes), 1 (media store, migration 002, doorbell), 2 (app shell),
3 (research and script slots, both modes) and 4 (the look stage) are built,
and step 5 (render from the browser, live progress over SSE, film playback)
produced its first real film: 6:00, 50 shots, drift +8 ms, 22 minutes on the
Mac, published to Blob and played with seeking in the browser. Every stage was driven through the browser on
real output: Claude research, Claude scripts, real klein looks, a real render.

### 11.1 The free tier shapes the architecture

Decision: Vercel Hobby, Neon Free, Blob on Hobby. Each has a hard ceiling that
locks the service until the next period when crossed, so they are design
constraints, not cost lines:

| | limit | what it forced |
|---|---|---|
| Neon | 100 CU-hours/month; scale to zero after 5 min, not disableable | an idle worker must not poll Postgres (11.2) |
| Blob | 1 GB, 2,000 uploads, 10,000 cache-miss reads, 10 GB transfer | segments stay local; contact sheets instead of per-shot thumbs (11.4) |
| Vercel | 1M invocations, 4 h active CPU | doorbell every 15s, two lanes: ~350k invocations/month |

Vercel's terms restrict Hobby to non-commercial use; noted to the owner, who
chose free.

### 11.2 The doorbell: idle without waking the database

Polling Postgres every 5s keeps Neon's compute awake around the clock, about
180 CU-hours a month against 100. Moving the control plane to HTTP would not
help: the API routes would query Neon just the same.

So an idle worker polls `GET /api/worker/doorbell`, which answers from Vercel's
runtime cache and never touches the database; enqueueing changes the value.
The worker reads Postgres when the value changes, after each job, when
`Store.next_due` says a retry or an expiring lease comes due, and every six
hours as a safety net. An evicted value is rewritten fresh and reads as a
ring, so eviction costs one poll, never a missed job. The baseline is read
before the first database poll, or a job enqueued in between would wait for
the safety net. Neon drops idle connections when it scales to zero, so the
worker reconnects on `OperationalError`. The control plane otherwise stays
direct Postgres (decision 1); `Store` remains the seam for HTTP later.

`queuetest` proves the gating: an idle worker polls the bell and not the
database, a job enqueued without a ring is not claimed, a ring is answered
within two intervals, and a broken doorbell falls back to a slow poll.

### 11.3 Media: local, then Blob, then generate — and publishing heals

`pipeline/media.py` puts a private Blob store behind `work/cache/`. Keys are
cache paths, so the local cache is a mirror. Images (every attempt, rerolls
included), narration and alignment are uploaded; narration because Kokoro is
seeded but not promised bit-identical across torch builds, and a different
wav plans different shots. Segments are not uploaded.

**Measured on the real model and the real store:** worker A was SIGKILLed after
shot 4; worker B, on an *empty* disk, took the narration, the alignment and
all seven of A's images (three were rerolls) from Blob, reproduced A's reroll
decisions from those bytes, and generated only S05 onward. Drift +0ms. The
film downloaded from Blob is byte-identical to the local render.

**What the run found:** one transient `BlobUnknownError` on S09's upload failed
attempt 2. Attempt 3 finished the film, at attempts 3 of 3, but S09 was a
*local* cache hit on attempt 3 and publishing only followed generation, so
the timeline named a still the store did not have. Two fixes: uploads retry
with backoff before a failure reaches the job, and every artifact a run
*uses* is published (one indexed-key query when already there). The repair
was confirmed on the real store. `queuetest` now injects upload failures and
checks that a cache built without a store is published by the next run.

Two more, found writing the tests: the `media` index must be keyed per store
(otherwise a new store inherits the old index and nothing is uploaded to it),
and a fetched file is checked against the size recorded at upload, because a
key addresses inputs rather than bytes and nothing else would notice a short
download (the same failure as 10.2, from the network instead of a kill).

### 11.4 Browser media

The browser fetches private media through short-lived presigned URLs signed
locally from one store-wide token per function instance (1.2s to issue once;
~1ms per URL). Measured: range requests return 206, so video seeks, and
repeat reads are CDN hits that cost no metered operations. Nothing streams
through a function. Filmstrips read frames out of a per-film WebP contact
sheet (`production.contact_sheet`) by CSS background position: one upload per
film instead of one per shot, a few hundred KB per page instead of megabytes.

### 11.5 Validators run once, in Python

`docs.check()` is the single entry point for both slot modes. The web app calls
it through a Vercel Python function (`web/api/validate.py`), so the UI and the
worker cannot disagree. Vercel bundles only `web/`; `includeFiles` with `../`
fails the deploy and a symlink arrives dangling, so a prebuild step copies
`pipeline/{__init__,docs}.py` into the bundle. Warm calls ~0.35s.

### 11.6 Observed in the artifacts

- **An anachronism QA cannot see.** S03/S04's prompt asks for "a distant Roman
  watchtower"; klein painted a medieval stone keep. Image QA checks sharpness
  and near-duplicates, not history. Correct prompts do not guarantee correct
  pictures; this belongs to the Phase 4 editing page.
- Images ran 19-21s against the 15.3s median during the takeover run, with
  ~80 MB free memory (Docker VM, iCloud sync, VS Code resident). Swapouts rose
  only ~44k pages over the run, not 8.9's millions. Load, not a regression.

### 11.7 Web app conventions

- Next.js 16 with Cache Components: every session read sits behind a
  `<Suspense>`, and `getUser()` calls `connection()` first, because reading
  cookies does not by itself stop a prerender from freezing `Date.now()`.
- Auth: named accounts (`python -m pipeline.jobs adduser`), scrypt hashes in a
  format both Python and `node:crypto` read, HMAC-signed session cookies with a
  per-user epoch for sign-out-everywhere. The proxy only checks signatures (no
  database); `requireUser()` is the authority on every page and action.
- Design context lives in `web/PRODUCT.md`; run impeccable with
  `IMPECCABLE_CONTEXT_DIR=web` so the repo-root DESIGN.md (pipeline contracts)
  is not read as a visual design file.

### 11.8 Claude writes the documents: `claude -p` on the light lane

Research and script jobs run `claude -p` headless on the worker's Claude Code
sign-in (not `--bare`, which skips the keychain where a subscription lives),
in an empty temporary directory, research with WebSearch and WebFetch only.
The document, its `prompt_log` row and the job's completion commit in one
fenced transaction. A usage limit fails at once with a pointer to paste mode
(failure mode 12); a malformed reply is kept as an `invalid` version.

Measured on the first real film ("What did Roman soldiers eat on Hadrian's
Wall?", 5 minutes):

| | research | script |
|---|---|---|
| run | 57 turns, 595 s | 1 turn, 188 s |
| equivalent cost | $2.29 | $0.47 |
| result | 41 claims, 25 distinct sources, all pages answered | 28 beats, ~800 words, valid |

The research is specific and sourced to Roman Inscriptions of Britain and the
Vindolanda Trust. Paste mode offers "Copy instructions for Claude": the
studio's own prompt, from the same Python (`pipeline/webapi.py`), so the
fallback asks exactly what the worker would.

**Source URLs are checked live.** `docs.check(verify_sources=True)` asks every
cited page whether it exists: 404 or no such host is an error (a constructed
URL), 401/403/429 a warning. From the Mac this tells invented pages from real
ones. **From Vercel it cannot:** the British Museum answers 403 to every page
from a datacenter address, real or invented. Claude's research is checked on
the worker and so is fully verified; pasted research, checked in the Vercel
function, degrades to "could not confirm". Follow-up: run the paste path's
source check on the worker too.

### 11.9 The image model does not know history; the prompts must

Looking at the artifacts found four failures the metrics never would. Each was
fixed at the source and measured on the real model, same seed, before and after:

1. **No period, no history.** "A soldier" came back in a brimmed hat and
   19th-century work clothes. Fix: script front matter `period`, prepended to
   every image prompt.
2. **Period alone is not enough.** "The auxiliary Victor" came back in First
   World War helmets under an electric light bulb. Naming the equipment fixed
   it outright. Fix: `protagonist` and `protagonist_look` in front matter, the
   look spliced into every visual that names them (`Style.prompt_for`), and a
   writer rule to name every light source in period terms.
3. **Places become castles.** A period line of "the fort at Vindolanda behind
   Hadrian's Wall" put a crenellated stone castle in all three looks; "Roman
   Britain, about AD 100, the northern frontier" on the same seed did not. The
   barbarians film's "Roman watchtower" (11.6) was the same failure. Fix: the
   period line names era and region only; the validator warns otherwise.
4. **One reference, many people.** Every shot conditions on one character
   crop, so a script with a clerk, a trader, a cook and an officer would paint
   them all as one man. Fix: the writer follows one protagonist; others are
   hands, tools or distant figures.

The look stage now tells the reviewer to check period details before choosing,
because the painter cannot. Residual, seen in the first real render: a bronze
measure painted like a metal bucket, an oil lamp like a later lantern. Those
belong to the Phase 4 editing page.

`Flux2KleinEdit` cannot paint without a reference (its predict step
concatenates the reference latents unconditionally). Candidate looks need
none, so `Flux2Klein` borrows the edit model's loaded weights rather than
loading a second 4.3 GB copy: peak RSS stayed 4.3 GB alternating both.

### 11.10 The narration gate met its second script

The first real script failed the gate in three beats, every word present in
the audio. Greedy CTC ran two words together: SOUTH SHIELDS -> SOUTHSHIELDS,
NICK HODGSON -> NICKHODSEN, EXTRA MODIUS -> EXTRAMODIUS, which aligns as a
deletion plus a substitution, the exact shape of a dropped word. HANDOFF risk 5
predicted this kind of miscalibration from a single-script baseline.
`align.deletions` now calls a deletion a merge only when the word at the
adjacent script position was heard as this word joined to it; anything else
still fails. `pipeline.gatecheck` after the change: 6/6 dropped content words
caught, silent on good audio, identical to 9.6. The alignment cache key moved
to `align-v2`, because the cached alignment carries the gate's verdict.

**Then the third script (the Aztecs) failed it again, on correct audio.** Three
beats broke the 18% WER backstop, every error a Nahuatl name spelled by ear
(NAHUATL -> "NOW OTTLE", TENOCHTITLAN -> "TENACHTET LAN") or a compound split
(EVERYONE -> "EVERY ONE"; a split costs two WER points for one spoken word),
and "CAN SEAL" heard as "CONCEAL", a merge by sound rather than by spelling.
The backstop now rejoins splits and does not count substitutions spelled like
the script's word (`align.effective_wer`); merges are recognised by sound.

That loosening cost the negative control a catch: content words went from 6/6
to 5/6. Cutting EVENINGS out left a scrap the recogniser heard as "ETN", and
the old WER catch had only cleared 18% because of unrelated spelling noise. A
long word heard as a short scrap unlike it is now its own detector. Result:
6/6 content words caught, all by the specific detector, none by WER luck; zero
fires across all 198 real beats on disk (three scripts). Cache key `align-v3`.
The lesson is HANDOFF risk 5 made concrete: each new topic brings vocabulary
the English recogniser has never heard, so the gate is judged on what it
catches (`gatecheck`) and what it spares (every real alignment), never on one.

### 11.11 The look stage

Three candidates of the hero beat on fresh seeds, no reference (~15 s each).
The user picks one and frames the character in a crop editor (drag, corners,
arrow keys; a live preview of exactly what conditions the shots; a warning
above 45% of the frame). The worker builds the crop from the frame and box on
first use and records it on the style (`refs/<sha>.png`); a queue test checks
the crop's exact pixel size and that every shot conditioned on it. Candidates
painted before the current script was approved are set aside, never offered.

### 11.12 Deployment state

Neon (free, us-east-1) is connected to the Vercel project and migrated (001-003).
`SESSION_SECRET` and `WORKER_TOKEN` are set for production and preview. The
worker's secrets are in `~/.config/youtube-majed/worker.env` (direct Neon
URL: psycopg's prepared statements do not survive the transaction pooler).
A protected preview deployment was verified: sign-in redirect, the Python
function (prompts and checks), and the doorbell on Vercel's runtime cache.
Production deployment and installing the launchd agents are left for the
owner. Preview deployments share the production database; branch it before
previews carry real work.

### 11.13 The first real film, measured

Topic to finished video, driven through the browser: research (Claude, 10 min),
script (Claude, 3 min; revised twice under the rules in 11.9, once by paste),
look (3 candidates, 52 s), render (22 min: 54 images at a median 17.25 s,
4 QA rerolls, 0 flagged; 50 segments; drift +8 ms).

- **The film runs long:** 360 s against a 300 s target. 802 words in 360 s is
  134 words a minute; the script budget assumes 150 (docs.WPM). Kokoro's pace
  plus 28 inter-beat pauses (0.35 s each) explains it. Calibrate the budget to
  the voice before the next phase; the validator's +/-25% band passed it.
- **Character consistency held** across all 50 shots under one crop.
- **Residual anachronisms are small objects:** a brass lamp with a glass
  chimney, a hanging glass lantern, one log-cabin-like hut. For the Phase 4
  editing page.

### 11.14 Style held only where the character was

The Aztec film (look: "make it stick figure doodles") came back consistent in
character and inconsistent in style: storybook watercolour where the character
stood, photographs where he did not (an empty lake, a desert). Three causes,
read off the prompts:

1. The style was five words at the front of a 400-600 character prompt, and
   phrased as an instruction, which the model does not take.
2. The shot planner's framing ladder spoke camera ("shallow depth of field,
   background dissolved"): the same lake shot came back drawn under one
   framing and photographed under the other.
3. The candidates never were doodles (this model will not draw stick figures
   for detailed scenes), so the chosen frame, which conditions every shot,
   pulled one way while the words pulled another.

Fixes: the style opens *and* closes every prompt (`all of it as <style>`),
instructions are reduced to descriptions (`config.style_text`), the framing
ladder describes composition instead of lens, and the look's words are edited
at lock time to describe the chosen frame. Measured on four of the drifting
shots, same seeds and reference: the new shape alone removed every
photographic frame; words matching the chosen frame ("hand-drawn storybook
illustration, ink outlines, soft watercolour washes") held one look across
lake, reeds and desert. Also fixed: the protagonist splice broke possessives
("the farmer, a lean man...,'s hands") and could leave double commas.

These change every prompt, so earlier films repaint their frames on their next
render. Also added: "Stop the render" on the progress view; there was no way
to stop a render from the app.

### 11.15 Going live: three things only production showed

- **Background agents cannot read ~/Desktop.** macOS privacy protection (TCC)
  blocks launchd agents from Desktop and Documents; the agents exited 78
  (EX_CONFIG) without a line of output, and a probe agent running `ls` on the
  repo got "Operation not permitted". Hand-started workers had worked only
  because they inherit the terminal's permission. Rather than grant an
  interpreter Full Disk Access or move the repo, `deploy/install-worker.sh`
  installs the worker as an app under ~/Library/Application Support with the
  repo venv's exact package versions, logs under ~/Library/Logs/youtube-majed.
  Re-run it after changing pipeline code: it is the worker's deploy step.
- **launchd's PATH has no /usr/sbin,** so the worker could not run `scutil`
  and took the DHCP address as its id (192.168.1.111), the exact failure 10.3
  warned of. Both plists now carry /usr/sbin:/sbin; the id is MacBook-Pro-3.
  Also, `launchctl bootout` is asynchronous: bootstrapping straight after it
  failed silently and left the old process running; the installer waits.
- **Production shipped with no utility classes.** Tailwind's automatic source
  detection found nothing on Vercel's build machine (the deploy is assembled
  from the repo root with web/ as the project root); `next dev` and a local
  build were fine, which is where every screenshot had been taken. Sources are
  now named in globals.css; a preview build carries the classes.

`claude -p` runs from a launchd agent on the subscription sign-in (probe:
"ok"). Live state: production on Neon with migrations 001-004, account
`majed`, both agents running on the doorbell.

## 12. Phase 4 findings — verified on this machine

The editing page, the edit agent, chunked delivery and immutable cuts are
built. Every number below was measured with real Claude, the real klein model
and the real Blob store, driving the page in Chrome; the local worker ran
against the local database. Production (Neon, Vercel, the installed agents)
has not been updated: section 12.11.

### 12.1 The exit, measured

"the mood at 1:24 doesn't match", typed into the editing page of the Aztec
film and timed by a browser script from the click on "Make the change":

| | seconds |
|---|---|
| request saved, picked up by the worker | 0.9 |
| Claude: find the shot, look at it and its neighbour, set a mood (3 turns) | 8.6 |
| paint the shot (one attempt, passed QA) | 23.4 |
| segment, two chunks, uploads (4.3 MB), contact sheet | 11.9 |
| the click itself, and the page noticing and showing the new cut | 3.2 |
| **new cut on screen / ready to play** | **47.9 / 50.1** |

Claude's change was S13 only ("cooler, level daylight, thoughtful and
questioning rather than radiant"), reasoned against the narration and the
shot before it, and its one-line summary said so in plain words. The two
attempts before the passing one took 111.5 s and 55.3 s; what they found is
12.6.

### 12.2 One chunk per shot, played as HLS: the film is no longer one file

Re-stitching the Roman film (6:00, 50 shots) with the old full-film `xfade`
pass took **105 s**, and the result was an 87 MB upload against a 1 GB store
per edit. Neither fits a 60 s exit. So each shot's stretch of the film is now
its own content-addressed MPEG-TS chunk (the shot's segment plus the
dissolve into the next), placed by integer frames, and the browser plays the
chunks as HLS beside one narration stream. An edit to one shot re-encodes two
chunks (**2.1 s each**), uploads ~4 MB, and undo costs nothing because every
cut's chunks are already in the store.

- **The chunked film equals the old stitch:** 10,813 frames each, per-frame
  PSNR 32 dB minimum, 43 dB median against the full-film render of the same
  timeline. A full render is no slower: 112 s one chunk at a time, 89 s four at
  a time (x264 threads well alone).
- **Timestamps had to be fixed by hand.** Muxed separately, the video landed
  45-67 ms after its narration: ffmpeg shifts each stream by its own start
  delay (B-frame reordering on one side, AAC priming on the other). With
  `-muxdelay 0 -avoid_negative_ts disabled` and an explicit base of 10 s, the
  first frame of chunk i is presented at exactly 10 + F_i/30 and the first
  narration sample at 10.000 (selftest checks every chunk).
- **The store serves this without a proxy.** Presigned private URLs answer
  cross-origin GETs (`access-control-allow-origin: *`), and Chrome's byte-range
  reads go through without a preflight (206). Playlists are written per
  request with fresh signatures; nothing streams through a function.
- **The narration is read in slices.** As one 7.9 MB segment, the player
  downloaded all of it before starting (7.6 s of the 55 s run). Written by
  ffmpeg's HLS muxer as one file with 6 s byte ranges, it is also smaller
  (6.5 MB for six minutes) and playback starts after the first slice.
- **The mp4 is made on request** ("Prepare a download"): the chunks
  concatenated by stream copy plus the narration encoded once, under 3 s.
  Uploading one with every render would halve how many films fit in the store.
- Cost on the free tier: a render now uploads 50 chunks rather than one film,
  about 110 uploads per film against 2,000 a month. Upload speed from this
  Mac measured 1.7 MB/s.

### 12.3 The agent: `claude -p`, one MCP server, tools that never paint

The tools of section 3 (plus `view_shot`) are a ~200-line stdio MCP server
(`pipeline/edit_tools.py`) over a draft of the timeline; `claude -p` is
started with it as its only tool server. Tools change the draft and mark
shots for repainting; the worker paints after Claude exits. Measured on the
exit request:

| model | seconds | turns | |
|---|---|---|---|
| Haiku | 13.2 | 4 | |
| Sonnet | 50.7 | 4 | |
| Opus, default effort | 11.3-21.1 | 4-5 | the only one to weigh the neighbouring shots |
| **Opus, `--effort low`** | **8.5-9.2** | 3 | same decisions; still looked and boxed regions on a harder request |

The CLI's own start-up is ~3.5 s of each run. The shot list (timecodes, words,
description, mood) is in the prompt, so Claude rarely needs more than
resolve, look, change.

### 12.4 Pickup: the doorbell runs hot while someone is editing

At 15 s a doorbell poll would spend a quarter of the budget waiting. The
editing page marks the doorbell "hot" for five minutes and renews it every
four while open; a hot bell is polled every 2 s. An hour of editing is about
1,800 invocations. Measured pickup: under 1 s.

### 12.5 Retouching: whole-frame edits change what they were told to keep

Klein edits a still well when the still is the reference: the composition
holds (the full-frame effect section 8.11 avoids, used on purpose). But asked
to replace the glass lantern in the Roman grain store, it also turned the
bronze measure in the other man's hands into a clay pot, in two of two
attempts, with the instruction naming the measure as something to keep.
**Region retouch fixed it:** Claude boxes the object on the frame it viewed,
only that region (plus a 6% margin) is repainted at ~768 px and feathered
back in, and every pixel outside is unchanged (queuetest checks this). It is
also faster: 13.4 s against 27 s for a whole-frame retouch.

### 12.6 What the failed runs found

- **QA fought the film.** S13 is the second shot of S12's beat: the same
  scene, another framing, distance 12-14 from S12 since the first render. A
  repaint held to the absolute adjacent limit (14) failed three times, 68 s of
  a 99 s edit. An edit is now held to the picture it replaces: a neighbour it
  was already close to keeps that distance as its limit, never below the
  duplicate floor (8).
- **One index lookup per chunk.** Publishing a cut asked the media index about
  all 50 chunks, one query each; from the Mac to Neon that is ~5 s. Now one
  query per cut.
- **"At 0:00".** Before the film is played, the playhead sent with a request
  meant nothing and told Claude the wrong place. It is sent only once the user
  has played or moved the film.

### 12.7 Cuts: immutable versions and a pointer

Every edit is a new `timelines` row with `parent_version` and `change` (the
request, Claude's summary, the operations); `projects.timeline_version` says
which cut the film is. Undo moves the pointer to the parent. An edit made
after an undo branches from there and the undone cut stays in the list. An
edit that finishes on a cut that is no longer the film (someone chose another
meanwhile) is refused, not applied (`FilmMoved`). A/B on the page switches
between a cut and its parent at the same playhead (hls.js's start position;
a plain seek after load is overridden by it).

### 12.8 Other decisions

- Claude cannot change the narration: no tool adds, removes or retimes a
  word, and cuts move only onto word boundaries. A request that needs a new
  line is answered, not attempted.
- `split_shot` paints the new half closer (the next framing on the ladder) or
  from a given description, with the opposite Ken Burns move, so the cut
  between two pictures of one scene does not read as a stutter.
- The timeline now records the period and protagonist every prompt was built
  from, so an edit rebuilds a prompt exactly as the planner did. Older films
  read them from their approved script.
- Edits run on the GPU lane (the model is warm there); the GPU worker's
  launchd PATH now includes `~/.local/bin` for `claude`.
- The cutting step: uploads now run four at a time and the contact sheet is
  built while they go, which took cutting from 11.9 s to 10.7 s (job 44.0 s on
  the next mood edit). What is left is CPU: the changed shot's Ken Burns
  segment (2.7 s, of which the zoompan filter is 1.65 s) and its two chunks
  (4.8 s; x264 already uses every core, so encoding them in parallel gains
  nothing over one after the other).

### 12.9 Keeping the store whole: heal-cuts and prune-films

Two operator commands (`pipeline/upkeep.py`), both checked by the queue test:

- `jobs heal-cuts` makes every cut playable from the store: a cut from before
  chunks is cut into them from its own timeline, anything the store lacks is
  uploaded, and only the cut's `media` is rewritten (derived delivery data;
  its shots are untouched, which the test asserts). Run on the local
  database: 12 cuts healed, 2 already fine, 0 skipped; the Roman film's
  first cut, once a 218 MB mp4, then played from chunks in Chrome.
- `jobs prune-films [--apply]` deletes whole-film mp4s no cut points at, and
  exports (rebuilt from chunks in seconds; the page goes back to offering a
  download). After the heal, all four mp4s in the store, 519 MB of 870 MB,
  are unused. The delete itself has not been run (12.10).

### 12.10 Browsers

Chrome (hls.js) and WebKit were both driven: in WebKit through hls.js, as
desktop Safari takes it, and through WebKit's own HLS, the path iPhones and
iPads take (`use-film-source.ts` falls back to it without Media Source
Extensions). Both played the chunks and the byte-range narration, with one
audio track, seeking and playback.

### 12.11 Not yet done

- **Production is on Phase 3 code.** Shipping Phase 4 is, in this order:
  1. migration 005 on Neon: `DATABASE_URL=<direct Neon URL> python -m
     pipeline.jobs migrate`. Additive (new columns, two more job kinds), so
     the Phase 3 app and workers carry on unaffected;
  2. `vercel deploy --prod` from the repo root. Its pages read the new
     columns, so not before step 1;
  3. `deploy/install-worker.sh`. Not before step 2: a Phase 4 worker no
     longer uploads a whole-film mp4, which is all the Phase 3 page can play.
  Phase 3 films keep playing from their mp4 and are cut into chunks on their
  first edit (two to three minutes, once), or at once with `jobs heal-cuts`.
- `python -m pipeline.jobs prune-films --apply` (with `DATABASE_URL` at the
  database whose cuts were healed) frees 519 MB of the shared store.
- The Phase 3 exit run by the non-technical user on production is still
  outstanding (HANDOFF section 2).

---

## 13. Phase 5 findings — verified on this machine

Hardening: section 5 worked row by row, the pins, and the smoke test. Every
number below was measured on the real models on this Mac. `selftest` is now
148 checks, `queuetest` 127; the checks named below are their labels.

### 13.1 The failure table, row by row

| # | Failure | What covers it now | Accepted risk, and why |
|---|---|---|---|
| 1 | TTS drops a word | The narration gate, already built (9.6). `gatecheck` is its negative control on the full script. The smoke test now runs the same control **every night** on one word: "the narration gate did not notice ... cut from the audio" fails the run. | `force` passes the gate on purpose. Only the operator CLI can set it (the studio cannot), and it stays in the job's payload. The editing room flags runs of unheard words as a backstop (13.4). |
| 2 | Hallucination reaches publish | Citation validators (selftest "uncited beat is rejected", "dangling citation is rejected"). New: "a live source passes and a dead one is an error naming its claim", against a local HTTP server. | Whether a page *says* what its claim says is not checked by machine. The human approval gate is the mitigation, and its override leaves a name. |
| 3 | Stale artifact used | queuetest "a job pinned to a superseded script refuses to run", plus upstream-hash checks. | The staleness banner on the document page has no automated UI test; it was checked by hand in Phase 3. |
| 4 | Worker dies or sleeps | Lease, fencing, kill/resume and takeover checks (Phase 2). New: "the studio's offline banner uses the worker's own offline threshold". | The banner's rendering is not tested by machine. |
| 5 | Aligner drift | New: "overlapping words are fatal", "a word timed before the one it follows is fatal", "a long word with no audio is fatal", and two new gate assertions, "a beat index that runs past its audio is caught" and "beats that overlap in the index are caught" (alignment cache key moves to v4). The editing room flags suspicious spans (13.4). | A run that crosses a shot boundary splits between two shots, and each half is judged alone. |
| 6 | Bad image | New: blurred, flat, black, copy-of-reference and adjacent-duplicate checks on `qa.inspect`. A shot that fails after its rerolls is **flagged in the editing room** with the reason in plain words. | No CLIP prompt-similarity or aesthetic score: no embedding model has cleared a licence review (same reason as 9.10). The flag puts a person on the shot instead. |
| 7 | OOM, swap | One GPU worker per root (queuetest). New: each job's "done" event records the **pages swapped out** during it, with a warning past 50,000 (~0.8 GB). selftest checks the `vm_stat` parse. | No hard memory limit is set. The measured peak is 5.4 GB of 36 GB (section 3), and a limit would turn a slow job into a failed one. |
| 8 | Disk fills | The free-space floor now holds for **every GPU job** (edit, export, look), not only renders: "a job on a disk below the floor is put back with the reason, before any work". `prune-films` frees the store. | No per-project quota: the cache is content-addressed and shared across projects, so a per-project share of it is not well defined. The local cache is 1.2 GB with 180 GB free. The "alert" is the job's own error ("only N GB free"); there is no push alert. |
| 9 | Blob upload fails | Upload first, pointer second, with retries (queuetest, Phase 3). | — |
| 10 | Dependency drift | **Pins** (13.2): packages locked, model files hashed, the worker claims nothing on drift. **Smoke test** (13.3): nightly in the idle worker, and as a gate in `deploy/install-worker.sh`. queuetest "a worker whose pins have drifted claims nothing" and "a smoke test on a generator that paints flat frames fails, on QA", then "...and the worker stops claiming GPU work" and "once a smoke test passes again, it takes the waiting job". | "Vendor workflow JSON" does not apply: ComfyUI is not in the production path. |
| 11 | ffmpeg edge case | Sync and chunk-timestamp checks (Phases 1 and 4). New: "an odd frame size is refused before ffmpeg sees it", and narration ±0.6 s off the timeline still gives a film exactly the timeline's length. The smoke test re-checks every chunk's frames and timestamps with the installed ffmpeg each night. | — |
| 12 | Claude rate limit | queuetest "a usage limit fails the job at once, without retrying". Paste mode is the degrade path. | The switch to paste mode is the person's choice, offered on the page, not automatic: someone has to write the pasted document anyway. |
| 13 | Model pulled, relicensed | The **licence register is keyed by checkpoint hash** (`pins.MODELS` plus `pins.lock.json`), and all three models are licence-checked at load (the TTS and aligner were not before). `pins archive DEST` copies the weights as a hub cache and verifies the copy: "with the cache gone, the archive alone verifies". Each timeline records repository, commit and a weights digest. | The archive has not been run to a second disk yet (operator step, HANDOFF 2). |
| 14 | YouTube quota | Not built: Phase 6. | No exposure until something uploads. Phase 6 inherits the row's rules: queue publishes, respect quota, never auto-retry on a quota error. |
| 15 | MacBook is a single point of failure | The worker is stateless: "worker B, on an empty disk, completes the job" through the store. | Relocating it is a config change **only to another Apple Silicon Mac**. The image runtime is MLX, so a rented Linux GPU needs the ComfyUI path (Phase 0's `comfyui` backend) built out first. Section 2's "config change" claim holds for the queue and the store, not the image runtime. |

### 13.2 Pins: what was actually loading

Tracing every file the three loaders opened in an offline load found:

- **Nothing was pinned.** Kokoro and wav2vec2 resolved `refs/main`. mflux
  keeps its own pin table and pins the base klein repo, but not
  `mlx-community/flux2-klein-4b-4bit`, which is what this pipeline loads. So
  a fresh machine would have downloaded whatever `main` was that day.
- **The base klein repo is never read.** mflux names it as an architecture
  alias; everything comes from the 4-bit snapshot. Its cache folder holds
  1.7 GB of `.incomplete` bf16 downloads left over from Phase 0, which are
  safe to delete.
- **Kokoro takes no revision**, so it is handed the pinned `config.json` and
  `.pth` paths, and the voices are loaded up front into the dict it checks
  before downloading. The output is **sample-identical** to the unpinned
  loader. The seed still hashes the voice *name*, so cached narration stays
  valid.
- **Newer hub versions keep a second, shared blob store** named by Xet hash.
  The SHA-256 name is on the snapshot's first link only, so following every
  link compares the wrong hash (the first quick check failed on every weight
  file for this reason).
- A deep re-hash of all 5.5 GB takes **2.2 s**, so it runs every night
  inside the smoke test. The quick start-up check reads no bytes: it compares
  sizes and the blob names the hub derives from SHA-256.
- **Pinning moved no content address.** Each model's identity is the name its
  cache was built with, at the revision it was built at
  (`pins.Model.identity`). Moving a pin appends the revision, so the old
  weights' images, narration and alignments are regenerated, not reused.
- The worker runs with `HF_HUB_OFFLINE=1`, so provisioning is a deliberate
  step (`pins fetch`) and never something a job does halfway through.
  `requirements.lock` is committed, and the deploy script syncs from it
  instead of freezing whatever the repo venv held.

### 13.3 The smoke test: deterministic, so drift means something

`python -m pipeline.smoke` runs `production.run` on the first two beats of
the Phase 1 script (52 words, 21.45 s, 3 shots) from an empty cache. It took
107 s and 161 s cold, ~1.5 min warm in the worker.

- **Repeat runs are identical.** On a second cold run, all three stills were
  at dHash distance 0 from the goldens. The narration was byte-identical, and
  S03 needed the same one reroll (adjacency rule, distance 20 from S02 on the
  passing attempt). So `IMAGE_TOLERANCE = 4` and a one-frame word tolerance
  leave room only for real change.
- **Invariants fail the run; drift reports.** The invariants are: the gate
  passes on good audio and fires on a cut word, every shot passes QA, the
  timeline is contiguous, and every chunk has its exact frame count and
  first timestamp. A failure stops the worker claiming GPU work (retried
  hourly). Drift is a difference from the goldens. The nightly run reports
  it; the deploy gate (`--strict`) refuses it until someone looks at
  `work/smoke/` and re-records.
- **Nightly, in the worker.** It runs only right after a database poll found
  nothing to do, so a queued job never waits behind it, and it writes its
  result while the database is awake anyway. While it runs, a thread keeps
  the doorbell polled, so the studio does not show the machine offline.

### 13.4 Flags in the editing room, calibrated before they were shown

Every shot already carried its QA verdict and per-word aligner scores, so the
flags are derived in `lib/cuts.ts` with no pipeline change.

The obvious rule, any word under `WEAK_WORD_SCORE` (0.25), was measured
against the three local films, all watched and judged right. It would have
flagged **25 of ~150 shots**, mostly names (Nahuatl, Huitzilopochtli,
Catterick) and short words ("of", "two"). A flag on a sixth of good shots
teaches people to ignore it. So the opposite case was measured too:
time-reversing three words of real narration (same length, unintelligible)
left **every one of them** under 0.25, three times out of three. Across all
three good films there was **no run of even two**. So the editing room flags
runs only. The narration gate also failed all three mangled spans outright,
so in practice this flag catches films forced past the gate.

### 13.5 Health: what the studio is told

`workers.health` (migration 006) holds the pins report and the last smoke
run. It is written on polls the worker makes anyway, so an idle worker
still lets Neon sleep. The studio header stops saying "ready" when the
machine is refusing work, and a banner says why in plain words, with the
machine's own words folded away for whoever maintains it. Drift alone gets
a quiet one-line notice ("Test film changed"); films still render.

### 13.6 Shipped, and what is left

Shipped on 26 Oct 2026, in this order: `deploy/install-worker.sh` (pins and
the strict smoke test first; the new worker applied migration 006 to Neon on
start), then `vercel deploy --prod`. Checked on Neon afterwards: migration
006 applied, both workers report no pin problems, and the production
worker's first smoke test passed with no drift in 177 s.

The weights are archived at `~/Desktop/youtube-majed-model-archive` (5.0 GB,
21 files). `pins check --deep` passes with `HF_HUB_CACHE` pointed at it. It is
on this Mac's own disk: it covers a model pulled upstream or a cleared cache,
not a lost drive. A second copy off this machine would cover that.

Carried over from 12.11: `prune-films --apply` and the Phase 3 exit run.
