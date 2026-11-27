"""Prepare the cloning reference from the full recording.

    uv run python scripts/prepare_reference.py [../assets/voices/majed-reference.wav]

1. cleans the whole recording (denoise + mild EQ) -> assets/voices/majed-reference-clean.wav
2. scores every ~10 s window that starts and ends in a pause: cleanliness (low
   gap noise), brightness close to the recording's own average (not the dull
   stretches), steady level, no clipping, mostly speech
3. writes the winner -> assets/voices/majed-reference-clip.wav (what the service clones)
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np, soundfile as sf
from scipy.signal import welch
from studio_audio import config
from studio_audio.clean import SR, clean_file

src = Path(sys.argv[1]) if len(sys.argv) > 1 else config.VOICES_DIR / "majed-reference.wav"
clean_path = config.VOICES_DIR / "majed-reference-clean.wav"
y = clean_file(str(src), str(clean_path))
print(f"cleaned {src.name}: {len(y)/SR:.0f}s -> {clean_path.name}")

hop = int(0.02 * SR); n = len(y) // hop
fr = y[: n * hop].reshape(n, hop)
db = 20 * np.log10(np.sqrt((fr**2).mean(1)) + 1e-9)
voiced_thr = np.percentile(db, 90) - 20
act = db > voiced_thr
def centroid(seg):
    f, P = welch(seg, SR, nperseg=2048); return (f * P).sum() / P.sum()
whole = centroid(np.concatenate([fr[i] for i in np.flatnonzero(act)]))
win = int(10 / 0.02)
rows = []
for s in range(0, n - win, 5):
    seg_db, seg_act = db[s:s+win], act[s:s+win]
    if not (db[s:s+3].mean() < voiced_thr and db[s+win-3:s+win].mean() < voiced_thr): continue
    if not 0.65 < seg_act.mean() < 0.95 or np.abs(y[s*hop:(s+win)*hop]).max() > 0.9: continue
    gap = seg_db[~seg_act].mean() if (~seg_act).any() else 0
    bright = centroid(np.concatenate([fr[s+i] for i in np.flatnonzero(seg_act)]))
    level_sd = seg_db[seg_act].std()
    score = -abs(bright - whole) / 200 - level_sd - 0.3 * max(gap + 70, 0)  # closer to avg brightness, steadier, quieter gaps
    rows.append((score, s * 0.02, bright, level_sd, gap))
rows.sort(reverse=True)
print(f"recording's average brightness (spectral centroid): {whole:.0f} Hz")
for sc, t, b, sd, g in rows[:5]: print(f"  window @ {t:5.1f}s  score {sc:6.2f}  centroid {b:.0f} Hz  level sd {sd:.1f} dB  gap {g:.0f} dBFS")
best = rows[0][1]
start = int(best * SR)
sf.write(config.CLONE_REFERENCE, y[start:start + 10 * SR], SR, subtype="PCM_24")
print(f"-> {config.CLONE_REFERENCE.name} (10 s from {best:.1f}s)")
