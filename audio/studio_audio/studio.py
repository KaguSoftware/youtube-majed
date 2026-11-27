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

# --- pause rules -----------------------------------------------------------
# Silence inserted between two lines, ON TOP of the ~0.18 s of padding each line
# file already carries (0.06 s before, 0.12 s after). Chosen by the end of the
# previous line and where the loop boundary falls (ids look like "L3.4": loop
# L3, line 4). Longer at loop boundaries, because that is where the story
# resets its question.
LEAD_IN = 0.40  # silence before the first line
TAIL = 1.00  # after the last line (lets the room reverb decay, gives the outro a beat)
PAUSE_LOOP_BOUNDARY = 0.70
PAUSE_BY_ENDING = {"…": 0.50, "?": 0.34, "!": 0.32, ".": 0.28}
PAUSE_CONTINUES = 0.05  # line ends on a comma, dash or nothing: the sentence goes on
PAUSE_BEFORE_REVEAL = 0.15  # extra beat before an energy-5 line inside a loop


def fade_edges(w: np.ndarray, sr: int, ms: float = 8.0) -> np.ndarray:
    """Raised-cosine fade at both ends of a take: a take cut mid-breath ends on a step, which is a click."""
    n = min(int(sr * ms / 1000), len(w) // 2)
    if n < 2:
        return w
    ramp = (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, n))).astype(w.dtype)
    out = w.copy()
    out[:n] *= ramp
    out[-n:] *= ramp[::-1]
    return out


def loop_of(line_id: str) -> str:
    return line_id.split(".")[0]


def pause_after(prev: dict, nxt: dict) -> float:
    if loop_of(prev["id"]) != loop_of(nxt["id"]):
        return PAUSE_LOOP_BOUNDARY
    end = prev["text"].rstrip().rstrip("\"'”’)")[-1:]
    pause = PAUSE_BY_ENDING.get(end, PAUSE_CONTINUES)
    if nxt.get("energy") == 5:
        pause += PAUSE_BEFORE_REVEAL
    return pause


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
        """order: [{id, key}] in narration order. Assembles, masters, writes narration.wav and voice.json."""
        out = Path(out_dir)
        sr = config.MASTER_SR
        metas = [json.loads((out / "lines" / f"{o['id']}.{o['key']}.json").read_text()) for o in order]
        wavs = []
        for m in metas:
            w, wsr = sf.read(out / m["file"], dtype="float32")
            wavs.append(matcheq.resample(w, wsr, sr))
        wavs = [fade_edges(w, sr) for w in matcheq.balance_lines(wavs, sr)]  # one level and one tone across every line before mastering

        offsets: list[int] = []
        cursor = round(LEAD_IN * sr)
        for i, (m, w) in enumerate(zip(metas, wavs)):
            offsets.append(cursor)
            cursor += len(w)
            if i + 1 < len(metas):
                cursor += round(pause_after(m, metas[i + 1]) * sr)
        total = cursor + round(TAIL * sr)
        raw = np.zeros(total, dtype=np.float32)
        for off, w in zip(offsets, wavs):
            raw[off : off + len(w)] += w

        ref_path, ref_sha = self._ref(reference)
        mastered, loud = master.master(raw, sr, curve_path=config.eq_curve_for(ref_path))
        sf.write(out / "narration.wav", mastered, sr, subtype="PCM_24")

        lines = []
        for m, off, w in zip(metas, offsets, wavs):
            t0 = off / sr
            lines.append({
                "id": m["id"], "text": m["text"], "energy": m["energy"], "file": m["file"],
                "offset": round(t0, 5), "duration": round(len(w) / sr, 5),
                "seed": m["seed"], "seedUsed": m["seedUsed"], "settings": m["settings"], "quality": m["quality"],
                "words": [{"text": x["text"], "start": round(t0 + x["start"], 4), "end": round(t0 + x["end"], 4), "score": x["score"]} for x in m["words"]],
            })

        try:
            ref_name = str(ref_path.relative_to(config.REPO))
        except ValueError:  # the built-in voice lives in the model snapshot
            ref_name = f"{config.BUILTIN}:{pins.MODELS[self.voice.engine].repo}@{self.voice.revision[:8]}/{ref_path.name}"
        voice = {
            "version": 1,
            "engine": {"name": self.voice.engine, "revision": self.voice.revision, "device": self.voice.device},
            "reference": {"file": ref_name, "sha256": ref_sha},
            "aligner": {"model": pins.MODELS["align"].repo, "revision": pins.MODELS["align"].revision, "device": "cpu", "dtype": "float32"},
            "pauses": {"leadIn": LEAD_IN, "tail": TAIL, "loopBoundary": PAUSE_LOOP_BOUNDARY, "byEnding": PAUSE_BY_ENDING,
                       "continues": PAUSE_CONTINUES, "beforeReveal": PAUSE_BEFORE_REVEAL},
            "track": {"file": "narration.wav", "sampleRate": sr, "duration": round(total / sr, 5), "loudness": loud.to_json()},
            "lines": lines,
        }
        (out / "voice.json").write_text(json.dumps(voice, indent=2))
        return voice


def _quality(a, attempts: int) -> dict:
    return {"status": a.status, "wer": round(a.wer, 3), "heard": a.heard, "issues": a.issues, "attempts": attempts}
