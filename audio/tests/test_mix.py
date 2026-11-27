"""Mixer DSP (no models, no asset files beyond a temp WAV): looping, ducking, gates, loudness.

    cd audio && uv run --no-project --with pytest python -m pytest tests -q
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
import soundfile as sf

from studio_audio import mix, sfx_synth

SR = mix.SR


def cue(path, **kw):
    base = dict(id="c1", kind="music", asset="a", file=str(path), sha256="0" * 64, licence="Own work", start=0.0, offset=0.0, length=1.0, loop=None, gainDb=0.0, fadeIn=0.0, fadeOut=0.0, reason="")
    base.update(kw)
    return mix.Cue(**base)


def test_a_cue_longer_than_its_file_loops_to_the_exact_length(tmp_path):
    f = tmp_path / "bed.wav"
    sf.write(f, np.full((SR * 4, 2), 0.1, np.float32), SR)
    out = mix.render_cue(cue(f, length=10.0, loop=mix.Loop(start=0, end=4)))
    assert len(out) == SR * 10
    assert np.abs(out[SR * 9]).max() > 0.05  # still playing after the file ran out


def test_gain_and_fades(tmp_path):
    f = tmp_path / "tone.wav"
    sf.write(f, np.full((SR, 2), 0.5, np.float32), SR)
    out = mix.render_cue(cue(f, gainDb=-6.0, fadeIn=0.1, fadeOut=0.1))
    assert abs(out[SR // 2, 0] - 0.5 * 10 ** (-6 / 20)) < 1e-3
    assert out[0, 0] == 0 and abs(out[-1, 0]) < 1e-3


def test_ducking_reaches_its_depth_while_the_voice_speaks():
    activity = np.zeros(SR * 4, np.float32)
    activity[SR : SR * 3] = 1
    g = mix.duck_gain(activity, mix.Duck(depthDb=11, attackMs=70, releaseMs=550, lookaheadMs=80))
    assert abs(20 * np.log10(g[int(SR * 2)]) + 11) < 0.2  # fully down mid-speech
    assert g[int(SR * 0.5)] > 0.99  # untouched before
    assert 20 * np.log10(g[int(SR * 0.99)]) < -3  # lookahead: already going down before the first word


def test_a_gate_silences_the_beds_and_releases():
    g = mix.gate_gain(SR * 4, [mix.Gate(start=1.0, end=2.0, fade=0.05, release=1.0, reason="")])
    assert g[int(SR * 0.5)] == 1 and g[int(SR * 1.5)] == 0
    assert 0 < g[int(SR * 2.5)] < 1 and g[int(SR * 3.5)] == 1


def test_normalise_hits_minus_14_lufs_under_the_true_peak_ceiling():
    rng = np.random.default_rng(0)
    y = (rng.standard_normal((SR * 5, 2)) * 0.05).astype(np.float32)
    y[SR * 2 : SR * 2 + 100] = 0.99  # a spike the limiter must catch
    out = mix.normalise(y, -14.0, -1.5)
    lufs, tp = mix.loudness(out)
    assert abs(lufs + 14) <= 0.15
    assert tp <= -1.4


def test_risers_end_on_their_peak_and_hits_start_on_it():
    r = sfx_synth.riser(2.0)
    env = np.abs(r).max(axis=0)
    assert np.argmax(env) > 0.9 * len(env)
    h = sfx_synth.hit_impact()
    assert np.argmax(np.abs(h).max(axis=0)) < 0.2 * SR  # the attack is at 0; the low body peaks just after
