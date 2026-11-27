"""Weights-free stand-ins for the three models, for testing the machinery.

The Phase 0 harness has `--backend synthetic` so the measurement code can be
checked without a download; this is the same idea for the worker. The queue,
the lease, the checkpoints, the content addressing and the ffmpeg render are
all real — only the narration, the alignment and the pixels are fake. That is
enough to prove the Phase 2 exit criterion in seconds, and it is what a
nightly smoke-test job (PLAN.md Phase 5) would run.

Each fake is deterministic in its inputs, like the real model it stands in
for, so the content-addressed caches behave exactly as they do in production:
the same shot asked for twice produces the same bytes under the same hash.
"""

from __future__ import annotations

import hashlib
import time
from pathlib import Path

import numpy as np
from PIL import Image

from . import config
from .align import WordTiming, normalize
from .images import write_still
from .production import Engines
from .tts import TTS

#: Seconds of fake speech per word. 150 wpm is DESIGN.md's planning rate, so a
#: fixture script lands near its own target duration.
SECONDS_PER_WORD = 0.4


def _seed(*parts: object) -> int:
    return int.from_bytes(hashlib.sha256(repr(parts).encode()).digest()[:8], "little")


class FakeTTS(TTS):
    """A tone per word with a short gap, so every word has audio to land on."""

    name = "fake-tts"

    def load(self) -> None:
        pass

    def say(self, text: str, voice: str, take: int = 0, speed: float = 1.0) -> np.ndarray:
        from .tts import retake_speed

        sr = self.sample_rate
        n = int(SECONDS_PER_WORD / (speed * retake_speed(take)) * sr)
        t = np.arange(n) / sr
        out = []
        for i, word in enumerate(text.split()):
            tone = np.sin(2 * np.pi * (180 + (_seed(word, i) % 200)) * t)
            tone[int(0.85 * n):] = 0.0     # a breath between words
            out.append(0.3 * tone)
        return np.concatenate(out).astype(np.float32)


class FakeAligner:
    """Spreads a beat's words evenly over its audio and 'hears' them perfectly.

    Even spacing at 0.4 s/word clears align.py's length-normalized drop check
    by a wide margin, so the gates pass for the right reason (nothing is
    missing) rather than being bypassed.
    """

    model_name = "fake-aligner"

    def load(self) -> None:
        pass

    def align(self, samples: np.ndarray, sample_rate: int, text: str, offset: float = 0.0):
        words = normalize(text).split()
        span = len(samples) / sample_rate / len(words)
        timings = [
            WordTiming(word=w, start=offset + i * span, end=offset + (i + 0.85) * span, score=0.9)
            for i, w in enumerate(words)
        ]
        return timings, " ".join(words)


class FakeGenerator:
    """Coarse random blocks seeded by (prompt, seed): distinct per shot, the
    same every time it is asked for, and structured enough that QA's
    perceptual hash sees different images rather than identical noise."""

    model_name = "fake-generator"

    def __init__(self, delay: float = 0.0) -> None:
        self.delay = delay
        self._loaded = False
        self.calls: list[str] = []

    @property
    def loaded(self) -> bool:
        return self._loaded

    def load(self, log=print) -> None:
        self._loaded = True

    def generate(self, prompt: str, seed: int, refs: list[Path], dest: Path, *,
                 size: tuple[int, int] | None = None) -> float:
        t = time.time()
        w, h = size or (config.GEN_WIDTH, config.GEN_HEIGHT)
        rng = np.random.default_rng(_seed(prompt, seed))
        blocks = rng.integers(0, 256, size=(6, 10, 3), dtype=np.uint8)
        img = Image.fromarray(blocks).resize((w, h), Image.BICUBIC)
        arr = np.asarray(img).astype(np.int16) + rng.integers(-24, 24, (h, w, 3))
        if self.delay:
            time.sleep(self.delay)
        write_still(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)), dest)
        self.calls.append(dest.stem)
        return time.time() - t

    def unload(self) -> None:
        self._loaded = False


def fake_engines(*, image_delay: float = 0.0) -> Engines:
    return Engines(tts_engine=FakeTTS(), aligner=FakeAligner(),
                   generator=FakeGenerator(delay=image_delay), unload_images=False)
