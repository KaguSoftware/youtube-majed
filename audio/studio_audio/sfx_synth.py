"""Sound-design elements made here, from oscillators and noise (docs/PLAN.md section 7).

Risers, hits, whooshes and room tone are the backbone of the mix rules (a riser
into every head fake, a hit on the reveal word, a whoosh on every wipe, room
tone under interiors). They synthesize well, carry no licence (own work), and
match nobody's recording in Content ID.

The music beds here are PLACEHOLDERS: simple pads, one per mood, so the music
path of the mix (mood per loop, loop points, ducking under the voice) can be
built and heard before real music is chosen. They are tagged `placeholder` and
lose to any real bed of the same mood.

Every recipe returns float32 stereo (2, n) at SR. `python -m studio_audio.assets seed`
renders them into assets/.
"""

from __future__ import annotations

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt, sosfiltfilt

SR = 48_000


def _t(seconds: float) -> np.ndarray:
    return np.arange(int(seconds * SR)) / SR


def _rng(seed: int) -> np.random.Generator:
    return np.random.default_rng(seed)


def _phase(freq: np.ndarray | float, n: int) -> np.ndarray:
    f = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))
    return 2 * np.pi * np.cumsum(f) / SR


def _lp(x: np.ndarray, hz: float, order: int = 2) -> np.ndarray:
    return sosfilt(butter(order, min(hz, SR / 2 - 100), "low", fs=SR, output="sos"), x)


def _hp(x: np.ndarray, hz: float, order: int = 2) -> np.ndarray:
    return sosfilt(butter(order, hz, "high", fs=SR, output="sos"), x)


def _sweep(noise: np.ndarray, centre: np.ndarray, q: float = 1.5, frame: float = 0.02) -> np.ndarray:
    """Band-pass with a moving centre: overlapping Hann frames, each masked in the spectrum."""
    hop = int(frame * SR / 2)
    size = hop * 2
    win = np.hanning(size)
    out = np.zeros(len(noise) + size)
    freqs = np.fft.rfftfreq(size, 1 / SR)
    for start in range(0, len(noise) - size, hop):
        c = centre[min(start + hop, len(centre) - 1)]
        bw = c / q
        mask = np.exp(-0.5 * ((freqs - c) / (bw / 2)) ** 2)
        spec = np.fft.rfft(noise[start : start + size] * win) * mask
        out[start : start + size] += np.fft.irfft(spec, size) * win
    return out[: len(noise)]


def _reverb_ir(seconds: float, seed: int, damp_hz: float = 5000) -> np.ndarray:
    n = int(seconds * SR)
    env = np.exp(-6.9 * np.arange(n) / n)
    rng = _rng(seed)
    ir = np.stack([_lp(rng.standard_normal(n) * env, damp_hz), _lp(rng.standard_normal(n) * env, damp_hz)])
    return ir / np.sqrt((ir**2).sum(axis=1, keepdims=True))


def _reverb(x: np.ndarray, seconds: float = 2.0, wet: float = 0.3, seed: int = 1, circular: bool = False) -> np.ndarray:
    """x: (2, n). Convolution reverb; `circular` folds the tail back to the start (seamless loops)."""
    ir = _reverb_ir(seconds, seed)
    n = x.shape[1]
    wetsig = np.stack([fftconvolve(x[c], ir[c]) for c in range(2)])
    if circular:
        tail = wetsig[:, n:]
        folded = wetsig[:, :n].copy()
        for k in range(0, tail.shape[1], n):
            seg = tail[:, k : k + n]
            folded[:, : seg.shape[1]] += seg
        wetsig = folded
    else:
        x = np.pad(x, ((0, 0), (0, wetsig.shape[1] - n)))
    return (1 - wet) * x + wet * wetsig[:, : x.shape[1]]


def _stereo(mono: np.ndarray, width: float = 0.0, seed: int = 0) -> np.ndarray:
    if width <= 0:
        return np.stack([mono, mono])
    d = int(0.012 * SR * width)
    return np.stack([mono, np.concatenate([np.zeros(d), mono[: len(mono) - d]])])


