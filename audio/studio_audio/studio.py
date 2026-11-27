"""The service's brain: one line -> a cached, aligned, quality-checked take; many
takes -> one mastered narration track and a voice.json.

Output layout (inside projects/<id>/audio/, never committed):

    lines/<lineId>.<key>.wav    raw take, 24 kHz mono, silence-trimmed
    lines/<lineId>.<key>.json   its alignment, quality verdict and the settings that made it
    narration.wav               mastered track, 48 kHz mono, pauses included
    voice.json                  everything Remotion needs (validated with zod, packages/schema)

`<key>` is a hash of everything that changes the audio: engine + model revision,
text, effective settings, seed, reference clip. Change none of them and the take
is reused; retake a line (new seed or energy) and only that line is regenerated.
Old takes stay on disk, so going back to a previous seed is free.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
import zlib
from pathlib import Path

import numpy as np
import soundfile as sf

from . import config, master, matcheq, pins
from .align import Aligner
from .tts import Voice, sha256_file

log = logging.getLogger("studio_audio.studio")

PIPELINE_VERSION = 4  # bump when trimming/preprocessing changes the audio for the same key (2: takes denoised, 48 kHz; 3: no denoise; 4: takes kept at the model's 24 kHz)
GATE_VERSION = 1  # bump when align.py's thresholds change (re-aligns, does not re-synthesise)
RETRY_SEED_STEP = 7919
STATUS_RANK = {"ok": 0, "warn": 1, "fail": 2}

# Pause rules, frame alignment and assembly live in track.py (no model imports), shared with the edit engine.
from .track import (  # noqa: E402  (re-exported: tests and the README point here)
    LEAD_IN, PAUSE_BEFORE_REVEAL, PAUSE_BY_ENDING, PAUSE_CONTINUES, PAUSE_LOOP_BOUNDARY, TAIL, assemble, fade_edges, loop_of, pause_after,
)


def camel_settings(s: dict) -> dict:
    return {"cfgWeight" if k == "cfg_weight" else k: v for k, v in s.items()}


def default_seed(line_id: str) -> int:
    return zlib.crc32(line_id.encode()) % 100_000


class Studio:
    def __init__(self, engine: str = "original", device: str = "mps"):
        self.voice = Voice(engine, device)
        self.aligner = Aligner()
        self._ref_sha: dict[str, str] = {}

    def load(self) -> "Studio":
        self.voice.load()
        self.aligner.load()
        return self

    # ------------------------------------------------------------------ keys
    def _ref(self, reference: str | Path | None) -> tuple[Path, str]:
        reference = reference or config.DEFAULT_REFERENCE
        if str(reference) == config.BUILTIN:
            path = Path(pins.snapshot(self.voice.engine)) / "conds.pt"  # the engine's own studio voice
        else:
            path = Path(reference)
        if not path.is_absolute():
            path = config.REPO / path
        if not path.exists():
            raise FileNotFoundError(f"reference clip not found: {path}")
        stat = f"{path}:{path.stat().st_mtime_ns}:{path.stat().st_size}"
        if stat not in self._ref_sha:
            self._ref_sha[stat] = sha256_file(path)
        return path, self._ref_sha[stat]

    def _key(self, text: str, settings: dict, seed: int, ref_sha: str) -> str:
        payload = {
            "v": PIPELINE_VERSION, "engine": self.voice.engine, "revision": self.voice.revision,
            "text": text, "settings": settings, "seed": seed, "ref": ref_sha,
        }
        return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:12]

    def _align_key(self, key: str) -> str:
        return f"{key}:{pins.MODELS['align'].revision[:8]}:g{GATE_VERSION}"

    # ------------------------------------------------------------------ line
    def line(
        self, out_dir: str | Path, line_id: str, text: str, energy: int, seed: int | None = None,
        reference: str | Path | None = None, overrides: dict | None = None, max_attempts: int = 3,
    ) -> dict:
        """Voice one line (or reuse its cached take). Returns the take's record."""
        out = Path(out_dir)
        (out / "lines").mkdir(parents=True, exist_ok=True)
        ref_path, ref_sha = self._ref(reference)
        seed = default_seed(line_id) if seed is None else int(seed)
        settings = self.voice.settings(int(energy), overrides)
        key = self._key(text, settings, seed, ref_sha)
        wav_path = out / "lines" / f"{line_id}.{key}.wav"
        meta_path = wav_path.with_suffix(".json")

        if wav_path.exists() and meta_path.exists():
            meta = json.loads(meta_path.read_text())
            if meta.get("alignKey") != self._align_key(key):  # alignment model or gate changed; audio is still good
                wav, sr = sf.read(wav_path, dtype="float32")
                a = self.aligner.align(text, wav, sr)
                meta.update(words=a.to_json()["words"], quality=_quality(a, meta["attempts"]), alignKey=self._align_key(key))
                meta_path.write_text(json.dumps(meta, indent=2))
            return {**meta, "state": "cached"}

        best = None
        started = time.time()
        for attempt in range(1, max_attempts + 1):
            used = seed + (attempt - 1) * RETRY_SEED_STEP
            take = self.voice.synth(text, int(energy), used, ref_path, overrides)
            # No denoising here: measured, RNNoise removes nothing from a take (gap noise
            # -66 dB before and after) and adds a fizz band at 12-17 kHz. Takes stay at the
            # model's own rate; they are upsampled once, at assembly (matcheq.resample).
            a = self.aligner.align(text, take.wav, take.sr)
            log.info("%s attempt %d seed %d: %s wer=%.2f %s", line_id, attempt, used, a.status, a.wer, a.issues)
            rank = (STATUS_RANK[a.status], a.wer)
            if best is None or rank < best[0]:
                best = (rank, take, a, used, attempt)
            if a.status != "fail":
                break
        _, take, a, used, attempts = best  # type: ignore[misc]
        sf.write(wav_path, take.wav, take.sr, subtype="PCM_24")
        meta = {
            "id": line_id, "text": text, "energy": int(energy), "key": key, "file": f"lines/{wav_path.name}",
            "duration": round(len(take.wav) / take.sr, 4), "sampleRate": take.sr,
            "seed": seed, "seedUsed": used, "attempts": attempts, "settings": camel_settings(settings),
            "engine": self.voice.engine, "revision": self.voice.revision, "referenceSha256": ref_sha,
            "computeSeconds": round(time.time() - started, 2),
            "alignKey": self._align_key(key), "words": a.to_json()["words"], "quality": _quality(a, attempts),
        }
        meta_path.write_text(json.dumps(meta, indent=2))
        return {**meta, "state": "generated"}

    # ----------------------------------------------------------------- track
    def track(self, out_dir: str | Path, order: list[dict], reference: str | Path | None = None) -> dict:
        """order: [{id, key, fx?}] in narration order. Assembles, masters, writes narration.wav and voice.json (track.assemble)."""
        out = Path(out_dir)
        ref_path, ref_sha = self._ref(reference)
        try:
            ref_name = str(ref_path.relative_to(config.REPO))
        except ValueError:  # the built-in voice lives in the model snapshot
            ref_name = f"{config.BUILTIN}:{pins.MODELS[self.voice.engine].repo}@{self.voice.revision[:8]}/{ref_path.name}"
        return assemble(
            out, order,
            engine={"name": self.voice.engine, "revision": self.voice.revision, "device": self.voice.device},
            reference={"file": ref_name, "sha256": ref_sha},
            aligner={"model": pins.MODELS["align"].repo, "revision": pins.MODELS["align"].revision, "device": "cpu", "dtype": "float32"},
            narration=out / "narration.wav", voice_path=out / "voice.json", curve_path=config.eq_curve_for(ref_path),
        )


def _quality(a, attempts: int) -> dict:
    return {"status": a.status, "wer": round(a.wer, 3), "heard": a.heard, "issues": a.issues, "attempts": attempts}
