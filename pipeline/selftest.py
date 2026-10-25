"""Weights-free checks for the parts that fail silently.

    python -m pipeline.selftest

Mirrors `--backend synthetic` in the Phase 0 harness: validate the machinery
without downloading a model or spending GPU time. Everything here is something
that would otherwise be discovered by watching a finished video and noticing
that it feels slightly wrong.

The cross-dissolve sync check is the reason this file exists. It renders real
segments through real ffmpeg from throwaway stills and asserts the output
length against the timeline, because an off-by-one-transition error produces a
video that plays perfectly and drifts a third of a second per cut.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

from . import assemble, config, docs, shots as shots_mod
from .timeline import Motion, ImageRecord, Shot, Timeline

FIXTURES = Path(__file__).resolve().parent / "fixtures"


class Checks:
    def __init__(self) -> None:
        self.failures: list[str] = []
        self.run = 0

    def check(self, label: str, condition: bool, detail: str = "") -> None:
        self.run += 1
        if condition:
            print(f"  pass  {label}")
        else:
            print(f"  FAIL  {label}{': ' + detail if detail else ''}")
            self.failures.append(label)

    def near(self, label: str, got: float, want: float, tol: float) -> None:
        self.check(label, abs(got - want) <= tol, f"got {got:.4f}, want {want:.4f} +/-{tol}")


def _fake_shots(durations: list[float], images: list[Path]) -> list[Shot]:
    shots: list[Shot] = []
    t = 0.0
    for i, d in enumerate(durations):
        shots.append(
            Shot(
                index=i, shot_id=f"S{i+1:02d}", beat_id=f"B{i+1:02d}",
                start=t, end=t + d, text="X", visual="v", mood="m",
                framing=None, cites=["c1"], prompt=f"prompt number {i}",
                seed=1000 + i,
                motion=Motion(kind="kenburns", zoom="in" if i % 2 else "out",
                              pan=("right", "up", "left", "down")[i % 4],
                              zoom_amount=config.KENBURNS_ZOOM),
                image=ImageRecord(hash=f"fake{i}", path=str(images[i % len(images)].name),
                                  prompt=f"prompt number {i}", seed=1000 + i, refs=[]),
            )
        )
        t += d
    return shots


def _timeline(shots: list[Shot], duration: float) -> Timeline:
    return Timeline(
        project="selftest", topic="t", target_duration=duration, duration=duration,
        audio={}, style={}, models={}, upstream={},
        render={"width": 640, "height": 360, "fps": config.FPS,
                "xfade": config.XFADE_SECONDS},
        shots=shots,
    )


def main() -> int:
    c = Checks()

    # ---------------------------------------------------------- fixtures
    print("\n-- fixtures and validators --")
    research = docs.parse_research(FIXTURES / "barbarians-01.research.md")
    script = docs.parse_script(FIXTURES / "barbarians-01.script.md")
    c.check("research parses", len(research.claims) == 8, f"{len(research.claims)} claims")
    c.check("script parses", len(script.beats) == 6, f"{len(script.beats)} beats")
    c.check("script validates clean", docs.validate_script(script, research).ok)
    c.check("fixture sources rejected by default",
            not docs.validate_research(research).ok)
    c.check("fixture sources allowed behind the flag",
            docs.validate_research(research, allow_fixture_sources=True).ok)

    bad = docs.parse_script(FIXTURES / "barbarians-01.script.md")
    bad.beats[0].cites = []
    c.check("uncited beat is rejected", not docs.validate_script(bad, research).ok)
    bad2 = docs.parse_script(FIXTURES / "barbarians-01.script.md")
    bad2.beats[1].cites = ["c99"]
    c.check("dangling citation is rejected", not docs.validate_script(bad2, research).ok)

    # --------------------------------------------------------- allocator
    print("\n-- shot allocation --")
    even = [10.0] * 6
    got = shots_mod.allocate(even, 10)
    # The shape matters, not the order: four beats get two shots and two get
    # one. Which beats is decided by the remainder order, and with identical
    # durations that is just input order, so asserting an exact list would be
    # asserting a tie-break rather than the behaviour.
    c.check("10 over 6 even beats spreads 4x2 + 2x1",
            sorted(got) == [1, 1, 2, 2, 2, 2], str(got))
    c.check("no beat is filled to its ceiling while another sits at the floor",
            max(got) - min(got) <= 1, str(got))
    for total in range(6, 19):
        got = shots_mod.allocate(even, total)
        c.check(f"allocation of {total} sums and stays in range",
                sum(got) == total and all(1 <= x <= 3 for x in got), str(got))
    skew = shots_mod.allocate([30.0, 5.0, 5.0, 5.0, 5.0, 30.0], 10)
    c.check("long beats get more shots", skew[0] == 3 and skew[-1] == 3, str(skew))

    # ------------------------------------------------- timeline validators
    print("\n-- timeline validation --")
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        stills = []
        rng = np.random.default_rng(7)
        for i in range(3):
            # Noise, so the Ken Burns move has edge content to actually show.
            arr = (rng.random((config.GEN_HEIGHT, config.GEN_WIDTH, 3)) * 255).astype("uint8")
            p = tmp / f"still{i}.png"
            Image.fromarray(arr).save(p)
            stills.append(p)

        good = _timeline(_fake_shots([5.0, 5.0, 5.0], stills), 15.0)
        errors, _ = good.validate()
        c.check("contiguous timeline validates", not errors, str(errors))

        gap = _timeline(_fake_shots([5.0, 5.0, 5.0], stills), 15.0)
        gap.shots[1].start += 0.5
        c.check("gap between shots is caught", any("gap" in e for e in gap.validate()[0]))

        short = _timeline(_fake_shots([5.0, 5.0, 5.0], stills), 16.0)
        c.check("timeline not covering the audio is caught",
                any("audio" in e for e in short.validate()[0]))

        dup = _timeline(_fake_shots([5.0, 5.0], stills), 10.0)
        dup.shots[1].prompt = dup.shots[0].prompt
        dup.shots[1].seed = dup.shots[0].seed
        c.check("duplicate prompt+seed is caught",
                any("same image" in e for e in dup.validate()[0]))

        sliver = _timeline(_fake_shots([config.XFADE_SECONDS, 5.0], stills),
                           config.XFADE_SECONDS + 5.0)
        c.check("shot shorter than the dissolve is caught",
                any("cross-dissolve" in e for e in sliver.validate()[0]))

        # -------------------------------------------- the sync arithmetic
        print("\n-- cross-dissolve sync (real ffmpeg, throwaway stills) --")
        ok, msg = assemble.preflight()
        if not ok:
            print(f"  SKIP  {msg}")
        else:
            for label, durations in [
                ("uniform", [4.0, 4.0, 4.0, 4.0]),
                ("ragged", [2.7, 6.3, 3.1, 5.9, 4.0]),
                ("single shot", [6.0]),
                ("two shots", [3.0, 3.0]),
            ]:
                total = sum(durations)
                tl = _timeline(_fake_shots(durations, stills), total)
                errs, _ = tl.validate()
                c.check(f"{label}: timeline valid", not errs, str(errs))

                paths = config.Paths(root=tmp / label.replace(" ", "_"), project="p")
                # render_segments resolves `paths.root / image.path`, and an
                # absolute second operand wins, which keeps the throwaway
                # stills out of the cache tree.
                for i, s in enumerate(tl.shots):
                    s.image.path = str(stills[i % len(stills)].resolve())

                segs = assemble.render_segments(tl, paths, log=lambda *a: None)
                for s, seg in zip(tl.shots, segs):
                    c.near(f"{label}: {s.shot_id} segment length",
                           assemble.probe_duration(seg), s.rendered_duration, 0.06)

                # A silent track of exactly the timeline length.
                wav = paths.run / "narration.wav"
                from .tts import _write_wav
                _write_wav(wav, np.zeros(int(total * 24000), dtype=np.float32), 24000)

                out = assemble.stitch(tl, segs, wav, paths.video, log=lambda *a: None)
                got = assemble.probe_duration(out)
                c.near(f"{label}: film length == sum of shot durations", got, total, 1.5 / config.FPS)

                naive = total - config.XFADE_SECONDS * (len(durations) - 1)
                if len(durations) > 1:
                    c.check(
                        f"{label}: not the uncompensated xfade length "
                        f"({naive:.2f}s)",
                        abs(got - naive) > 0.1,
                        f"got {got:.3f}s, which matches the un-compensated length",
                    )

    print(f"\n{c.run - len(c.failures)}/{c.run} checks passed")
    if c.failures:
        print("failed: " + ", ".join(c.failures))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
