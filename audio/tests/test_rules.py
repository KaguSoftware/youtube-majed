"""Pure-logic tests (no models): pause rules, the spoken-words gate, trimming, mastering targets.

    cd audio && uv run --no-project --with pytest python -m pytest tests -q
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np

from studio_audio import master
from studio_audio.align import spoken_check
from studio_audio.studio import PAUSE_BEFORE_REVEAL, PAUSE_LOOP_BOUNDARY, PAUSE_CONTINUES, pause_after
from studio_audio.tts import trim_silence


def line(i, text, energy=3):
    return {"id": i, "text": text, "energy": energy}


def test_pause_longest_at_loop_boundary():
    assert pause_after(line("L1.5", "Done."), line("L2.1", "Next.")) == PAUSE_LOOP_BOUNDARY


def test_pause_depends_on_how_the_line_ends():
    p = lambda text: pause_after(line("L1.1", text), line("L1.2", "Next."))
    assert p("He waits,") == PAUSE_CONTINUES
    assert PAUSE_CONTINUES < p("He waits.") < p("Who waits?") < PAUSE_LOOP_BOUNDARY
    assert p('He said "stop."') == p("He said stop.")  # closing quote does not hide the full stop


def test_reveal_beat_only_inside_a_loop():
    assert pause_after(line("L1.1", "A."), line("L1.2", "B.", 5)) == pause_after(line("L1.1", "A."), line("L1.2", "B.", 3)) + PAUSE_BEFORE_REVEAL
    assert pause_after(line("L1.4", "A."), line("L2.1", "B.", 5)) == PAUSE_LOOP_BOUNDARY


def test_gate_accepts_exact_and_misspelled_names_rejects_dropped_words():
    assert spoken_check("SAM ARRIVED A WEEK AGO", "SAM ARRIVED A WEEK AGO")[0] == 0
    assert spoken_check("THE NAHUA CAME", "THE NAPHEWA CAME")[0] == 0  # near-miss spelling is not an error
    assert spoken_check("SOMEONE IS STEALING THE OIL", "SOME ONE IS STEALING THE OIL")[0] == 0  # split word
    assert spoken_check("SOUTH SHIELDS HAS OIL", "SOUTHSHIELDS HAS OIL")[0] == 0  # two words run together
    wer, edits = spoken_check("THE LAMP HAS TWO HOURS OF OIL LEFT", "THE LAMP HAS TWO HOURS OF")
    assert wer > 0.2 and any("OIL" in e for e in edits)


def test_trim_keeps_speech_and_a_short_pad():
    sr = 24000
    x = np.zeros(sr * 3, dtype=np.float32)
    x[sr : sr * 2] = 0.3 * np.sin(2 * np.pi * 200 * np.arange(sr) / sr)
    y = trim_silence(x, sr)
    assert 1.1 < len(y) / sr < 1.4


def test_master_hits_loudness_and_true_peak_targets():
    sr = 48000
    t = np.arange(sr * 6) / sr
    speechlike = (0.2 * np.sin(2 * np.pi * 180 * t) * (np.sin(2 * np.pi * 3 * t) > 0)).astype(np.float32)
    speechlike[sr * 2] = 0.9  # a stray peak
    out, loud = master.master(speechlike, sr)
    assert abs(loud.integratedLufs - master.TARGET_LUFS) <= 0.2
    assert loud.truePeakDbtp <= master.TRUE_PEAK_MAX + 0.05


def test_balance_lines_evens_out_level_and_tone():
    from scipy.signal import butter, sosfilt
    from studio_audio import matcheq

    sr = 48000
    rng = np.random.default_rng(0)
    base = rng.standard_normal(sr * 2).astype(np.float32)
    bright = sosfilt(butter(2, 300, "hp", fs=sr, output="sos"), base).astype(np.float32) * 0.1
    dark = sosfilt(butter(2, 1500, "lp", fs=sr, output="sos"), base).astype(np.float32) * 0.07  # a few dB quieter and duller (within the clamps)
    lines = [bright, bright * 1.1, dark, bright * 0.9, dark * 1.2]
    out = matcheq.balance_lines(lines, sr)
    before = np.std([matcheq.speech_db(w, sr) for w in lines])
    after = np.std([matcheq.speech_db(w, sr) for w in out])
    assert after < before / 1.5
    hi = lambda w: matcheq.band_levels(w, sr)[0][-6:].mean()
    assert np.std([hi(w) for w in out]) < np.std([hi(w) for w in lines])
