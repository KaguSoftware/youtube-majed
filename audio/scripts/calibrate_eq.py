"""Measure the match-EQ curve: cleaned reference speech vs the (line-balanced) takes of a voiced project.

    uv run python scripts/calibrate_eq.py [projects/lighthouse/audio]

Writes assets/voices/majed-reference-clip.eq.json next to the reference clip; mastering uses it automatically.
"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from studio_audio import config, matcheq

d = Path(sys.argv[1]) if len(sys.argv) > 1 else config.REPO / "projects" / "lighthouse" / "audio"
v = json.loads((d / "voice.json").read_text())
takes = [d / l["file"] for l in v["lines"]]
curve = matcheq.calibrate(config.VOICES_DIR / "majed-reference-clean.wav", takes)
config.EQ_CURVE.write_text(json.dumps(curve, indent=2))
print(f"{len(takes)} takes -> {config.EQ_CURVE}")
for hz, g in zip(curve["hz"], curve["gainDb"]): print(f"  {hz:7.0f} Hz  {g:+5.1f} dB")
