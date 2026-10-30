"""The stock sounds that are made rather than recorded (pipeline/sfx.py).

A fail horn, an air horn, a rimshot, a boing: the sounds meme edits reach for
are mostly instruments and cartoon effects, and those synthesize well from a
few oscillators, noise and envelopes. Made here, they carry no licence at all
and no Content ID match against anyone's recording. What does not synthesize
convincingly (laughter, applause, a crowd) is recorded instead, from the
public-domain and CC0 files in sfx.RECORDINGS.

Every recipe is deterministic (a fixed seed per sound) and returns mono float
samples at `SR`. `python -m pipeline.sfx build` encodes them; nothing here
runs on the worker.
"""

from __future__ import annotations

import numpy as np

SR = 48_000


# ------------------------------------------------------------------ helpers

def _t(seconds: float) -> np.ndarray:
    return np.arange(int(seconds * SR)) / SR


def _phase(freq: np.ndarray | float, n: int | None = None) -> np.ndarray:
    """Phase of an oscillator whose frequency may glide, sample by sample."""
    f = np.full(n, float(freq)) if np.isscalar(freq) else np.asarray(freq, float)
    return 2 * np.pi * np.cumsum(f) / SR


def _env(n: int, attack: float = 0.005, release: float = 0.05, decay: float | None = None) -> np.ndarray:
    """Linear attack and release around a sustain, or an exponential decay
    (time constant `decay` seconds) after the attack."""
    e = np.ones(n)
    a, r = max(1, int(attack * SR)), max(1, int(release * SR))
    e[:a] = np.linspace(0, 1, a)
    if decay is not None:
        e[a:] = np.exp(-np.arange(n - a) / SR / decay)
    e[-r:] *= np.linspace(1, 0, r)
    return e


def _band(x: np.ndarray, lo: float = 0.0, hi: float = SR / 2, soft: float = 0.15) -> np.ndarray:
    """Band-limit by FFT mask, with soft edges (a fraction of each edge)."""
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    mask = np.ones_like(f)
    if lo > 0:
        mask *= 1 / (1 + np.exp(-(f - lo) / max(1.0, lo * soft)))
    if hi < SR / 2:
        mask *= 1 / (1 + np.exp((f - hi) / max(1.0, hi * soft)))
    return np.fft.irfft(spec * mask, len(x))


def _sweep_band(x: np.ndarray, centre: np.ndarray, q: float = 1.2, frame: float = 0.02) -> np.ndarray:
    """A band-pass whose centre moves: overlapping Hann frames, each masked
    around the centre at its midpoint, added back together."""
    n = int(frame * SR)
    hop = n // 2
    win = np.hanning(n)
    out = np.zeros(len(x) + n)
    f = np.fft.rfftfreq(n, 1 / SR)
    for start in range(0, len(x), hop):
        seg = np.zeros(n)
        chunk = x[start:start + n]
        seg[:len(chunk)] = chunk
        c = centre[min(start + hop, len(centre) - 1)]
        mask = np.exp(-0.5 * (np.log2(np.maximum(f, 1) / c) * q * 2) ** 2)
        out[start:start + n] += np.fft.irfft(np.fft.rfft(seg * win) * mask, n)
    return out[:len(x)]


def _reverb(x: np.ndarray, seconds: float = 1.2, wet: float = 0.25, seed: int = 0) -> np.ndarray:
    """Convolution with decaying, darkening noise: a room, not an echo."""
    rng = np.random.default_rng(seed)
    t = _t(seconds)
    ir = rng.standard_normal(len(t)) * np.exp(-t / (seconds / 5))
    ir = _band(ir, hi=5000)
    ir /= np.sqrt(np.sum(ir ** 2))
    n = len(x) + len(ir)
    tail = np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(ir, n), n)
    out = np.zeros(n)
    out[:len(x)] = x * (1 - wet)
    return out + tail * wet


def _brass(freq, n: int, *, brightness: np.ndarray, harmonics: int = 24) -> np.ndarray:
    """Additive brass: harmonics up to a moving cutoff (`brightness`, Hz), the
    way lip pressure and a plunger mute open and close a trombone's tone."""
    ph = _phase(freq, n)
    f = np.full(n, float(freq)) if np.isscalar(freq) else np.asarray(freq, float)
    out = np.zeros(n)
    for k in range(1, harmonics + 1):
        gain = 1 / (1 + np.exp((k * f - brightness) / (0.25 * brightness))) / k ** 0.6
        out += gain * np.sin(k * ph)
    return out


