# youtube-Majed — research-to-video pipeline

Internal tool. A topic goes in, a researched, narrated, illustrated video comes out,
with a human gate at every point where a mistake would be expensive.

- **[PLAN.md](PLAN.md)** — stack decisions with licences, phases, efficiency design,
  failure hardening
- **[DESIGN.md](DESIGN.md)** — state machine, artifact contracts, validators, schema

## Where we are

**Phases 0–2 are complete.** `python slice.py` turns a hardcoded topic and
style into a 61.7s narrated, illustrated video with a timeline JSON that fully
describes it — 279s cold, 17s warm. The same stages run as queued jobs under a
Postgres-backed worker that can be killed mid-job and resumes without
regenerating a finished shot (PLAN.md section 10). Phases 3–6 (the web app, the editing page, hardening, publishing to YouTube) are built too; [HANDOFF.md](HANDOFF.md) has the current state.

## Running the worker

```bash
docker compose up -d --wait                                  # local Postgres 17
uv pip install --python .venv/bin/python "psycopg[binary]==3.3.6"
.venv/bin/python -m pipeline.queuetest                       # queue + kill/resume checks
.venv/bin/python -m pipeline.jobs seed --allow-fixture-sources
.venv/bin/python -m pipeline.jobs enqueue barbarians-01 --allow-fixture-sources
.venv/bin/python -m pipeline.worker
```

## Running the slice

```bash
# weights-free checks first: 51 of them, including the ffmpeg sync arithmetic
.venv/bin/python -m pipeline.selftest

# the slice: topic -> work/barbarians-01/out.mp4 + timeline.json
.venv/bin/python slice.py --allow-fixture-sources

# inspect the plan without spending the GPU budget
.venv/bin/python slice.py --allow-fixture-sources --dry-run
```

Stage order is the point, and it is cheap-stages-first:

```
validate -> narrate -> align (+ gates) -> plan shots -> timeline -> images -> render
```

Audio is generated **before** images, and shot boundaries come from real
word-level timestamps, so sync is structural rather than something fixed
afterwards. The video is not the artifact — `timeline.json` is, and every
renderer is a pure function of it.

`--allow-fixture-sources` is required because Phase 1 runs from a hand-written
research fixture whose claims carry a `FIXTURE` source sentinel. The validator
rejects it by default so hand-written claims cannot be mistaken for researched
output.

## Running the benchmark

```bash
# validate the harness itself — no weights, no downloads, a few seconds
python3 -m bench.run_bench --backend synthetic

# the real measurement (needs the venv below)
.venv/bin/python -m bench.run_bench \
    --backend mflux-warm \
    --quant int4,int8 \
    --res 832x480,1024x1024 \
    --n 8

# what a process-per-image worker would cost, for comparison
.venv/bin/python -m bench.run_bench --backend mflux-cli --quant int4 --n 4
```

Results land in `bench/results/` as JSON plus a markdown report that states a
verdict and a recommendation, not just a table.

### Setup

```bash
brew install ffmpeg uv
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python mflux
```

Python 3.12 rather than the system 3.14: `mlx` ships a cp314 wheel but the wider
ML dependency stack does not reliably, and the benchmark is not the place to
debug wheel availability.

## What the benchmark measures, and why

| Metric | Why it's here |
|---|---|
| **cold load**, separately | Folding weight-load into per-image time inflates it on every image |
| **median, p90, worst** | A 60-shot job waits on the slow tail, not the best sample |
| **peak memory** | Via MLX's own counter where available, `ps` otherwise |
| **swap delta** | On unified memory a run that swaps is not slow, it's invalid — disqualifying regardless of speed |
| **warm vs CLI** | The measured cost of not keeping the model in memory |

Exit criterion: a chosen runtime and a defensible 60-shot estimate. If that
estimate exceeds 60 minutes, the decision to rent a GPU happens now rather than
in Phase 3.

## Licence rules — not optional

This is a commercial tool. Model licences are a business constraint, not a
preference.

**Cleared:** FLUX.2 [klein] **4B** (Apache 2.0) · Qwen-Image-Edit-2509
(Apache 2.0) · Kokoro-82M (Apache 2.0) · FLUX.1-schnell (Apache 2.0)

**Never ship:** FLUX.1-**dev** · FLUX **Redux** · FLUX.1 **Kontext [dev]** ·
klein **9B** · XTTS-v2 · F5-TTS weights · Fish-Speech

The trap worth naming: **Redux's non-commercial licence governs the combined
setup even on an Apache-licensed base model.** A clean base does not launder an
adapter. `bench/backends/mflux_klein.py` enforces the cleared set in code.

Full register with sources in [PLAN.md](PLAN.md) section 1.6.

## Layout

```
bench/
  harness.py            measurement: timing, memory, swap, stats
  report.py             markdown report, verdicts, recommendation
  run_bench.py          CLI entry point
  prompts/shots.txt     fixed prompt set — same inputs for every backend
  backends/
    base.py             Backend contract; in-process and subprocess shapes
    synthetic.py        fake backend, validates the harness with no weights
    mflux_klein.py      FLUX.2 klein 4B via mflux: warm and CLI
    comfy.py            ComfyUI HTTP API (SDXL/schnell fallbacks, remote GPU)
```

## Conventions

All frontend work goes through the `/impeccable` skill — every page and every
revision, from Phase 3 onward.
