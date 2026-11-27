"""Choose the reference clip by measurement: voice the same lines from each
candidate cut and score speaker similarity (Chatterbox's voice-encoder embedding,
cosine, against the FULL recording) plus the alignment gate.

    uv run python scripts/pick_reference.py ../assets/voices/ref-cand-*.wav
"""
import sys, glob
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np, librosa
from studio_audio import config
from studio_audio.align import Aligner
from studio_audio.tts import Voice

cands = [Path(p) for a in sys.argv[1:] for p in sorted(glob.glob(a))]
full = config.VOICES_DIR / "majed-reference.wav"
LINES = [("For forty years, Tom has kept this lighthouse burning.", 2), ("Someone is stealing the oil.", 4),
         ("So tonight, he spreads flour across the floor, and pretends to sleep.", 3), ("The oil started vanishing a week ago.", 4)]
v = Voice("original", "mps").load(); al = Aligner().load()
emb = lambda w16: v.model.ve.embeds_from_wavs([w16], sample_rate=16000).mean(0)
w, _ = librosa.load(full, sr=16000); ref_emb = emb(w); ref_emb /= np.linalg.norm(ref_emb)
for c in cands:
    sims, wers, st = [], [], []
    for i, (t, e) in enumerate(LINES):
        take = v.synth(t, e, 500 + i, c)
        a = al.align(t, take.wav, take.sr)
        g = librosa.resample(take.wav, orig_sr=take.sr, target_sr=16000); g_emb = emb(g); g_emb /= np.linalg.norm(g_emb)
        sims.append(float(ref_emb @ g_emb)); wers.append(a.wer); st.append(a.status)
        if a.status != "ok":
            print("   ", i, a.status, a.heard, "|", a.issues, f"dur={len(take.wav) / take.sr:.2f}")
    print(f"{c.name}: similarity {np.mean(sims):.3f} (min {min(sims):.3f})  wer {np.mean(wers):.2f}  {st}", flush=True)