def _bell(freq: float, seconds: float, decay: float = 0.4) -> np.ndarray:
    """Inharmonic partials, the higher ones dying first: a struck bell."""
    t = _t(seconds)
    out = np.zeros(len(t))
    for ratio, amp in ((1, 1.0), (2.76, 0.5), (5.4, 0.25), (8.93, 0.12)):
        out += amp * np.sin(2 * np.pi * freq * ratio * t) * np.exp(-t / (decay / ratio ** 0.5))
    return out * _env(len(t), 0.001, 0.02)


def _square(phase: np.ndarray, duty: float = 0.5) -> np.ndarray:
    return np.where((phase / (2 * np.pi)) % 1 < duty, 1.0, -1.0)


def _place(track: np.ndarray, at: float, sound: np.ndarray, gain: float = 1.0) -> None:
    i = int(at * SR)
    end = min(len(track), i + len(sound))
    track[i:end] += gain * sound[:end - i]


def _note(name: str) -> float:
    """'A4' -> 440.0; sharps as '#'."""
    names = {"C": -9, "C#": -8, "D": -7, "D#": -6, "E": -5, "F": -4, "F#": -3,
             "G": -2, "G#": -1, "A": 0, "A#": 1, "B": 2}
    return 440.0 * 2 ** ((names[name[:-1]] + 12 * (int(name[-1]) - 4)) / 12)


# ------------------------------------------------------------------ recipes

def sad_trombone() -> np.ndarray:
    """Wah, wah, wah, waaah: four falling semitones on a muted trombone,
    the last one held with a widening wobble."""
    notes = [("D4", 0.42), ("C#4", 0.42), ("C4", 0.42), ("B3", 1.6)]
    out = []
    for i, (name, dur) in enumerate(notes):
        n = int(dur * SR)
        t = np.arange(n) / SR
        f = np.full(n, _note(name))
        if i == len(notes) - 1:
            depth = 0.035 * np.clip(t / 0.5, 0, 1)
            f = f * (1 + depth * np.sin(2 * np.pi * 5.5 * t)) * (1 - 0.03 * np.clip(t - 1.1, 0, 1))
        # The plunger: closed, opened, closed again on every note.
        wah = np.sin(np.pi * np.clip(t / min(dur, 0.42), 0, 1)) ** 0.7
        brightness = 350 + 1700 * wah if i < len(notes) - 1 else 350 + 1500 * np.clip(t / 0.15, 0, 1) * np.exp(-t / 1.4)
        out.append(_brass(f, n, brightness=brightness) * _env(n, 0.03, 0.06))
    return _reverb(np.concatenate(out), 0.8, 0.15, seed=1)


def air_horn() -> np.ndarray:
    """Two short blasts and a long one, a hard chord driven into distortion."""
    track = np.zeros(int(1.7 * SR))
    for at, dur in ((0.0, 0.17), (0.24, 0.17), (0.48, 1.1)):
        n = int(dur * SR)
        x = sum(np.sin(_phase(f * (1 + 0.004 * k), n)) + 0.6 * np.sign(np.sin(_phase(f, n)))
                for k, f in enumerate((392.0, 466.2, 523.3, 587.3)))
        x = np.tanh(2.5 * x / 4) * _env(n, 0.008, 0.04)
        _place(track, at, _band(x, 250, 6000))
    return _reverb(track, 0.6, 0.12, seed=2)


def rimshot() -> np.ndarray:
    """Ba-dum-tss: snare, tom, cymbal."""
    rng = np.random.default_rng(3)
    track = np.zeros(int(1.6 * SR))
    n = int(0.25 * SR)
    t = np.arange(n) / SR
    snare = (0.6 * _band(rng.standard_normal(n), 1500, 9000) * np.exp(-t / 0.05)
             + np.sin(_phase(200 - 60 * t / 0.25, n)) * np.exp(-t / 0.06))
    tom = np.sin(_phase(140 - 50 * np.clip(t / 0.2, 0, 1), n)) * np.exp(-t / 0.12)
    n2 = int(1.1 * SR)
    t2 = np.arange(n2) / SR
    metal = sum(_square(_phase(f, n2)) for f in (205.3, 304.4, 369.6, 522.7, 540.0, 800.0))
    cymbal = _band(metal / 6 + 0.5 * rng.standard_normal(n2), 6000, 16000) * np.exp(-t2 / 0.35)
    _place(track, 0.0, snare, 0.9)
    _place(track, 0.17, tom, 1.0)
    _place(track, 0.42, cymbal, 1.6)
    _place(track, 0.42, tom * 0.5)
    return _reverb(track, 0.5, 0.12, seed=3)


