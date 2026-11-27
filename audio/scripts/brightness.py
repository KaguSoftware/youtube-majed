"""How dull is each engine/energy setting? Voice the same line and report spectral
centroid and the frequency below which 95% of the speech energy sits (the clean
reference clip is ~1440 Hz / ~6300 Hz), plus speaker similarity and the gate.

    uv run python scripts/brightness.py
"""
import sys; from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np, librosa
from scipy.signal import welch
from studio_audio import config
from studio_audio.align import Aligner
from studio_audio.tts import Voice
TEXT = "Midnight. Slow footsteps on the stairs, and the whole lighthouse holds its breath."
def tone(w, sr):
    f, P = welch(w, sr, nperseg=2048); c = np.cumsum(P) / P.sum()
    return (f * P).sum() / P.sum(), f[np.searchsorted(c, 0.95)]
al = Aligner().load(); ref = config.CLONE_REFERENCE
def run(engine, settings_list):
    v = Voice(engine, "mps").load()
    emb = lambda w16: v.model.ve.embeds_from_wavs([w16], sample_rate=16000).mean(0)
    r, _ = librosa.load(config.VOICES_DIR / "majed-reference-clean.wav", sr=16000); re = emb(r); re /= np.linalg.norm(re)
    for label, energy, ov in settings_list:
        cs, rs, sims, st = [], [], [], []
        for seed in (11, 12, 13):
            t = v.synth(TEXT, energy, seed, ref, ov); c, ro = tone(t.wav, t.sr); cs.append(c); rs.append(ro)
            g = librosa.resample(t.wav, orig_sr=t.sr, target_sr=16000); ge = emb(g); ge /= np.linalg.norm(ge); sims.append(float(re @ ge))
            st.append(al.align(TEXT, t.wav, t.sr).status)
        print(f"{engine:8s} {label:28s} centroid {np.mean(cs):5.0f} Hz  95%<{np.mean(rs):5.0f} Hz  sim {np.mean(sims):.3f}  {st}", flush=True)
    del v
run("original", [("exag 0.30 cfg 0.5", 1, None), ("exag 0.40 cfg 0.5", 1, {"exaggeration": 0.4}), ("exag 0.50 cfg 0.3", 3, {"cfg_weight": 0.3}),
                 ("exag 0.30 cfg 0.3", 1, {"cfg_weight": 0.3}), ("exag 0.50 cfg 0.7", 3, {"cfg_weight": 0.7}), ("exag 0.25 cfg 0.5", 1, {"exaggeration": 0.25}),
                 ("exag 0.60 cfg 0.5", 3, {"exaggeration": 0.6})])
run("turbo", [("temp 0.8", 3, None), ("temp 0.6", 1, None), ("temp 1.0", 5, None)])
