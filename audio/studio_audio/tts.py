"""Chatterbox wrapper: load once, keep loaded, one line per call.

Two engines behind one interface:
  turbo     Chatterbox-Turbo (350M, 1-step decoder, [laugh]-style tags). No
            exaggeration / cfg_weight.
  original  Chatterbox (500M). exaggeration + cfg_weight, which is what the
            plan's energy mapping needs. Paralinguistic tags are not native.
"""

from __future__ import annotations

import hashlib
import logging
import random
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch

from . import config, pins

log = logging.getLogger("studio_audio.tts")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def resolve_device(device: str) -> str:
    """auto: an NVIDIA GPU (CUDA, Windows/Linux), else the Apple GPU (MPS), else the CPU."""
    if device == "auto":
        if torch.cuda.is_available():
            return "cuda"
        return "mps" if torch.backends.mps.is_available() else "cpu"
    if device == "mps" and not torch.backends.mps.is_available():
        log.warning("MPS requested but not available; using CPU")
        return "cpu"
    if device == "cuda" and not torch.cuda.is_available():
        log.warning("CUDA requested but not available; using CPU")
        return "cpu"
    return device


def seed_everything(seed: int, device: str) -> None:
    random.seed(seed)
    np.random.seed(seed % (2**32))
    torch.manual_seed(seed)
    if device == "mps":
        torch.mps.manual_seed(seed)
    if device == "cuda":
        torch.cuda.manual_seed_all(seed)


def trim_silence(wav: np.ndarray, sr: int) -> np.ndarray:
    """Cut Chatterbox's lead/tail silence, keeping a short pad on each side."""
    if wav.size == 0:
        return wav
    peak = float(np.abs(wav).max())
    if peak < 1e-4:
        return wav
    thr = peak * 10 ** (config.TRIM_THRESHOLD_DB / 20)
    # 10 ms RMS frames, so a single click does not count as speech.
    hop = sr // 100
    n = len(wav) // hop
    if n < 3:
        return wav
    rms = np.sqrt((wav[: n * hop].reshape(n, hop) ** 2).mean(axis=1))
    voiced = np.flatnonzero(rms > thr)
    if voiced.size == 0:
        return wav
    start = max(0, int(voiced[0] * hop - config.TRIM_LEAD * sr))
    end = min(len(wav), int((voiced[-1] + 1) * hop + config.TRIM_TAIL * sr))
    return wav[start:end]


@dataclass
class Take:
    wav: np.ndarray  # float32 mono at TTS_SR, silence trimmed
    sr: int
    seconds_compute: float
    settings: dict


class Voice:
    def __init__(self, engine: str = "original", device: str = "auto"):
        if engine not in ("turbo", "original"):
            raise ValueError(f"unknown engine {engine!r}")
        self.engine = engine
        self.device = resolve_device(device)
        self.model = None
        self._ref_key: str | None = None
        self._lock = threading.Lock()  # one line at a time; models are not re-entrant

    # ---------------------------------------------------------------- loading
    def load(self) -> "Voice":
        t0 = time.time()
        path = pins.snapshot(self.engine)
        if self.engine == "turbo":
            from chatterbox.tts_turbo import ChatterboxTurboTTS

            self.model = ChatterboxTurboTTS.from_local(path, self.device)
            # Turbo's reference loudness-norm returns float64, which MPS cannot hold.
            norm = self.model.norm_loudness
            self.model.norm_loudness = lambda wav, sr, *a, **k: np.asarray(norm(wav, sr, *a, **k), dtype=np.float32)
        else:
            from chatterbox.tts import ChatterboxTTS

            self.model = ChatterboxTTS.from_local(path, self.device)
        log.info("loaded %s on %s in %.1fs", self.engine, self.device, time.time() - t0)
        return self

    @property
    def revision(self) -> str:
        return pins.MODELS[self.engine].revision

    def presets(self, energy: int) -> dict:
        table = config.TURBO_PRESETS if self.engine == "turbo" else config.ORIGINAL_PRESETS
        if energy not in table:
            raise ValueError(f"energy must be 1–5, got {energy}")
        return dict(table[energy])

    def settings(self, energy: int, overrides: dict | None = None) -> dict:
        """Effective generation settings for an energy level (plus explicit overrides)."""
        s = self.presets(energy)
        s.update({k: v for k, v in (overrides or {}).items() if v is not None})
        return s

    # ------------------------------------------------------------- generating
    def _use_reference(self, ref: Path) -> None:
        key = sha256_file(ref)
        if key == self._ref_key:
            return
        if ref.suffix == ".pt":  # the built-in voice: precomputed conditionals, no clip to encode
            self.model.conds = type(self.model.conds).load(str(ref)).to(self.device)
        elif self.engine == "turbo":
            self.model.prepare_conditionals(str(ref))
        else:
            self.model.prepare_conditionals(str(ref), exaggeration=0.5)
        self._ref_key = key

    def synth(self, text: str, energy: int, seed: int, ref: Path, overrides: dict | None = None) -> Take:
        assert self.model is not None, "call load() first"
        settings = self.settings(energy, overrides)
        with self._lock:
            self._use_reference(Path(ref))
            seed_everything(seed, self.device)
            t0 = time.time()
            with torch.inference_mode():
                if self.engine == "turbo":
                    out = self.model.generate(text, **settings)
                else:
                    out = self.model.generate(text, **settings)
            if self.device == "mps":
                torch.mps.synchronize()
            if self.device == "cuda":
                torch.cuda.synchronize()
            compute = time.time() - t0
        wav = out.squeeze().detach().cpu().numpy().astype(np.float32)
        return Take(trim_silence(wav, self.model.sr), self.model.sr, compute, settings)