def _norm(x: np.ndarray, peak_db: float = -1.0) -> np.ndarray:
    x = np.atleast_2d(x)
    fade = int(0.004 * SR)
    x[:, :fade] *= np.linspace(0, 1, fade)
    x[:, -fade:] *= np.linspace(1, 0, fade)
    return (x / max(1e-9, np.abs(x).max()) * 10 ** (peak_db / 20)).astype(np.float32)


# ---------------------------------------------------------------- risers (end on their peak: the reveal word)


def riser(seconds: float = 3.0, low: float = 110.0, high: float = 880.0, seed: int = 3, dark: bool = False) -> np.ndarray:
    n = int(seconds * SR)
    t = np.arange(n) / n
    rng = _rng(seed)
    env = t**2.4
    centre = 250 * (24 if not dark else 10) ** t
    air = np.stack([_sweep(rng.standard_normal(n), centre, q=2.2), _sweep(rng.standard_normal(n), centre * 1.05, q=2.2)]) * env
    f = low * (high / low) ** (t**1.3)
    vib = 1 + 0.004 * (1 + 6 * t) * np.sin(2 * np.pi * (5 + 4 * t) * np.arange(n) / SR)
    tone = sum(np.sin(_phase(f * vib * m, n)) / (k + 1) for k, m in enumerate([1, 1.005, 2.0, 1.498]))
    tone = _lp(tone, 2500 if not dark else 900) * env * (0.55 if not dark else 0.8)
    sub = np.sin(_phase(low / 2 * (1 + t), n)) * env * (0.0 if not dark else 0.5)
    x = air * (0.9 if not dark else 0.6) + np.stack([tone + sub, tone + sub])
    x = _reverb(x, 1.6, 0.25, seed)[:, :n]
    x[:, -int(0.01 * SR) :] *= np.linspace(1, 0, int(0.01 * SR))
    return _norm(x)


def swell_reverse(seconds: float = 2.5, seed: int = 7) -> np.ndarray:
    """A reversed cymbal: bright noise swelling into the downbeat."""
    n = int(seconds * SR)
    rng = _rng(seed)
    decay = np.exp(-4.5 * np.arange(n) / n)
    hit = np.stack([_hp(rng.standard_normal(n), 3500, 4), _hp(rng.standard_normal(n), 3600, 4)]) * decay
    hit += 0.4 * np.stack([np.sin(_phase(5200, n)) * decay**2, np.sin(_phase(5230, n)) * decay**2])
    x = _reverb(hit, 1.5, 0.35, seed)[:, :n][:, ::-1]
    return _norm(x)


# ---------------------------------------------------------------- hits (peak at 0: land on the word)


def hit_boom(seed: int = 11) -> np.ndarray:
    n = int(2.8 * SR)
    tt = np.arange(n) / SR
    f = 32 + 48 * np.exp(-tt * 9)
    sub = np.sin(_phase(f, n)) * np.exp(-tt * 1.6)
    sub = np.tanh(sub * 2.2) * 0.8
    rng = _rng(seed)
    crack = _lp(rng.standard_normal(n), 1800) * np.exp(-tt * 40) * 0.6
    x = _reverb(np.stack([sub + crack, sub + crack]), 2.4, 0.22, seed)[:, :n]
    return _norm(x)


def hit_impact(seed: int = 12) -> np.ndarray:
    n = int(1.6 * SR)
    tt = np.arange(n) / SR
    body = np.sin(_phase(45 + 110 * np.exp(-tt * 28), n)) * np.exp(-tt * 5)
    rng = _rng(seed)
    snap = _hp(rng.standard_normal(n), 900) * np.exp(-tt * 55) * 0.7
    metal = sum(np.sin(_phase(fr, n)) for fr in (311, 467, 733)) * np.exp(-tt * 9) * 0.08
    mono = np.tanh((body + snap + metal) * 1.8)
    x = _reverb(_stereo(mono, 0.6), 1.4, 0.3, seed)[:, :n]
    return _norm(x)