def bass_boom() -> np.ndarray:
    """A deep, distorted thud with a long tail: the boom that lands a punchline."""
    rng = np.random.default_rng(4)
    t = _t(1.8)
    n = len(t)
    f = 45 + 55 * np.exp(-t / 0.08)
    body = np.tanh(3 * np.sin(_phase(f, n)) * np.exp(-t / 0.45))
    click = _band(rng.standard_normal(n), 1000, 8000) * np.exp(-t / 0.006) * 0.5
    return _reverb((body + click) * _env(n, 0.002, 0.2), 1.6, 0.3, seed=4)


def record_scratch() -> np.ndarray:
    """A record dragged forward and back under the needle."""
    rng = np.random.default_rng(5)
    src_t = _t(3.0)
    source = (_band(rng.standard_normal(len(src_t)), 200, 5000) * 0.6
              + sum(np.sin(2 * np.pi * f * src_t) for f in (196, 247, 294, 392)) * 0.25)
    n = int(0.62 * SR)
    t = np.arange(n) / SR
    rate = np.interp(t, [0, 0.07, 0.09, 0.2, 0.22, 0.32, 0.34, 0.5, 0.62],
                     [0.3, 3.2, -0.5, -2.8, 0.4, 3.0, -0.4, -2.0, -0.2])
    pos = 1.0 * SR + np.cumsum(rate)
    out = np.interp(pos, np.arange(len(source)), source)
    out *= np.clip(np.abs(rate) / 2.5, 0, 1) ** 0.6
    return _band(out, 150, 7000) * _env(n, 0.003, 0.03)


def dun_dun_dun() -> np.ndarray:
    """Dun, dun, duuun: two brass stabs and a held, lower chord over timpani."""
    track = np.zeros(int(3.4 * SR))
    for at, root, dur in ((0.0, "D3", 0.28), (0.42, "D3", 0.28), (0.84, "C#3", 2.1)):
        n = int(dur * SR)
        t = np.arange(n) / SR
        r = _note(root)
        chord = sum(_brass(r * ratio * (1 + 0.003 * k), n, brightness=600 + 2200 * np.exp(-t / 0.3), harmonics=16)
                    for k, ratio in enumerate((1.0, 1.189, 1.5, 2.0)))
        if dur > 1:
            chord *= 1 + 0.18 * np.sin(2 * np.pi * 6 * t)
        _place(track, at, chord * _env(n, 0.01, 0.15) / 3)
        timp = np.sin(_phase(r / 2 * (1 + 0.15 * np.exp(-t / 0.03)), n)) * np.exp(-t / 0.5)
        _place(track, at, timp * 0.9)
    return _reverb(track, 1.8, 0.3, seed=6)


def wrong_buzzer() -> np.ndarray:
    """The game-show buzzer for a wrong answer."""
    n = int(0.75 * SR)
    x = _square(_phase(147.0, n)) + _square(_phase(151.0, n)) + 0.5 * _square(_phase(294.0, n))
    return _band(np.tanh(x), 80, 3500) * _env(n, 0.005, 0.05)


def correct_ding() -> np.ndarray:
    """Ding-ding: two bright bells, the second higher."""
    track = np.zeros(int(1.5 * SR))
    _place(track, 0.0, _bell(1318.5, 1.2, 0.5))
    _place(track, 0.13, _bell(1760.0, 1.3, 0.5))
    return track


def tada() -> np.ndarray:
    """Ta-daaa: a pickup note and a held major chord in brass."""
    track = np.zeros(int(2.0 * SR))
    for at, notes, dur in ((0.0, ("G4", "B4", "D5"), 0.13), (0.17, ("C5", "E5", "G5", "C6"), 1.5)):
        n = int(dur * SR)
        t = np.arange(n) / SR
        vib = 1 + 0.006 * np.sin(2 * np.pi * 5.5 * t) * np.clip((t - 0.25) / 0.3, 0, 1)
        chord = sum(_brass(_note(nm) * vib, n, brightness=900 + 2600 * np.exp(-t / 0.4), harmonics=14) for nm in notes)
        _place(track, at, chord * _env(n, 0.012, 0.25 if dur > 1 else 0.03) / len(notes))
    return _reverb(track, 1.2, 0.22, seed=7)


