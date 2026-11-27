"""Speed benchmark: engine x device. Reports seconds of audio per second of compute.

    uv run python scripts/bench.py --engine original --device mps
    uv run python scripts/bench.py --engine turbo --device cpu --lines 4

The first call of each run is a warm-up (MPS compiles kernels on first use) and
is reported separately, not averaged in.
"""

from __future__ import annotations

import argparse
import json
import resource
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from studio_audio import config  # noqa: E402
from studio_audio.tts import Voice  # noqa: E402

LINES = [
    ("For forty years, Tom has kept this lighthouse burning.", 2),
    ("And the lamp has two hours of oil left.", 4),
    ("Someone is stealing the oil.", 4),
    ("Midnight. Slow footsteps on the stairs.", 2),
    ("Tonight, a cargo ship is heading straight into a storm.", 3),
    ("The oil started vanishing a week ago.", 4),
]

ap = argparse.ArgumentParser()
ap.add_argument("--engine", default="original")
ap.add_argument("--device", default="mps")
ap.add_argument("--lines", type=int, default=len(LINES))
ap.add_argument("--ref", default=str(config.CLONE_REFERENCE))
ap.add_argument("--out", default=None)
a = ap.parse_args()

t0 = time.time()
v = Voice(a.engine, a.device).load()
load = time.time() - t0
rows = []
for i, (text, energy) in enumerate(LINES[: a.lines]):
    take = v.synth(text, energy, seed=100 + i, ref=Path(a.ref))
    dur = len(take.wav) / take.sr
    rows.append({"warmup": i == 0, "energy": energy, "audio_s": round(dur, 2), "compute_s": round(take.seconds_compute, 2), "x_realtime": round(dur / take.seconds_compute, 2)})
    print(rows[-1], flush=True)
    if a.out:
        import soundfile as sf

        Path(a.out).mkdir(parents=True, exist_ok=True)
        sf.write(Path(a.out) / f"{a.engine}-{a.device}-{i}.wav", take.wav, take.sr)

steady = [r for r in rows if not r["warmup"]] or rows
audio = sum(r["audio_s"] for r in steady)
compute = sum(r["compute_s"] for r in steady)
summary = {
    "engine": a.engine, "device": v.device, "load_s": round(load, 1),
    "warmup_compute_s": rows[0]["compute_s"],
    "steady_audio_s": round(audio, 1), "steady_compute_s": round(compute, 1),
    "audio_s_per_compute_s": round(audio / compute, 2),
    "peak_rss_gb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e9, 2),
}
print("SUMMARY", json.dumps(summary))
