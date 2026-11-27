"""Renders a mix plan into one soundtrack (docs/PLAN.md section 7).

    uv run python -m studio_audio.mix <mixplan.json> <out.wav> <result.json>

The plan (packages/schema/src/sound.ts, written by worker/src/mix.ts) decides
everything: which file, when, how loud, where the music drops out. This only
renders it:

1. voice: the mastered narration (mono, 48 kHz), centred.
2. buses: each cue is read, trimmed, looped (crossfaded at its loop points),
   faded and gained onto its bus. music and ambience duck under the voice
   (a sidechain envelope from the narration itself, with lookahead so the
   bed is already down when a word starts) and drop out in the plan's gates.
   sfx, risers, hits and whooshes are never ducked.
3. sum -> gain to the target loudness (BS.1770 integrated, pyloudnorm) through
   a stereo true-peak limiter (4x oversampled, the same design as
   master.true_peak_limit), iterated because limiting costs a little loudness.

Why one mixed track instead of layering clips in Remotion: Remotion can only
set per-clip volume, so it cannot duck from the voice, limit the true peak of
the sum or normalise the final loudness. One track also keeps the render
deterministic and lets `pnpm mix` cache the result by plan hash.
"""

from __future__ import annotations

import hashlib
import json
import sys
import time
from pathlib import Path
from typing import Literal

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from pydantic import BaseModel, ConfigDict
from scipy.ndimage import minimum_filter1d, uniform_filter1d
from scipy.signal import resample_poly

SR = 48_000
MIXER_VERSION = 1


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Loop(_Strict):
    start: float
    end: float


class Cue(_Strict):
    id: str
    kind: Literal["sfx", "riser", "hit", "whoosh", "ambience", "music"]
    asset: str
    file: str
    sha256: str
    licence: str
    start: float
    offset: float
    length: float
    loop: Loop | None
    gainDb: float
    fadeIn: float
    fadeOut: float
    reason: str


class Gate(_Strict):
    start: float
    end: float
    fade: float
    release: float
    reason: str


class Duck(_Strict):
    depthDb: float
    attackMs: float
    releaseMs: float
    lookaheadMs: float


class Voice(_Strict):
    file: str
    sha256: str


class Ducks(_Strict):
    music: Duck
    ambience: Duck


class Plan(_Strict):
    version: Literal[1]
    mixer: int
    project: str
    sampleRate: Literal[48000]
    duration: float
    voice: Voice
    targetLufs: float
    truePeakDbtp: float
    duck: Ducks
    cues: list[Cue]
    gates: list[Gate]
    warnings: list[str]


# ---------------------------------------------------------------- reading


_cache: dict[str, np.ndarray] = {}


