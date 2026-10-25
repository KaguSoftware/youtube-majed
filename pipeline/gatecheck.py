"""Negative control for the narration gate: does the alarm actually fire?

    python -m pipeline.gatecheck

`selftest.py` proves the gate stays quiet on good audio. That is only half a
test, and it is the half that cannot fail usefully. A check that never fires
passes it perfectly.

Phase 0 made this point once already, in PLAN.md 8.11: the consistency result
only became a finding when a control arm refuted the alternative explanation.
Without the control, a fixed seed and a detailed prompt explained the output
just as well. The same logic applies here — until a word is actually removed
and the gate is seen to catch it, "no errors" is equally consistent with a gate
that does nothing at all.

So this takes the real narration, splices individual words out of the audio,
and checks that the gate notices. The script is left untouched, which is
exactly the shape of failure mode 1: audio that no longer contains what the
script says, while every individual file still looks fine.

It also reports *which* words are caught. A gate that catches a dropped noun
but not a dropped "the" is still worth having, and knowing which is which is
better than a single pass/fail.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import align, config, docs
from .tts import BEAT_GAP_SECONDS, Narration, BeatAudio

FIXTURES = Path(__file__).resolve().parent / "fixtures"


@dataclass
class Trial:
    label: str
    beat_id: str
    word: str
    word_duration: float
    caught: bool
    reasons: list[str]


def _rebuild(beats: list[tuple[str, str, np.ndarray]], sample_rate: int) -> Narration:
    """Concatenate per-beat audio with the usual gaps, recomputing offsets.

    Removing a word shortens its beat and therefore shifts every beat after it.
    Rebuilding from the sample arrays rather than patching the timings keeps the
    index honest about the audio it actually describes.
    """
    gap = np.zeros(int(round(BEAT_GAP_SECONDS * sample_rate)), dtype=np.float32)
    index: list[BeatAudio] = []
    cursor = 0
    total: list[np.ndarray] = []
    for i, (beat_id, text, samples) in enumerate(beats):
        index.append(
            BeatAudio(
                beat_id=beat_id, text=text, samples=samples,
                start=cursor / sample_rate,
                end=(cursor + len(samples)) / sample_rate,
            )
        )
        total.append(samples)
        cursor += len(samples)
        if i < len(beats) - 1:
            total.append(gap)
            cursor += len(gap)
    duration = sum(len(x) for x in total) / sample_rate
    return Narration(path=Path("<spliced>"), sample_rate=sample_rate,
                     beats=index, duration=duration, voice="am_michael")


def _load(project_dir: Path, script_path: Path):
    """-> (beats as (id, text, samples), sample_rate, alignment json)."""
    wav = project_dir / "narration.wav"
    ali = project_dir / "alignment.json"
    for p in (wav, ali):
        if not p.exists():
            raise SystemExit(
                f"missing {p}. Run the slice first:\n"
                "  .venv/bin/python slice.py --allow-fixture-sources"
            )
    samples, sr = align.read_wav(wav)
    data = json.loads(ali.read_text())
    script = docs.parse_script(script_path)
    text_of = {b.beat_id: b.narration for b in script.beats}

    beats = []
    for b in data["beats"]:
        a, z = int(b["start"] * sr), int(b["end"] * sr)
        beats.append((b["beat_id"], text_of[b["beat_id"]], samples[a:z].copy()))
    return beats, sr, data


def _splice_out(beats, sr, beat_id: str, word_start: float, word_end: float, beat_start: float):
    """Remove one word's audio from one beat, leaving the script alone."""
    out = []
    for bid, text, samples in beats:
        if bid != beat_id:
            out.append((bid, text, samples))
            continue
        a = int(round((word_start - beat_start) * sr))
        z = int(round((word_end - beat_start) * sr))
        a, z = max(0, a), min(len(samples), z)
        out.append((bid, text, np.concatenate([samples[:a], samples[z:]])))
    return out


