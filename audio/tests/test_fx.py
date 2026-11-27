"""Voice effects (fx.py) and frame-aligned assembly (track.py)."""

import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from studio_audio import fx, track  # noqa: E402

SR = 24_000


def voice_like(seconds: float, seed: int = 0) -> np.ndarray:
    """Bursts of a harmonic tone with silence between them: enough like speech for levels and spans."""
    rng = np.random.default_rng(seed)
    t = np.arange(int(seconds * SR)) / SR
    tone = sum(np.sin(2 * np.pi * f * t) / k for k, f in enumerate([180, 360, 540, 900, 1800, 3200], 1))
    gate = (np.sin(2 * np.pi * 2.5 * t) > 0).astype(np.float32)
    return (0.2 * tone * gate + 0.002 * rng.standard_normal(len(t))).astype(np.float32)


WORDS = [{"text": "one", "start": 0.0, "end": 0.2}, {"text": "two", "start": 0.4, "end": 0.6}, {"text": "three", "start": 0.8, "end": 1.0}]


def test_every_preset_keeps_timing_and_level():
    x = voice_like(1.2)
    for name in fx.PRESETS:
        y = fx.apply(x, SR, [{"preset": name}], WORDS)
        assert len(y) >= len(x), name
        assert len(y) <= len(x) + int((fx.PRESETS[name].tail + 0.01) * SR), name
        level = 20 * np.log10(fx._speech_rms(y[: len(x)], SR) / fx._speech_rms(x, SR))
        assert abs(level) < 1.5, f"{name} moved the speech level by {level:.1f} dB"
        assert np.isfinite(y).all()


def test_a_word_effect_leaves_the_rest_of_the_take_alone():
    x = voice_like(1.2, seed=1)
    y = fx.apply(x, SR, [{"preset": "chipmunk", "word": 1}], WORDS)
    pad = int((fx.WORD_PAD + fx.RAMP) * SR)
    a, b = int(0.4 * SR) - pad, int(0.6 * SR) + pad
    ramp = int(fx.RAMP * SR)
    assert np.allclose(y[: a - ramp], x[: a - ramp], atol=1e-5), "audio before the word changed"
    after = int(0.6 * SR) + pad + int(fx.PRESETS["chipmunk"].tail * SR) + 1
    assert np.allclose(y[after : len(x)], x[after:], atol=1e-5), "audio after the word changed"
    assert not np.allclose(y[a:b], x[a:b], atol=1e-3), "the word itself did not change"


def test_fx_results_are_cached_by_take_and_effects(tmp_path: Path):
    lines = tmp_path / "lines"
    lines.mkdir()
    sf.write(lines / "L1.1.abc.wav", voice_like(1.2), SR)
    meta = {"words": WORDS}
    p1, made1 = fx.cached(lines, "L1.1", "abc", [{"preset": "robot", "word": 2}], meta)
    p2, made2 = fx.cached(lines, "L1.1", "abc", [{"preset": "robot", "word": 2}], meta)
    p3, _ = fx.cached(lines, "L1.1", "abc", [{"preset": "robot"}], meta)
    assert made1 and not made2 and p1 == p2 and p3 != p1


def test_lines_start_on_frames(tmp_path: Path):
    out = tmp_path / "audio"
    (out / "lines").mkdir(parents=True)
    order = []
    for i, (text, energy) in enumerate([("A first line.", 3), ("Then a second,", 2), ("and the reveal!", 5), ("Next loop?", 3)]):
        lid = f"L{1 if i < 3 else 2}.{i + 1}"
        key = f"k{i}"
        take = voice_like(0.7 + 0.13 * i, seed=i)
        sf.write(out / "lines" / f"{lid}.{key}.wav", take, SR)
        (out / "lines" / f"{lid}.{key}.json").write_text(json.dumps({
            "id": lid, "text": text, "energy": energy, "file": f"lines/{lid}.{key}.wav", "seed": 1, "seedUsed": 1, "settings": {},
            "quality": {"status": "ok", "wer": 0, "heard": "", "issues": [], "attempts": 1}, "words": [{"text": "w", "start": 0.1, "end": 0.3, "score": 0.9}],
        }))
        order.append({"id": lid, "key": key, **({"fx": [{"preset": "echo_thought"}]} if i == 1 else {})})
    v = track.assemble(out, order, engine={"name": "original", "revision": "r", "device": "cpu"}, reference={"file": "builtin:x", "sha256": "s"},
                       aligner=track.ALIGNER, narration=out / "narration.wav", voice_path=out / "voice.json")
    for line in v["lines"]:
        frames = line["offset"] * track.FRAME_RATE
        assert abs(frames - round(frames)) < 1e-3, f"{line['id']} starts at {line['offset']} s, between frames"
    # the echo's tail does not push the next line back: the gap is the pause rule's, give or take the frame rounding
    l1, l2 = v["lines"][1], v["lines"][2]
    gap = l2["offset"] - (l1["offset"] + l1["duration"])
    assert abs(gap - track.pause_after({"id": "L1.2", "text": "Then a second,"}, {"id": "L1.3", "energy": 5})) <= 0.5 / track.FRAME_RATE + 1e-6
    assert v["lines"][1]["fx"]["effects"] == [{"preset": "echo_thought"}]
    assert abs(sf.info(out / "narration.wav").duration - v["track"]["duration"]) < 1e-4
