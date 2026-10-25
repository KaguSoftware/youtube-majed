"""The Phase 1 vertical slice: one command, topic to out.mp4.

    python slice.py

Stage order is the load-bearing part, and it is the order in PLAN.md section 4:
every cheap stage completes before the expensive one starts. Validation, then
narration, then alignment and its gates, then the timeline, and only then do we
spend fifteen seconds an image. A script that fails its validator costs a
second; one that fails after image generation costs the whole run.

    validate -> tts -> align (+ WER gate) -> plan -> timeline -> images -> render

No database, no queue, no UI, no network beyond model weights. The stages
themselves live in `production.py`, shared with the Phase 2 worker, so the
slice and a queued job run identical code; this file is only the CLI around
them.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from . import config, docs, images, production

FIXTURES = Path(__file__).resolve().parent / "fixtures"


#: What to tell a CLI user when a gate stops the run.
GATE_HINTS = {
    "validate": "Fix the artifact, or pass --force to promote anyway (DESIGN.md allows "
                "the override, but it should take a click).",
    "narration": "Narration does not match the script. This is failure mode 1 and it "
                 "fails the job by design — every timestamp downstream would be wrong. "
                 "Pass --force only if you have listened to the audio.",
    "plan": "The timeline is not renderable; see the errors above.",
}


class Stage:
    """Console structure. A fifteen-minute run needs to be readable."""

    def __init__(self) -> None:
        self.t0 = time.time()
        self.marks: list[tuple[str, float]] = []

    def __call__(self, title: str) -> None:
        now = time.time()
        if self.marks:
            print(f"   ... {self.marks[-1][0]} took {now - self.marks[-1][1]:.1f}s\n")
        self.marks.append((title, now))
        print(f"== {title} " + "=" * max(0, 58 - len(title)))

    def done(self) -> None:
        now = time.time()
        if self.marks:
            print(f"   ... {self.marks[-1][0]} took {now - self.marks[-1][1]:.1f}s")
        print(f"\ntotal {now - self.t0:.1f}s")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="slice.py",
        description="Phase 1 vertical slice: hardcoded topic and style, "
                    "10 shots, ~60s, no DB and no UI.",
    )
    ap.add_argument("--topic", default=None,
                    help="recorded on the timeline; the script is the fixture, so this "
                         "does not change what is narrated (Phase 1 is hardcoded)")
    ap.add_argument("--script", type=Path, default=FIXTURES / "barbarians-01.script.md")
    ap.add_argument("--research", type=Path, default=FIXTURES / "barbarians-01.research.md")
    ap.add_argument("--out", type=Path, default=Path("work"))
    ap.add_argument("--shots", type=int, default=config.TARGET_SHOTS)
    ap.add_argument("--allow-fixture-sources", action="store_true",
                    help="accept the FIXTURE source sentinel in research.md")
    ap.add_argument("--force", action="store_true",
                    help="promote past validator errors, printing what is overridden "
                         "(the CLI equivalent of DESIGN.md's `promote anyway`)")
    ap.add_argument("--max-wer", type=float, default=config.MAX_WER)
    ap.add_argument("--skip-render", action="store_true",
                    help="stop after the timeline; useful for checking the plan "
                         "before spending the GPU budget")
    ap.add_argument("--dry-run", action="store_true",
                    help="validate and print the plan, generate nothing")
    args = ap.parse_args(argv)

    stage = Stage()

    inputs = production.Inputs(
        project="",
        topic=args.topic or "",
        research=docs.parse_research(args.research),
        script=docs.parse_script(args.script),
        style=config.PHASE1_STYLE,
        target_shots=args.shots,
        allow_fixture_sources=args.allow_fixture_sources,
        force=args.force,
        max_wer=args.max_wer,
    )
    inputs.project = inputs.script.meta.get("project", "slice")
    inputs.topic = inputs.topic or inputs.research.meta.get("topic", "")
    paths = config.Paths(root=args.out, project=inputs.project)

    try:
        if args.dry_run:
            stage("validate")
            production.validate(inputs)
            print(f"\n  dry run: {images.eta(args.shots)}")
            stage.done()
            return 0

        result = production.run(
            inputs, paths, engines=production.Engines(),
            stop_after="plan" if args.skip_render else None, stage_log=stage,
        )
    except production.Gate as gate:
        print(f"\n{gate.stage} failed:", file=sys.stderr)
        for e in gate.errors:
            print(f"  {e}", file=sys.stderr)
        print(GATE_HINTS.get(gate.stage, ""), file=sys.stderr)
        return 1

    timeline = result.timeline
    if args.skip_render:
        print(f"\n  --skip-render: stopping before image generation "
              f"({images.eta(len(timeline.shots))})")
        stage.done()
        return 0

    stage.done()
    print(f"\nvideo    {result.video}")
    print(f"timeline {paths.timeline}")
    print(f"audio    {paths.audio}")
    if result.stats and result.stats.flagged:
        print(f"\nQA flagged {result.stats.flagged} — look at those frames before trusting the run.")
    return 0