def main(argv: list[str] | None = None) -> int:
    argv = argv or sys.argv[1:]
    project_dir = Path(argv[0]) if argv else Path("work/barbarians-01")
    script_path = FIXTURES / "barbarians-01.script.md"

    beats, sr, data = _load(project_dir, script_path)
    aligner = align.CtcAligner()
    aligner.load()
    quiet = lambda *a, **k: None

    print(f"source: {project_dir}  ({len(beats)} beats, {sum(len(s) for _,_,s in beats)/sr:.2f}s)\n")

    # ---------------------------------------------------------- control
    print("-- control: untouched audio, the gate must stay quiet --")
    base = align.align_narration(_rebuild(beats, sr), aligner=aligner, log=quiet)
    control_ok = not base.errors
    print(f"  errors: {base.errors or 'none'}")
    print(f"  overall WER {base.overall_wer:.1%}")
    print(f"  {'pass' if control_ok else 'FAIL'}  the gate does not fire on good audio\n")

    # ------------------------------------------------------------ trials
    # One short function word and one long content word per beat, so the
    # report says something about *what* gets caught rather than just whether
    # anything does.
    by_id = {b["beat_id"]: b for b in data["beats"]}
    picks: list[tuple[str, str, dict]] = []
    for b in data["beats"]:
        words = [w for w in b["words"] if w["end"] > w["start"]]
        if not words:
            continue
        longest = max(words, key=lambda w: w["end"] - w["start"])
        shortest = min(words, key=lambda w: w["end"] - w["start"])
        picks.append(("longest word", b["beat_id"], longest))
        if shortest is not longest:
            picks.append(("shortest word", b["beat_id"], shortest))

    print(f"-- {len(picks)} trials: remove one word's audio, leave the script alone --")
    print(f"{'beat':>5}  {'word':<12} {'dur':>6}  {'kind':<14} verdict")
    trials: list[Trial] = []
    for label, beat_id, w in picks:
        spliced = _splice_out(
            beats, sr, beat_id, w["start"], w["end"], by_id[beat_id]["start"]
        )
        result = align.align_narration(_rebuild(spliced, sr), aligner=aligner, log=quiet)
        mine = [e for e in result.errors if e.startswith(beat_id)]
        caught = bool(mine)
        reasons = []
        for e in mine:
            if "occupy no audio" in e:
                reasons.append("zero-length")
            elif "absent from the narration" in e:
                reasons.append("deletion")
            elif "WER" in e:
                reasons.append("WER")
            else:
                reasons.append("other")
        trials.append(Trial(label, beat_id, w["word"], w["end"] - w["start"],
                            caught, sorted(set(reasons))))
        print(f"{beat_id:>5}  {w['word']:<12} {w['end']-w['start']:5.3f}s  {label:<14} "
              f"{'CAUGHT by ' + '+'.join(sorted(set(reasons))) if caught else 'missed'}")

    caught = [t for t in trials if t.caught]
    missed = [t for t in trials if not t.caught]
    print(f"\n{len(caught)}/{len(trials)} dropped words caught")

    if missed:
        print("\nmissed:")
        for t in missed:
            print(f"  {t.beat_id} {t.word!r} ({t.word_duration:.3f}s)")

    which: dict[str, int] = {}
    for t in caught:
        for r in t.reasons:
            which[r] = which.get(r, 0) + 1
    if which:
        print("\ncaught by: " + ", ".join(f"{k} x{v}" for k, v in sorted(which.items())))

    # The gate's whole purpose is the content words. A dropped article is a
    # blemish; a dropped noun changes what the video claims.
    content = [t for t in trials if t.label == "longest word"]
    content_caught = [t for t in content if t.caught]
    print(f"\ncontent words (longest per beat): {len(content_caught)}/{len(content)} caught")

    ok = control_ok and len(content_caught) == len(content)
    print("\n" + ("PASS — quiet on good audio, fires on every dropped content word"
                  if ok else "REVIEW — see above"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