def hit_braam(seed: int = 13) -> np.ndarray:
    """A low brass-like blast: the trailer 'braam' for big reveals."""
    n = int(3.2 * SR)
    tt = np.arange(n) / SR
    env = np.minimum(1, tt / 0.02) * np.exp(-tt * 1.1)
    voices = []
    for k, f in enumerate([55.0, 82.41, 110.0, 164.81]):
        for det in (-0.6, 0.0, 0.7):
            ph = _phase(f * (1 + det / 100), n)
            voices.append(2 * ((ph / (2 * np.pi)) % 1) - 1)
    saw = np.sum(voices, axis=0) / len(voices)
    bright = 300 + 2200 * np.exp(-tt * 2.5)
    out = np.zeros(n)
    step = int(0.01 * SR)
    for s in range(0, n, step):  # a closing low-pass, in short blocks
        seg = saw[max(0, s - 256) : s + step]
        out[s : s + step] = _lp(seg, float(bright[s]), 2)[-len(out[s : s + step]) :]
    mono = np.tanh(out * env * 3) * 0.8 + np.sin(_phase(41.2, n)) * env * 0.5
    x = _reverb(_stereo(mono, 0.8), 2.6, 0.3, seed)[:, :n]
    return _norm(x)


# ---------------------------------------------------------------- whooshes (peak at ~60 %: on the cut)


def whoosh(seconds: float = 0.8, low: float = 400, high: float = 3500, seed: int = 21, heavy: bool = False) -> np.ndarray:
    n = int(seconds * SR)
    t = np.arange(n) / n
    rng = _rng(seed)
    peak = 0.6
    bell = np.where(t < peak, (t / peak) ** 2.2, ((1 - t) / (1 - peak)) ** 1.6)
    centre = low + (high - low) * np.where(t < peak, t / peak, 1 - 0.6 * (t - peak) / (1 - peak))
    mono = _sweep(rng.standard_normal(n), centre, q=1.3) * bell
    if heavy:
        mono += np.sin(_phase(60 + 50 * bell, n)) * bell * 0.5
    pan = np.clip(t * 1.3 - 0.15, 0, 1)
    x = np.stack([mono * np.cos(pan * np.pi / 2) * 1.2, mono * np.sin(pan * np.pi / 2) * 1.2])
    return _norm(x, -2.0)


# ---------------------------------------------------------------- ambience


def room_tone(seconds: float = 30.0, seed: int = 31) -> np.ndarray:
    """A quiet interior: soft low air and a trace of hum. Loops seamlessly (circular filtering)."""
    n = int(seconds * SR)
    rng = _rng(seed)
    spec_n = np.fft.rfftfreq(n, 1 / SR)
    out = []
    for c in range(2):
        spec = np.fft.rfft(rng.standard_normal(n))
        shape = 1 / np.maximum(spec_n, 20) ** 0.5 * np.exp(-spec_n / 900)
        out.append(np.fft.irfft(spec * shape, n))  # FFT filtering is circular: the loop has no seam
    x = np.stack(out)
    hum = 0.03 * np.sin(2 * np.pi * 50 * np.arange(n) / SR) + 0.012 * np.sin(2 * np.pi * 100 * np.arange(n) / SR)
    x = x / np.abs(x).max() + hum
    return _norm(x, -6.0)


# ---------------------------------------------------------------- placeholder music beds (seamless loops)

_NOTE = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}


def _hz(name: str) -> float:
    pitch, octave = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((_NOTE[pitch] + 12 * (octave - 4) - 9) / 12)


