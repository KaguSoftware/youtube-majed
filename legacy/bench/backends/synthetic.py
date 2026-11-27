"""A fake backend that costs nothing and downloads nothing.

Its job is to prove the harness measures correctly before any multi-gigabyte
weights exist on disk. It fabricates plausible timings, including a slow tail,
so the median/p90/worst reporting can be verified against known inputs.

Never read its numbers as a result. `run_bench.py` marks them SYNTHETIC.
"""

from __future__ import annotations

import random
import struct
import time
import zlib
from pathlib import Path

from .base import Backend


def _write_png(dest: Path, width: int, height: int) -> None:
    """Minimal valid grey PNG, no Pillow dependency."""
    width, height = max(1, min(width, 64)), max(1, min(height, 64))
    raw = b"".join(b"\x00" + bytes([128] * (width * 3)) for _ in range(height))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    dest.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


class SyntheticBackend(Backend):
    name = "synthetic"

    def __init__(self, base_seconds: float = 0.35, seed: int = 7) -> None:
        super().__init__()
        self.base_seconds = base_seconds
        self._rng = random.Random(seed)
        self._loaded = False

    def load(self, config) -> None:
        time.sleep(0.6)  # stand-in for cold weight load
        self._loaded = True

    def generate(self, prompt: str, dest: Path, config) -> None:
        if not self._loaded:
            raise RuntimeError("generate() before load()")
        scale = config.megapixels / 0.4 or 1.0
        jitter = self._rng.gauss(1.0, 0.08)
        # occasional slow frame, so p90 and worst differ from median
        tail = 1.9 if self._rng.random() < 0.12 else 1.0
        time.sleep(max(0.02, self.base_seconds * scale * jitter * tail))
        _write_png(dest, config.width, config.height)

    def unload(self) -> None:
        self._loaded = False

    def peak_memory_mb(self) -> float | None:
        return 2100.0
