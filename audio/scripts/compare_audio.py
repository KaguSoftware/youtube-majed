"""Do two videos (or audio files) carry the same soundtrack at the same time?

    uv run python scripts/compare_audio.py <a.mp4> <b.mp4|mix.wav>

Used by the partial re-render proof (remotion/scripts/compare-renders.ts): a
stitched render muxes the mix once, a full render lets Remotion lay it in, and
the two must agree. Decodes both to 48 kHz mono, finds the lag that best lines
them up (cross-correlation of the whole track, searched +-200 ms), then reports
the residual at lag 0 relative to the signal, both band-limited to 100 Hz-6 kHz
(the AAC encoder drops and noise-fills the top octaves differently from one
build to the next, which says nothing about sync). Prints one JSON object:

    {"lagMs": 0.0, "residualDb": -48.1, "seconds": 375.2, "durationDiffMs": 0.0}

lagMs: + means b is late against a. residualDb: power of (a - b) over power of a,
at lag 0 (the sync that matters), in the 100 Hz-6 kHz band.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import butter, fftconvolve, sosfiltfilt

SR = 48000
SEARCH_S = 0.2


def decode(path: str, tmp: Path) -> np.ndarray:
    wav = tmp / (Path(path).name + ".wav")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", path, "-vn", "-ac", "1", "-ar", str(SR), "-c:a", "pcm_f32le", str(wav)], check=True)
    x, _ = sf.read(wav, dtype="float64")
    return x


def main() -> None:
    a_path, b_path = sys.argv[1], sys.argv[2]
    with tempfile.TemporaryDirectory() as t:
        a, b = decode(a_path, Path(t)), decode(b_path, Path(t))
    n = min(len(a), len(b))
    pad = int(SEARCH_S * SR)
    # lag search on the middle of the track: b[pad : n - pad] slid over a
    core = b[pad : n - pad]
    c = fftconvolve(a[:n], core[::-1], mode="valid")  # c[k] = sum a[k + i] * core[i]
    lag = pad - int(np.argmax(c))  # + = b is late
    sos = butter(4, [100, 6000], btype="band", fs=SR, output="sos")
    fa, fb = sosfiltfilt(sos, a[:n]), sosfiltfilt(sos, b[:n])
    residual = 10 * np.log10((np.mean((fa - fb) ** 2) + 1e-20) / (np.mean(fa**2) + 1e-20))
    print(json.dumps({"lagMs": round(lag / SR * 1000, 3), "residualDb": round(float(residual), 1), "seconds": round(n / SR, 3), "durationDiffMs": round((len(b) - len(a)) / SR * 1000, 3)}))


if __name__ == "__main__":
    main()
