"""Paths and the energy presets. Everything tunable about the voice lives here."""

from __future__ import annotations

from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
AUDIO_DIR = REPO / "audio"
VOICES_DIR = REPO / "assets" / "voices"
# The channel voice is Chatterbox's own built-in studio voice (conds.pt shipped with the
# weights). Decided 2026-11-27 after three blind rounds: clones of phone recordings scored
# 1/5, the built-in voice won every round (docs/PLAN.md section 5).
BUILTIN = "builtin"
DEFAULT_REFERENCE = BUILTIN
# Cloning still works: pass a .wav as `reference` (pnpm voice --reference clip.wav).
CLONE_REFERENCE = VOICES_DIR / "majed-reference-clip.wav"  # best ~10 s of a recording (scripts/prepare_reference.py)
EQ_CURVE = CLONE_REFERENCE.with_suffix(".eq.json")  # match-EQ for that clone (scripts/calibrate_eq.py)


def eq_curve_for(reference: Path) -> Path | None:
    """A cloned clip can carry its own match-EQ (<clip>.eq.json). The built-in voice needs none."""
    return reference.with_suffix(".eq.json") if reference.suffix == ".wav" else None

TTS_SR = 24_000  # Chatterbox output rate
ALIGN_SR = 16_000  # wav2vec2 input rate
MASTER_SR = 48_000  # rate of the mastered narration track (video audio is 48 kHz)

# Energy 1–5 → Chatterbox sampling controls (docs/PLAN.md section 5).
# The plan's defaults are 0.5 / 0.5 and its reveals use exaggeration ≥ 0.7 with
# cfg_weight ≈ 0.3. Measured on this voice (scripts/brightness.py), exaggeration
# makes the clone darker and less like the reference (spectral centroid 1000 Hz at
# 0.30 vs 650 Hz at 0.50; speaker similarity 0.88 vs 0.83) and, above ~0.6, garbles
# words. So the scale is shifted down and ≥ 0.7 is kept for energy 5 only.
# Original Chatterbox only: Turbo ignores exaggeration and cfg_weight.
ORIGINAL_PRESETS: dict[int, dict[str, float]] = {
    1: {"exaggeration": 0.25, "cfg_weight": 0.50},
    2: {"exaggeration": 0.30, "cfg_weight": 0.50},
    3: {"exaggeration": 0.40, "cfg_weight": 0.50},
    4: {"exaggeration": 0.55, "cfg_weight": 0.40},
    5: {"exaggeration": 0.70, "cfg_weight": 0.30},
}
# Turbo's only expressive knob is sampling temperature. A weak stand-in for
# energy (calmer lines sample closer to the mode); documented as such.
TURBO_PRESETS: dict[int, dict[str, float]] = {
    1: {"temperature": 0.60},
    2: {"temperature": 0.70},
    3: {"temperature": 0.80},
    4: {"temperature": 0.90},
    5: {"temperature": 1.00},
}

# Audio kept around a line after trimming Chatterbox's silence (seconds).
TRIM_LEAD = 0.06
TRIM_TAIL = 0.12
TRIM_THRESHOLD_DB = -45.0  # relative to the line's own peak
