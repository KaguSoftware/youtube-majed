"""Cleaning a voice recording: neural denoise (RNNoise, BSD-3) then a gentle
corrective EQ. Used to prepare the reference clip the voice is cloned from:
Chatterbox copies the room tone, boom and muffle of its reference, so a dirty
reference means a dirty narration.

The EQ is deliberately mild (a few dB): it takes out low-mid boom and restores
a little presence. It cannot bring back high frequencies a low-bitrate
recording never had.
"""

from __future__ import annotations

import numpy as np
import soundfile as sf
import torch
import torchaudio
from pedalboard import HighpassFilter, HighShelfFilter, PeakFilter, Pedalboard

SR = 48_000  # RNNoise runs at 48 kHz
RNNOISE_DELAY = 960  # samples (20 ms): RNNoise's output lags its input by this much


def denoise(x: np.ndarray, sr: int) -> np.ndarray:
    """-> float32 mono at 48 kHz with background noise removed."""
    from pyrnnoise import RNNoise

    x48 = torchaudio.functional.resample(torch.from_numpy(np.ascontiguousarray(x)).float(), sr, SR).numpy() if sr != SR else x.astype(np.float32)
    n = len(x48)
    padded = np.concatenate([x48, np.zeros(RNNOISE_DELAY, dtype=np.float32)])  # flush the delayed tail
    pcm = (np.clip(padded, -1, 1) * 32767).astype(np.int16)[None, :]
    frames = [f.reshape(-1) for _, f in RNNoise(sample_rate=SR).denoise_chunk(pcm, partial=True)]
    y = np.concatenate(frames).astype(np.float32) / 32767
    return y[RNNOISE_DELAY : RNNOISE_DELAY + n]  # drop the delay so timing is unchanged


def voice_eq(x: np.ndarray, sr: int = SR) -> np.ndarray:
    chain = Pedalboard([
        HighpassFilter(75),
        PeakFilter(230, gain_db=-3.0, q=0.9),  # low-mid boom
        PeakFilter(3800, gain_db=1.5, q=0.8),  # presence
        HighShelfFilter(6500, gain_db=1.5),  # a little air
    ])
    return chain(x[None, :].astype(np.float32), sr)[0]


def clean_file(src: str, dst: str) -> np.ndarray:
    x, sr = sf.read(src, dtype="float32")
    x = x if x.ndim == 1 else x.mean(axis=1)
    y = voice_eq(denoise(x, sr))
    sf.write(dst, y, SR, subtype="PCM_24")
    return y
