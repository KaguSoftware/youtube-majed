"""Does the audio really sit where voice.json says? Independent of the bookkeeping that wrote it.

    uv run python scripts/verify_track.py ../projects/lighthouse/audio [--video ../renders/x.mp4]

For every line it cross-correlates the raw take against (a) the mastered narration
track and (b) with --video, the audio decoded from the rendered MP4, searching
+-300 ms around where voice.json says the line starts, band-passed to the speech
range so the compressor/EQ/AAC differences do not matter. The lag of the
correlation peak is the real placement error, to one sample (0.02 ms).
Prints one JSON object.
"""
import json, subprocess, sys, tempfile
from pathlib import Path
import numpy as np, soundfile as sf
from scipy.signal import butter, sosfiltfilt, fftconvolve, resample_poly

SR = 48000
d = Path(sys.argv[1]); video = sys.argv[sys.argv.index("--video") + 1] if "--video" in sys.argv else None
v = json.loads((d / "voice.json").read_text())
sos = butter(4, [200, 3000], btype="band", fs=SR, output="sos")
def load(p):
    x, sr = sf.read(p, dtype="float64"); x = x if x.ndim == 1 else x.mean(1)
    return resample_poly(x, SR, sr) if sr != SR else x
def lag_ms(take, track, offset):
    """lag (ms) of the take inside `track` relative to its expected `offset` (s); + = audio is late."""
    a = sosfiltfilt(sos, take); pad = int(0.3 * SR); s0 = int(offset * SR)
    lo = max(0, s0 - pad); seg = sosfiltfilt(sos, track[lo : s0 + len(a) + pad])
    c = fftconvolve(seg, a[::-1], mode="valid")
    return ((lo + int(np.argmax(c))) - s0) / SR * 1000
narr = load(d / v["track"]["file"])
out = {"track": [], "video": []}
if video:
    with tempfile.TemporaryDirectory() as t:
        wav = Path(t) / "v.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", video, "-vn", "-ac", "1", "-ar", str(SR), "-c:a", "pcm_s16le", str(wav)], check=True)
        vid = load(wav)
for l in v["lines"]:
    take = load(d / l["file"])
    out["track"].append({"id": l["id"], "lagMs": round(lag_ms(take, narr, l["offset"]), 3)})
    if video: out["video"].append({"id": l["id"], "lagMs": round(lag_ms(take, vid, l["offset"]), 3)})
summ = lambda rows: {"maxAbsMs": max(abs(r["lagMs"]) for r in rows), "meanMs": round(float(np.mean([r["lagMs"] for r in rows])), 3), "worst": max(rows, key=lambda r: abs(r["lagMs"]))["id"]} if rows else None
print(json.dumps({"track": summ(out["track"]), "video": summ(out["video"]), "perLine": out}))
