"""Mastering for the narration track (docs/PLAN.md section 5):

    high-pass -> compressor -> light room reverb -> limiter -> normalise to about -14 LUFS

Loudness is measured as integrated loudness per ITU-R BS.1770-4 (pyloudnorm:
K-weighting, absolute and relative gating), not by scaling peaks. The gain is
set on the signal *before* the limiter and iterated, because limiting itself
removes a little loudness.

The limiter is our own (`true_peak_limit`), not Pedalboard's: measured here,
pedalboard.Limiter(threshold_db=-6) still lets peaks through to 0 dBFS, so it
cannot guarantee a ceiling. This one detects peaks on a 4x oversampled copy
(inter-sample overshoot is what clips after AAC encoding) and applies a smooth,
lookahead gain that never exceeds the reduction each peak needs.

Compression is two stages because speech has a peak-to-loudness ratio of ~20 dB:
a gentle leveller, then a fast peak catcher, so the limiter only trims a few dB
on rare peaks instead of squashing the whole track.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pyloudnorm as pyln
from pedalboard import Compressor, HighpassFilter, Pedalboard, Reverb

from . import config, matcheq
from scipy.ndimage import minimum_filter1d, uniform_filter1d
from scipy.signal import resample_poly

TARGET_LUFS = -14.0
TRUE_PEAK_MAX = -1.5  # dBTP: leaves room for AAC encoding to overshoot a little
LUFS_TOLERANCE = 0.1
LIMITER_MS = 8.0  # lookahead and smoothing window


@dataclass
class Loudness:
    integratedLufs: float
    truePeakDbtp: float
    targetLufs: float

    def to_json(self) -> dict:
        return {k: round(v, 2) for k, v in asdict(self).items()}


def measure(audio: np.ndarray, sr: int) -> tuple[float, float]:
    """-> (integrated LUFS, true peak in dBTP) of a mono float signal."""
    lufs = pyln.Meter(sr).integrated_loudness(audio.astype(np.float64))
    peak = float(np.abs(resample_poly(audio.astype(np.float64), 4, 1)).max())
    return float(lufs), 20 * np.log10(max(peak, 1e-9))


def true_peak_limit(y: np.ndarray, sr: int, ceiling_db: float, ms: float = LIMITER_MS) -> np.ndarray:
    """Lookahead limiter on true (oversampled) peaks. y: mono float.

    Required gain per sample = ceiling / oversampled peak. A minimum filter over
    the window, then a moving average over the same window, gives a smooth gain
    curve that is never above the required gain at any sample.
    """
    win = max(3, int(sr * ms / 1000) | 1)
    over = np.abs(resample_poly(y.astype(np.float64), 4, 1))
    n = len(y)
    peak = np.maximum.reduce([over[i::4][:n] for i in range(4)])
    required = np.minimum(1.0, 10 ** (ceiling_db / 20) / np.maximum(peak, 1e-9))
    gain = uniform_filter1d(minimum_filter1d(required, size=win, mode="nearest"), size=win, mode="nearest")
    return (y * gain).astype(np.float32)


def master(track: np.ndarray, sr: int, target: float = TARGET_LUFS, curve_path=None) -> tuple[np.ndarray, Loudness]:
    """track: mono float32 at `sr`. curve_path: the clone's match-EQ (None for the built-in voice).
    Returns the mastered mono track and its measured loudness."""
    curve = matcheq.load(curve_path) if curve_path else None
    if curve:
        track = matcheq.apply(track, sr, curve)
    x = track.astype(np.float32)[None, :]  # pedalboard wants (channels, samples)
    pre = Pedalboard(
        [
            HighpassFilter(cutoff_frequency_hz=80),
            Compressor(threshold_db=-26, ratio=3, attack_ms=4, release_ms=90),  # leveller
            Compressor(threshold_db=-14, ratio=6, attack_ms=1, release_ms=40),  # peak catcher
            # A trace of small room, only to take the "dead booth" edge off. Kept very low:
            # more reads as background noise on a voice with no real room behind it.
            Reverb(room_size=0.10, damping=0.8, wet_level=0.025, dry_level=0.975, width=0.8),
        ]
    )(x, sr)[0]

    gain = target - measure(pre, sr)[0]
    out = pre
    for _ in range(8):
        out = true_peak_limit(pre * 10 ** (gain / 20), sr, TRUE_PEAK_MAX)
        err = target - measure(out, sr)[0]
        if abs(err) <= LUFS_TOLERANCE:
            break
        gain += err
    return out, Loudness(*measure(out, sr), target)
