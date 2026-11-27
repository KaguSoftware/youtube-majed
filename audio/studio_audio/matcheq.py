"""Match EQ: nudge the generated voice's long-term spectrum toward the real
recording's, band by band.

Chatterbox's output is consistently darker than its reference (measured:
spectral centroid ~700-1000 Hz vs 1440 Hz). Rather than guess a fixed EQ, the
correction is measured: average speech spectrum of the (cleaned) reference
recording divided by that of generated takes, in 1/3-octave bands, smoothed and
clamped to a few dB. Applied as a linear-phase FIR, so it moves no word in time.
Applied at mastering time, so changing it never regenerates audio.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import soundfile as sf
from math import gcd

from scipy.signal import firwin, firwin2, fftconvolve, resample_poly, welch

def resample(w: np.ndarray, sr: int, to: int) -> np.ndarray:
    """Polyphase resample with a steep filter. Default resamplers leave a mirror image of
    4-12 kHz at 12-20 kHz when going 24 -> 48 kHz (audible as fizz, and the EQ then
    boosts it); this one pushes the image far below audibility."""
    if sr == to:
        return np.asarray(w, dtype=np.float32)
    g = gcd(sr, to)
    up, down = to // g, sr // g
    # Long linear-phase low-pass at the *lower* of the two Nyquists (scipy's default
    # filter is ~41 taps, which leaves the image at only about -47 dB).
    cutoff = 0.985 * min(1.0, up / down) / max(up, down) # fraction of the upsampled Nyquist
    taps = firwin(16 * max(up, down) * 64 + 1, cutoff, window=("kaiser", 12.0))
    return resample_poly(np.asarray(w, dtype=np.float64), up, down, window=taps).astype(np.float32)


MIN_HZ, MAX_HZ = 120.0, 11_000.0
MAX_BOOST_DB, MAX_CUT_DB = 6.0, -6.0  # 8 dB boosted the voice's thin top end into harshness; the takes carry little real content above 8 kHz
TAPS = 2049


def _speech(x: np.ndarray, sr: int) -> np.ndarray:
    hop = int(0.02 * sr)
    n = len(x) // hop
    fr = x[: n * hop].reshape(n, hop)
    db = 20 * np.log10(np.sqrt((fr**2).mean(1)) + 1e-9)
    return fr[db > np.percentile(db, 90) - 20].reshape(-1)


def _bands() -> np.ndarray:
    n = int(np.log2(MAX_HZ / MIN_HZ) * 3)
    return MIN_HZ * 2 ** (np.arange(n + 1) / 3)


def band_levels(x: np.ndarray, sr: int) -> np.ndarray:
    f, P = welch(_speech(x, sr), sr, nperseg=4096)
    edges = _bands()
    centres = np.sqrt(edges[:-1] * edges[1:])
    lv = np.array([P[(f >= lo) & (f < hi)].mean() for lo, hi in zip(edges[:-1], edges[1:])])
    return 10 * np.log10(lv + 1e-20), centres


def calibrate(reference_wav: Path, take_wavs: list[Path]) -> dict:
    """Takes are balanced line to line first (balance_lines), as they are at mastering."""
    ref, sr = sf.read(reference_wav, dtype="float32")
    ref_lv, centres = band_levels(ref if ref.ndim == 1 else ref.mean(1), sr)
    loaded = [sf.read(t, dtype="float32") for t in take_wavs]
    mono = [resample(w if w.ndim == 1 else w.mean(1), wsr, sr) for w, wsr in loaded]  # as at mastering
    takes = [band_levels(w, sr)[0] for w in balance_lines(mono, sr)]
    diff = ref_lv - np.mean(takes, axis=0)
    diff = diff - np.median(diff[(centres > 300) & (centres < 2500)])  # level-neutral in the body of the voice
    diff = np.convolve(np.pad(diff, 1, mode="edge"), np.ones(3) / 3, mode="valid")  # smooth across bands
    gains = np.clip(diff, MAX_CUT_DB, MAX_BOOST_DB)
    return {"hz": [round(float(c), 1) for c in centres], "gainDb": [round(float(g), 2) for g in gains], "takes": len(take_wavs)}


def apply(x: np.ndarray, sr: int, curve: dict) -> np.ndarray:
    # Above the curve (> ~11 kHz) there is nothing real in a 24 kHz voice; do not amplify
    # resampling residue there: bring the gain back to 0 dB by 13 kHz and hold it.
    top = min(13_000.0, sr / 2 - 1)
    hz = np.array([0.0, *curve["hz"], top, sr / 2])
    g = np.array([0.0, *curve["gainDb"], 0.0, 0.0])
    fir = firwin2(TAPS, hz / (sr / 2), 10 ** (g / 20))
    return fftconvolve(x, fir, mode="same").astype(np.float32)


LEVEL_CLAMP_DB = 6.0  # most a line's level is moved to meet the others
TONE_CLAMP_DB = 6.0  # most a band is moved
TONE_STRENGTH = 0.8  # fraction of the measured difference that is corrected (phonetics differ between lines)


def speech_db(x: np.ndarray, sr: int) -> float:
    """Mean level (dB, power) of the speech frames of a line: frames within 20 dB of its loud ones."""
    sp = _speech(x, sr)
    return float(10 * np.log10(np.mean(sp**2) + 1e-12))


def balance_lines(wavs: list[np.ndarray], sr: int, processed: list[np.ndarray | None] | None = None) -> list[np.ndarray]:
    """Give every line the same speech level and the same long-term tone, before mastering.

    Chatterbox's energy settings change timbre as well as delivery: measured on
    the lighthouse takes, energy 4-5 lines sit ~20 dB lower above 6 kHz than energy
    2-3 lines and loudness varies +-2.5 LU. One static match-EQ cannot fix that
    (it moves every line the same way), and the compressor would then pump. Each
    line is moved toward the median line, by a clamped, smoothed, partial amount.

    `processed[i]`, when given, is line i with a voice effect (fx.py). The
    correction is still measured on the dry take `wavs[i]` and then applied to
    the processed one: measured on a phone-call line, it would "fix" the
    effect back toward the other lines.
    """
    processed = processed or [None] * len(wavs)
    if len(wavs) < 3:
        return [p if p is not None else w for w, p in zip(wavs, processed)]
    levels = np.array([speech_db(w, sr) for w in wavs])
    gains_db = [float(np.clip(np.median(levels) - lv, -LEVEL_CLAMP_DB, LEVEL_CLAMP_DB)) for lv in levels]
    wavs = [w * 10 ** (g / 20) for w, g in zip(wavs, gains_db)]
    spectra = [band_levels(w, sr) for w in wavs]
    centres = spectra[0][1]
    lv = np.array([s[0] for s in spectra])
    target = np.median(lv, axis=0)
    out = []
    for w, mine, p, g in zip(wavs, lv, processed, gains_db):
        diff = target - mine
        diff = diff - np.median(diff[(centres > 300) & (centres < 2500)])  # level was handled above
        for _ in range(2):
            diff = np.convolve(np.pad(diff, 1, mode="edge"), np.ones(3) / 3, mode="valid")
        gains = np.clip(diff * TONE_STRENGTH, -TONE_CLAMP_DB, TONE_CLAMP_DB)
        curve = {"hz": [float(c) for c in centres], "gainDb": [float(x) for x in gains]}
        out.append(apply(w if p is None else p * 10 ** (g / 20), sr, curve))
    return out


def load(path: Path) -> dict | None:
    return json.loads(path.read_text()) if path.exists() else None
