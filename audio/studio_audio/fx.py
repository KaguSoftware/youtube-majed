"""Voice effect presets (docs/PLAN.md section 7), with Pedalboard.

| Preset       | Chain (as the plan's table)              | Use                      |
| chipmunk     | PitchShift +5 st                         | jokes, tiny voices       |
| giant        | PitchShift -5, low-pass, reverb          | villains, monsters       |
| phone_call   | high-pass + low-pass, light distortion   | calls, radio, flashbacks |
| echo_thought | delay + reverb                           | inner voice              |
| robot        | bitcrush + chorus                        | AI/robot characters      |
| underwater   | low-pass + chorus                        | dreams, muffled scenes   |

An effect applies to a whole line or to one word of it (the word's span comes
from the take's own alignment). It never moves a word: pitch shifting keeps
the length (Pedalboard compensates the plugin latency), and a tail (echo,
reverb) rings on after the take instead of pushing the next line back
(studio.track overlap-adds it into the pause and under what follows).

The processed region is brought back to the dry region's speech level, so a
band-limited preset (phone call, underwater) does not simply sound quieter;
line balancing at mastering is measured on the dry take for the same reason
(matcheq.balance_lines `processed`).

Results are cached next to the take, like takes: lines/<id>.<key>.fx-<hash>.wav,
keyed on the take, the effects and FX_VERSION.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf
from pedalboard import Bitcrush, Chorus, Delay, Distortion, HighpassFilter, LowpassFilter, Pedalboard, PitchShift, Reverb

FX_VERSION = 1  # bump when a chain changes, so cached results are redone
WORD_PAD = 0.03  # seconds of the take kept around a word's aligned span
RAMP = 0.015  # crossfade between the dry take and the effected word


@dataclass(frozen=True)
class Preset:
    board: Pedalboard
    tail: float  # seconds the effect may ring on after the dry audio ends


def _presets() -> dict[str, Preset]:
    return {
        "chipmunk": Preset(Pedalboard([PitchShift(semitones=5)]), 0.05),
        "giant": Preset(Pedalboard([PitchShift(semitones=-5), LowpassFilter(cutoff_frequency_hz=2800), Reverb(room_size=0.55, damping=0.5, wet_level=0.22, dry_level=0.85, width=0.0)]), 0.9),
        "phone_call": Preset(Pedalboard([HighpassFilter(cutoff_frequency_hz=320), LowpassFilter(cutoff_frequency_hz=3300), Distortion(drive_db=9), HighpassFilter(cutoff_frequency_hz=320), LowpassFilter(cutoff_frequency_hz=3300)]), 0.05),
        "echo_thought": Preset(Pedalboard([Delay(delay_seconds=0.21, feedback=0.38, mix=0.38), Reverb(room_size=0.6, damping=0.4, wet_level=0.25, dry_level=0.8, width=0.0)]), 1.4),
        "robot": Preset(Pedalboard([Bitcrush(bit_depth=7), Chorus(rate_hz=7.0, depth=0.35, centre_delay_ms=6.0, feedback=0.55, mix=0.65)]), 0.08),
        "underwater": Preset(Pedalboard([LowpassFilter(cutoff_frequency_hz=650), Chorus(rate_hz=0.7, depth=0.5, centre_delay_ms=9.0, feedback=0.25, mix=0.6), LowpassFilter(cutoff_frequency_hz=900)]), 0.15),
    }


PRESETS = _presets()


def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x.astype(np.float64) ** 2) + 1e-12))


def _speech_rms(x: np.ndarray, sr: int) -> float:
    """RMS of the loud frames only (within 20 dB of the loudest), so silence in a span does not count."""
    hop = max(1, int(0.02 * sr))
    n = len(x) // hop
    if n < 2:
        return _rms(x)
    fr = x[: n * hop].reshape(n, hop).astype(np.float64)
    db = 20 * np.log10(np.sqrt((fr**2).mean(1)) + 1e-9)
    loud = fr[db > db.max() - 20]
    return float(np.sqrt(np.mean(loud**2) + 1e-12))


def _run(preset: Preset, x: np.ndarray, sr: int) -> np.ndarray:
    """The chain over x plus its tail of silence, with a short fade at the very end."""
    tail = int(preset.tail * sr)
    padded = np.concatenate([x, np.zeros(tail, dtype=np.float32)]).astype(np.float32)
    preset.board.reset()
    y = preset.board(padded[None, :], sr)[0]
    fade = min(int(0.03 * sr), len(y))
    y[len(y) - fade :] *= np.linspace(1, 0, fade, dtype=np.float32)
    return y.astype(np.float32)


def _window(n: int, sr: int, a: int, b: int) -> np.ndarray:
    """1 inside [a, b), 0 outside, raised-cosine ramps of RAMP on both sides."""
    w = np.zeros(n, dtype=np.float32)
    r = max(1, int(RAMP * sr))
    a0, b1 = max(0, a - r), min(n, b + r)
    w[a:b] = 1
    up = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, a - a0, dtype=np.float32)) if a > a0 else np.zeros(0, dtype=np.float32)
    down = 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, b1 - b, dtype=np.float32)) if b1 > b else np.zeros(0, dtype=np.float32)
    w[a0:a] = up
    w[b:b1] = down
    return w


def apply(take: np.ndarray, sr: int, effects: list[dict], words: list[dict]) -> np.ndarray:
    """effects: [{"preset", "word": index or None}], word effects first, then a whole-line one.
    words: the take's aligned words (seconds from the take's start). Returns the effected take, which
    may be longer than the dry one by the effect's tail."""
    out = np.asarray(take, dtype=np.float32)
    ordered = sorted(effects, key=lambda e: e.get("word") is None)
    for e in ordered:
        preset = PRESETS[e["preset"]]
        word = e.get("word")
        if word is None:
            wet = _run(preset, out, sr)
            gain = _speech_rms(out, sr) / max(_speech_rms(wet[: len(out)], sr), 1e-9)
            out = wet * min(gain, 8.0)
            continue
        w = words[min(int(word), len(words) - 1)]
        a = max(0, int((w["start"] - WORD_PAD) * sr))
        b = min(len(take), int((w["end"] + WORD_PAD) * sr))
        if b <= a:
            continue
        win = _window(len(out), sr, a, b)
        region = out * win
        wet = _run(preset, region, sr)
        # a pitch shifter smears a little energy ahead of its input: nothing of the effect may sound before the word
        wet *= _window(len(wet), sr, a, len(wet))
        gain = _speech_rms(region[a:b], sr) / max(_speech_rms(wet[a:b], sr), 1e-9)
        wet *= min(gain, 8.0)
        dry = np.concatenate([out * (1 - win), np.zeros(len(wet) - len(out), dtype=np.float32)])
        out = dry + wet
    return out.astype(np.float32)


def fx_key(take_key: str, effects: list[dict]) -> str:
    norm = sorted(({"preset": e["preset"], "word": e.get("word")} for e in effects), key=lambda e: (e["word"] is None, e["word"] or 0, e["preset"]))
    payload = {"v": FX_VERSION, "take": take_key, "fx": norm}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:12]


def cached(lines_dir: Path, line_id: str, key: str, effects: list[dict], meta: dict) -> tuple[Path, bool]:
    """The effected take for one line, from the cache or made now. -> (wav path, made_now)."""
    path = lines_dir / f"{line_id}.{key}.fx-{fx_key(key, effects)}.wav"
    if path.exists():
        return path, False
    dry, sr = sf.read(lines_dir / f"{line_id}.{key}.wav", dtype="float32")
    wet = apply(dry, sr, effects, meta["words"])
    tmp = path.with_suffix(".partial.wav")
    sf.write(tmp, wet, sr, subtype="PCM_24")
    tmp.replace(path)
    return path, True