def _pad(chords: list[list[str]], seconds_each: float, cutoff: float, seed: int, pulse_bpm: float | None = None, pulse_note: str | None = None, bells: list[str] | None = None) -> np.ndarray:
    total = int(len(chords) * seconds_each * SR)
    out = np.zeros((2, total))
    each = int(seconds_each * SR)
    for i, chord in enumerate(chords):
        n = each + int(1.5 * SR)  # overlap into the next chord (wrapped at the loop point)
        tt = np.arange(n) / SR
        env = np.minimum(1, tt / 1.8) * np.minimum(1, np.maximum(0, (n / SR - tt) / 1.5))
        for side in range(2):
            v = np.zeros(n)
            for note in chord:
                f = _hz(note)
                for det in (-0.35, 0.35):
                    ph = _phase(f * (1 + (det + 0.1 * side) / 100), n)
                    v += 2 * ((ph / (2 * np.pi)) % 1) - 1
            v = _lp(v / (len(chord) * 2), cutoff, 2) * env
            start = i * each
            idx = (start + np.arange(n)) % total
            np.add.at(out[side], idx, v)
    if pulse_bpm and pulse_note:
        beat = 60 / pulse_bpm / 2
        f = _hz(pulse_note)
        k = 0
        while k * beat < total / SR:
            s = int(k * beat * SR)
            n = int(0.22 * SR)
            tt = np.arange(n) / SR
            ph = _phase(f, n)
            note = np.sign(np.sin(ph)) * np.exp(-tt * 18) * (0.9 if k % 2 == 0 else 0.6)
            note = _lp(note, 700)
            idx = (s + np.arange(n)) % total
            out[:, idx] += 0.35 * note
            k += 1
    if bells:
        gap = total / SR / len(bells)
        for k, b in enumerate(bells):
            s = int((k * gap + 0.4) * SR)
            n = int(2.5 * SR)
            tt = np.arange(n) / SR
            f = _hz(b)
            note = (np.sin(_phase(f, n)) + 0.3 * np.sin(_phase(f * 2.76, n)) * np.exp(-tt * 3)) * np.exp(-tt * 1.8) * 0.25
            idx = (s + np.arange(n)) % total
            out[0, idx] += note
            out[1, idx] += note * 0.8
    return _norm(_reverb(out, 3.0, 0.35, seed, circular=True), -3.0)


def bed_mystery() -> np.ndarray:
    return _pad([["D3", "F3", "A3", "E4"], ["A#2", "D3", "F3", "A3"], ["G2", "A#2", "D3", "F3"], ["A2", "D3", "E3", "G3"]], 12.0, 1100, 41, bells=["A4", "F4", "D5", "E4", "A4", "C5"])


def bed_tense() -> np.ndarray:
    return _pad([["D2", "A2", "D3"], ["D2", "A2", "D#3"], ["D2", "A2", "D3"], ["C2", "G2", "D#3"]], 12.0, 700, 42, pulse_bpm=100, pulse_note="D2")


def bed_calm() -> np.ndarray:
    return _pad([["C3", "E3", "G3", "B3"], ["A2", "C3", "E3", "G3"], ["F2", "A2", "C3", "E3"], ["G2", "B2", "D3", "E3"]], 12.0, 1500, 43, bells=["E5", "G4", "C5", "B4"])


def bed_sad() -> np.ndarray:
    return _pad([["A2", "C3", "E3"], ["F2", "A2", "C3"], ["C3", "E3", "G3"], ["G2", "B2", "D3"]], 12.0, 900, 44, bells=["E4", "C4", "G4", "D4"])


RECIPES = {
    "riser_short": lambda: riser(2.0, 160, 1200, seed=3),
    "riser_long": lambda: riser(4.0, 110, 880, seed=4),
    "riser_dark": lambda: riser(3.5, 55, 330, seed=5, dark=True),
    "swell_reverse": swell_reverse,
    "hit_boom": hit_boom,
    "hit_impact": hit_impact,
    "hit_braam": hit_braam,
    "whoosh_fast": lambda: whoosh(0.6, 500, 4200, seed=21),
    "whoosh_soft": lambda: whoosh(1.0, 300, 2500, seed=22),
    "whoosh_heavy": lambda: whoosh(1.2, 200, 2200, seed=23, heavy=True),
    "room_tone": room_tone,
    "bed_mystery": bed_mystery,
    "bed_tense": bed_tense,
    "bed_calm": bed_calm,
    "bed_sad": bed_sad,
}