def _read(path: str) -> np.ndarray:
    """-> (n, 2) float32 at 48 kHz."""
    if path not in _cache:
        audio, sr = sf.read(path, always_2d=True, dtype="float32")
        if sr != SR:
            g = np.gcd(sr, SR)
            audio = resample_poly(audio, SR // g, sr // g, axis=0).astype(np.float32)
        if audio.shape[1] == 1:
            audio = np.repeat(audio, 2, axis=1)
        _cache[path] = audio[:, :2]
    return _cache[path]


def _fade(n: int, seconds: float) -> np.ndarray:
    k = min(n, int(seconds * SR))
    return np.linspace(0.0, 1.0, k, dtype=np.float32) if k > 0 else np.zeros(0, np.float32)


def render_cue(cue: Cue) -> np.ndarray:
    """The cue's audio, (n, 2): offset, length, looping with a crossfade at the loop point, fades, gain."""
    src = _read(cue.file)
    n = int(round(cue.length * SR))
    start = int(cue.offset * SR)
    if cue.loop is None or len(src) - start >= n:
        out = src[start : start + n]
        if len(out) < n:
            out = np.pad(out, ((0, n - len(out)), (0, 0)))
    else:
        ls, le = int(cue.loop.start * SR), min(len(src), int(cue.loop.end * SR))
        body = src[ls:le]
        xf = min(int(1.5 * SR), len(body) // 4)  # crossfade the loop seam
        ramp = np.linspace(0, 1, xf, dtype=np.float32)[:, None]
        pieces = [src[start:le]]
        total = len(pieces[0])
        while total < n + xf:
            prev = pieces[-1]
            joined = prev[-xf:] * (1 - ramp) + body[:xf] * ramp
            pieces[-1] = prev[:-xf]
            pieces.append(np.concatenate([joined, body[xf:]]))
            total = sum(len(p) for p in pieces)
        out = np.concatenate(pieces)[:n]
    out = out.copy()
    fi = _fade(len(out), cue.fadeIn)
    if len(fi):
        out[: len(fi)] *= fi[:, None]
    fo = _fade(len(out), cue.fadeOut)
    if len(fo):
        out[len(out) - len(fo) :] *= fo[::-1, None]
    return out * np.float32(10 ** (cue.gainDb / 20))


def place(bus: np.ndarray, audio: np.ndarray, start: float) -> None:
    s = int(round(start * SR))
    a0 = max(0, -s)
    b0 = max(0, s)
    k = min(len(audio) - a0, len(bus) - b0)
    if k > 0:
        bus[b0 : b0 + k] += audio[a0 : a0 + k]


# ---------------------------------------------------------------- ducking and gates


def voice_activity(voice: np.ndarray, frame: float = 0.02) -> np.ndarray:
    """Per-sample 0/1: is the narrator speaking (RMS within 35 dB of the loudest speech)?"""
    hop = int(frame * SR)
    n = len(voice) // hop
    rms = np.sqrt((voice[: n * hop].reshape(n, hop) ** 2).mean(axis=1) + 1e-12)
    db = 20 * np.log10(rms)
    active = (db > np.percentile(db, 98) - 35).astype(np.float32)
    # bridge the gaps between words (< 250 ms) so the bed doesn't pump inside a sentence
    bridge = int(0.25 / frame)
    active = (uniform_filter1d(active, bridge, mode="nearest") > 0.001).astype(np.float32)
    out = np.repeat(active, hop)
    return np.pad(out, (0, len(voice) - len(out)), mode="edge")


def duck_gain(activity: np.ndarray, rule: Duck) -> np.ndarray:
    """Gain curve (linear): -depth dB while the voice is active, smoothed with attack/release, with lookahead."""
    look = int(rule.lookaheadMs / 1000 * SR)
    act = np.concatenate([activity[look:], np.zeros(look, np.float32)]) if look else activity
    target = np.where(act > 0.5, -rule.depthDb, 0.0)
    # one-pole smoothing on a 1 ms grid (fast enough, and the curve is smooth anyway)
    step = SR // 1000
    coarse = target[::step]
    a = np.exp(-1.0 / max(1.0, rule.attackMs))
    r = np.exp(-1.0 / max(1.0, rule.releaseMs))
    y = np.empty_like(coarse)
    g = 0.0
    for i, t in enumerate(coarse):
        c = a if t < g else r
        g = c * g + (1 - c) * t
        y[i] = g
    gain_db = np.repeat(y, step)[: len(activity)]
    gain_db = np.pad(gain_db, (0, len(activity) - len(gain_db)), mode="edge")
    return (10 ** (gain_db / 20)).astype(np.float32)


def gate_gain(n: int, gates: list[Gate]) -> np.ndarray:
    g = np.ones(n, np.float32)
    for gate in gates:
        s, e = int(gate.start * SR), int(gate.end * SR)
        f = max(1, int(gate.fade * SR))
        r = max(1, int(gate.release * SR))
        idx = np.arange(max(0, s - f), min(n, e + r))
        if not len(idx):
            continue
        down = np.clip((s - idx) / f, 0, 1)  # 1 before the gate, 0 inside
        up = np.clip((idx - e) / r, 0, 1)
        g[idx] = np.minimum(g[idx], np.maximum(down, up))
    return g


# ---------------------------------------------------------------- loudness


def true_peak_limit_stereo(y: np.ndarray, ceiling_db: float, ms: float = 8.0) -> np.ndarray:
    """master.true_peak_limit for (n, 2): one gain curve from the louder channel's oversampled peak."""
    win = max(3, int(SR * ms / 1000) | 1)
    n = len(y)
    peaks = []
    for c in range(y.shape[1]):
        over = np.abs(resample_poly(y[:, c].astype(np.float64), 4, 1))
        peaks.append(np.maximum.reduce([over[i::4][:n] for i in range(4)]))
    peak = np.maximum.reduce(peaks)
    required = np.minimum(1.0, 10 ** (ceiling_db / 20) / np.maximum(peak, 1e-9))
    gain = uniform_filter1d(minimum_filter1d(required, size=win, mode="nearest"), size=win, mode="nearest")
    return (y * gain[:, None]).astype(np.float32)


def loudness(y: np.ndarray) -> tuple[float, float]:
    lufs = pyln.Meter(SR).integrated_loudness(y.astype(np.float64))
    peak = max(float(np.abs(resample_poly(y[:, c].astype(np.float64), 4, 1)).max()) for c in range(y.shape[1]))
    return float(lufs), 20 * np.log10(max(peak, 1e-9))


def normalise(y: np.ndarray, target: float, ceiling: float) -> np.ndarray:
    gain = target - loudness(y)[0]
    out = y
    for _ in range(8):
        out = true_peak_limit_stereo(y * np.float32(10 ** (gain / 20)), ceiling)
        err = target - loudness(out)[0]
        if abs(err) <= 0.1:
            break
        gain += err
    return out


# ---------------------------------------------------------------- the mix


def plan_hash(raw: dict) -> str:
    return hashlib.sha256(json.dumps(raw, sort_keys=True).encode()).hexdigest()[:20]


def mix(plan: Plan) -> tuple[np.ndarray, dict]:
    voice, sr = sf.read(plan.voice.file, always_2d=True, dtype="float32")
    if sr != SR:
        raise SystemExit(f"narration is {sr} Hz, expected {SR}")
    voice = voice.mean(axis=1)
    n = max(len(voice), int(round(plan.duration * SR)))
    voice = np.pad(voice, (0, n - len(voice)))

    buses = {k: np.zeros((n, 2), np.float32) for k in ("music", "ambience", "fx")}
    for cue in plan.cues:
        bus = cue.kind if cue.kind in ("music", "ambience") else "fx"
        place(buses[bus], render_cue(cue), cue.start)

    activity = voice_activity(voice)
    gates = gate_gain(n, plan.gates)
    music_duck = duck_gain(activity, plan.duck.music)
    buses["music"] *= (music_duck * gates)[:, None]
    buses["ambience"] *= (duck_gain(activity, plan.duck.ambience) * gates)[:, None]

    total = buses["music"] + buses["ambience"] + buses["fx"] + voice[:, None]
    out = normalise(total, plan.targetLufs, plan.truePeakDbtp)

    # how far the music sits under the voice while the narrator speaks (for the report)
    speaking = activity > 0.5
    under = None
    if buses["music"].any() and speaking.any():
        m = np.sqrt((buses["music"][speaking] ** 2).mean() + 1e-12)
        v = np.sqrt((voice[speaking] ** 2).mean() + 1e-12)
        under = float(20 * np.log10(v / m))
    integrated, tp = loudness(out)
    voice_lufs = pyln.Meter(SR).integrated_loudness(np.stack([voice, voice], axis=1).astype(np.float64))
    return out, {"integratedLufs": round(integrated, 2), "truePeakDbtp": round(tp, 2), "voiceLufs": round(float(voice_lufs), 2), "musicUnderVoiceDb": None if under is None else round(under, 1)}


def main(argv: list[str]) -> None:
    if len(argv) != 3:
        raise SystemExit("usage: python -m studio_audio.mix <mixplan.json> <out.wav> <result.json>")
    plan_path, out_path, result_path = (Path(a) for a in argv)
    raw = json.loads(plan_path.read_text())
    plan = Plan.model_validate(raw)
    if plan.mixer != MIXER_VERSION:
        raise SystemExit(f"the plan is for mixer version {plan.mixer}; this mixer is version {MIXER_VERSION}")
    for f, sha in [(plan.voice.file, plan.voice.sha256)] + [(c.file, c.sha256) for c in plan.cues]:
        if hashlib.sha256(Path(f).read_bytes()).hexdigest() != sha:
            raise SystemExit(f"{f} changed since the plan was made; run `pnpm assets index` and `pnpm mix` again")
    started = time.time()
    out, stats = mix(plan)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_suffix(".tmp.wav")
    sf.write(tmp, out, SR, subtype="PCM_24")
    tmp.replace(out_path)
    result = {"version": 1, "planHash": plan_hash(raw), "file": out_path.name, "duration": round(len(out) / SR, 3), **stats, "renderedMs": round((time.time() - started) * 1000)}
    result_path.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main(sys.argv[1:])