def level_up() -> np.ndarray:
    """An 8-bit arpeggio climbing to a held chord."""
    track = np.zeros(int(1.3 * SR))
    for i, nm in enumerate(("C5", "E5", "G5", "C6", "E6", "G6")):
        n = int(0.075 * SR)
        _place(track, i * 0.07, _square(_phase(_note(nm), n), 0.25) * _env(n, 0.002, 0.01) * 0.5)
    n = int(0.75 * SR)
    t = np.arange(n) / SR
    for nm in ("C6", "E6", "G6"):
        _place(track, 0.45, _square(_phase(_note(nm) * (1 + 0.01 * np.sin(2 * np.pi * 7 * t)), n), 0.25)
               * _env(n, 0.003, 0.3, decay=0.5) * 0.25)
    return _band(track, 100, 9000)


def coin() -> np.ndarray:
    """A coin picked up: a short note and a higher one ringing off."""
    track = np.zeros(int(0.6 * SR))
    n1, n2 = int(0.07 * SR), int(0.5 * SR)
    _place(track, 0.0, _square(_phase(987.8, n1)) * _env(n1, 0.001, 0.005))
    _place(track, 0.07, _square(_phase(1318.5, n2)) * _env(n2, 0.001, 0.05, decay=0.15))
    return _band(track, 100, 8000) * 0.5


def censor_bleep() -> np.ndarray:
    """The broadcast bleep: one second of a 1 kHz tone."""
    n = int(1.0 * SR)
    return np.sin(_phase(1000.0, n)) * _env(n, 0.004, 0.004) * 0.7


def glitch() -> np.ndarray:
    """A digital stutter: chopped, repeated fragments at jumping pitches."""
    rng = np.random.default_rng(8)
    out = []
    for _ in range(14):
        n = int(rng.uniform(0.015, 0.05) * SR)
        kind = rng.integers(3)
        if kind == 0:
            frag = _square(_phase(rng.uniform(200, 2400), n), rng.uniform(0.1, 0.5))
        elif kind == 1:
            frag = _band(rng.standard_normal(n), rng.uniform(500, 3000), 12000)
        else:
            frag = np.sin(_phase(np.linspace(rng.uniform(2000, 5000), 200, n), n))
        frag = np.tile(frag, int(rng.integers(1, 4)))
        out.append(frag * _env(len(frag), 0.001, 0.002) * rng.uniform(0.4, 0.9))
        if rng.random() < 0.3:
            out.append(np.zeros(int(0.02 * SR)))
    return np.concatenate(out)


def error() -> np.ndarray:
    """A two-note computer error: down a fifth."""
    track = np.zeros(int(0.5 * SR))
    for at, f in ((0.0, 880.0), (0.16, 587.3)):
        n = int(0.15 * SR)
        x = np.sin(_phase(f, n)) + 0.3 * _square(_phase(f, n))
        _place(track, at, x * _env(n, 0.003, 0.03) * 0.6)
    return _band(track, 150, 6000)


def crickets() -> np.ndarray:
    """Two crickets in a quiet night: the silence after a joke that died."""
    rng = np.random.default_rng(9)
    total = 3.6
    track = 0.015 * _band(rng.standard_normal(int(total * SR)), 200, 3000)
    for carrier, period, offset, gain in ((4600.0, 0.62, 0.05, 1.0), (4150.0, 0.81, 0.33, 0.6)):
        at = offset
        while at < total - 0.3:
            n = int(0.14 * SR)
            t = np.arange(n) / SR
            pulses = np.clip(np.sin(2 * np.pi * 28 * t), 0, 1) ** 2
            _place(track, at, np.sin(2 * np.pi * carrier * t) * pulses * _env(n, 0.005, 0.02) * gain * 0.5)
            at += period * rng.uniform(0.95, 1.05)
    return track


def boing() -> np.ndarray:
    """A spring let go: a rising, wobbling tone dying away."""
    t = _t(0.9)
    n = len(t)
    f = (140 + 220 * (1 - np.exp(-t / 0.25))) * (1 + 0.25 * np.sin(2 * np.pi * 13 * t) * np.exp(-t / 0.3))
    ph = _phase(f, n)
    x = np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.15 * np.sin(3 * ph)
    return x * _env(n, 0.003, 0.05, decay=0.3) * 0.7


def _whistle(start: float, end: float, seconds: float) -> np.ndarray:
    rng = np.random.default_rng(10)
    t = _t(seconds)
    n = len(t)
    f = start * (end / start) ** (t / seconds)
    f *= 1 + 0.01 * np.sin(2 * np.pi * 6 * t)
    breath = _band(rng.standard_normal(n), 1500, 7000) * 0.04
    return (np.sin(_phase(f, n)) + 0.08 * np.sin(2 * _phase(f, n)) + breath) * _env(n, 0.02, 0.08) * 0.6


def slide_up() -> np.ndarray:
    """A slide whistle, up."""
    return _whistle(380, 1700, 0.75)


def slide_down() -> np.ndarray:
    """A slide whistle, down: something falling."""
    return _whistle(1700, 300, 1.0)


def pop() -> np.ndarray:
    """A cartoon pop."""
    t = _t(0.12)
    n = len(t)
    f = 220 + 700 * np.exp(-t / 0.012)
    return np.sin(_phase(f, n)) * _env(n, 0.0008, 0.02, decay=0.03)


def whoosh() -> np.ndarray:
    """Something swept fast past the camera."""
    rng = np.random.default_rng(11)
    t = _t(0.8)
    n = len(t)
    centre = 300 * (8 ** np.sin(np.pi * np.clip(t / 0.8, 0, 1)) ** 2)
    x = _sweep_band(rng.standard_normal(n), centre, q=0.9)
    amp = np.sin(np.pi * t / 0.8) ** 2.2
    return x * amp * 2.2


def bonk() -> np.ndarray:
    """A hollow knock on the head, the pitch dropping out of it."""
    rng = np.random.default_rng(12)
    t = _t(0.45)
    n = len(t)
    knock = (np.sin(_phase(820 - 350 * np.clip(t / 0.15, 0, 1), n)) + 0.5 * np.sin(_phase(1730.0, n)))
    knock *= np.exp(-t / 0.09)
    thud = np.sin(_phase(110 - 40 * t, n)) * np.exp(-t / 0.07)
    click = _band(rng.standard_normal(n), 2000, 10000) * np.exp(-t / 0.004) * 0.6
    return (knock * 0.7 + thud + click) * _env(n, 0.0005, 0.05) * 0.8


def sparkle() -> np.ndarray:
    """Magic: a cascade of small high bells."""
    rng = np.random.default_rng(13)
    track = np.zeros(int(1.6 * SR))
    for i in range(16):
        f = rng.uniform(2200, 5200)
        _place(track, i * 0.055 + rng.uniform(0, 0.02), _bell(f, 0.6, 0.25), rng.uniform(0.25, 0.5))
    return _reverb(track, 1.0, 0.3, seed=13)


def heartbeat() -> np.ndarray:
    """Lub-dub, three times: tension."""
    track = np.zeros(int(2.9 * SR))
    t = _t(0.25)
    n = len(t)
    beat = np.sin(_phase(55 + 25 * np.exp(-t / 0.02), n)) * _env(n, 0.006, 0.05, decay=0.06)
    for k in range(3):
        _place(track, k * 0.9, beat, 1.0)
        _place(track, k * 0.9 + 0.27, beat, 0.7)
    return np.tanh(2 * _band(track, 20, 400))


def riser() -> np.ndarray:
    """A build of noise and a rising tone that stops dead."""
    rng = np.random.default_rng(14)
    t = _t(2.6)
    n = len(t)
    centre = 400 * (10 ** (t / 2.6))
    noise = _sweep_band(rng.standard_normal(n), centre, q=0.7)
    tone = sum(np.sin(_phase(f0 * 2 ** (2 * t / 2.6), n)) for f0 in (110.0, 110.0 * 1.5, 220.0)) / 3
    amp = (t / 2.6) ** 2
    x = (noise * 1.5 + tone * 0.6) * amp
    x[-int(0.01 * SR):] *= np.linspace(1, 0, int(0.01 * SR))
    return x


def slow_clap() -> np.ndarray:
    """One person, then faster: the slow clap."""
    rng = np.random.default_rng(15)
    gaps = [1.0, 0.85, 0.7, 0.55, 0.45, 0.36, 0.3, 0.25, 0.22, 0.2, 0.19]
    track = np.zeros(int((sum(gaps) + 0.5) * SR))
    at = 0.0
    for g in gaps:
        n = int(0.12 * SR)
        t = np.arange(n) / SR
        clap = _band(rng.standard_normal(n), 900, 4000) * np.exp(-t / 0.018)
        clap += 0.3 * np.sin(_phase(rng.uniform(160, 220), n)) * np.exp(-t / 0.02)
        _place(track, at, clap * rng.uniform(0.85, 1.0))
        at += g
    return _reverb(track, 1.4, 0.35, seed=15)


#: Recipe name -> function. sfx.STOCK names these.
RECIPES = {f.__name__: f for f in (
    sad_trombone, air_horn, rimshot, bass_boom, record_scratch, dun_dun_dun, wrong_buzzer,
    correct_ding, tada, level_up, coin, censor_bleep, glitch, error, crickets, boing, slide_up,
    slide_down, pop, whoosh, bonk, sparkle, heartbeat, riser, slow_clap,
)}
