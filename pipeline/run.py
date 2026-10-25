"""The Phase 1 vertical slice: one command, topic to out.mp4.

    python slice.py

Stage order is the load-bearing part, and it is the order in PLAN.md section 4:
every cheap stage completes before the expensive one starts. Validation, then
narration, then alignment and its gates, then the timeline, and only then do we
spend fifteen seconds an image. A script that fails its validator costs a
second; one that fails after image generation costs the whole run.

    validate -> tts -> align (+ WER gate) -> plan -> timeline -> images -> render

No database, no queue, no UI, no network beyond model weights. Phase 2 keeps
every module here and replaces only this file's orchestration with a job claim
and a heartbeat — which is why the stages take explicit artifacts and return
explicit artifacts rather than sharing mutable state.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from . import align, assemble, config, docs, images, shots as shots_mod, tts
from .timeline import Timeline, upstream_hashes

FIXTURES = Path(__file__).resolve().parent / "fixtures"


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

    # ---------------------------------------------------------- validate
    stage("validate")
    research = docs.parse_research(args.research)
    script = docs.parse_script(args.script)
    print(f"  {args.research.name}: {len(research.claims)} claims")
    print(f"  {args.script.name}: {len(script.beats)} beats, "
          f"{len(script.narration.split())} words, target {script.target_duration:.0f}s")

    reports = {
        "research.md": docs.validate_research(
            research, allow_fixture_sources=args.allow_fixture_sources
        ),
        "script.md": docs.validate_script(script, research),
    }
    failed = False
    for name, report in reports.items():
        print(f"  {name}:")
        print(report.render())
        failed = failed or not report.ok
    if failed:
        if not args.force:
            print("\nvalidation failed. Fix the artifact, or pass --force to promote "
                  "anyway (DESIGN.md allows the override, but it should take a click).",
                  file=sys.stderr)
            return 1
        print("\n  --force: promoting past the errors above")

    style = config.PHASE1_STYLE
    for ref in (style.hero_full, style.hero_crop):
        if not ref.exists():
            print(f"missing style reference {ref}", file=sys.stderr)
            return 1
    print(f"  style {style.style_id} ({style.preset}), seed {style.seed}, "
          f"reference {style.hero_crop.name}")

    paths = config.Paths(root=args.out, project=script.meta.get("project", "slice"))

    if args.dry_run:
        print(f"\n  dry run: {images.eta(args.shots)}")
        stage.done()
        return 0

    # --------------------------------------------------------------- tts
    stage("narrate (kokoro-82m)")
    narration = tts.synthesize(
        script.beats, paths.audio, voice_id=script.meta.get("voice", "narrator_male_low")
    )

    # ------------------------------------------------------------- align
    stage(f"align + ASR gate ({config.ALIGN_MODEL})")
    alignment = align.align_narration(narration, max_wer=args.max_wer)
    align.write_alignment(alignment, paths.alignment)
    print(f"  overall WER {alignment.overall_wer:.1%} "
          f"(gate {args.max_wer:.0%}), {len(alignment.words)} words timed")
    if alignment.errors:
        for e in alignment.errors:
            print(f"  ERROR  {e}")
        if not args.force:
            # Failure mode 1 is non-negotiable in PLAN.md section 5: audio that
            # does not match the script makes every downstream timestamp wrong
            # while the video still looks fine.
            print("\nnarration does not match the script. This is failure mode 1 and "
                  "it fails the job by design — every timestamp downstream would be "
                  "wrong. Pass --force only if you have listened to the audio.",
                  file=sys.stderr)
            return 1
        print("  --force: continuing despite the narration gate")

    # -------------------------------------------------------------- plan
    stage("plan shots")
    shot_list = shots_mod.plan(
        script.beats, alignment, style,
        target_shots=args.shots, audio_duration=narration.duration,
    )

    timeline = Timeline(
        project=paths.project,
        topic=args.topic or research.meta.get("topic", ""),
        target_duration=script.target_duration,
        duration=narration.duration,
        audio={
            "path": paths.audio.name,
            "sample_rate": narration.sample_rate,
            "duration": round(narration.duration, 4),
            "voice": narration.voice,
            "engine": tts.KokoroTTS.name,
            "overall_wer": round(alignment.overall_wer, 4),
        },
        style={
            "style_id": style.style_id,
            "preset": style.preset,
            "prompt_prefix": style.prompt_prefix,
            "seed": style.seed,
            "hero_full": str(style.hero_full.name),
            "hero_crop": str(style.hero_crop.name),
            "crop_box": list(style.crop_box),
        },
        render={
            "width": config.OUT_WIDTH, "height": config.OUT_HEIGHT,
            "fps": config.FPS, "xfade": config.XFADE_SECONDS,
        },
        models={
            "image": {
                "name": config.IMAGE_MODEL, "base": config.IMAGE_BASE_MODEL,
                "steps": config.GEN_STEPS, "guidance": config.GEN_GUIDANCE,
                "width": config.GEN_WIDTH, "height": config.GEN_HEIGHT,
                "licence": "apache-2.0",
            },
            "tts": {"name": "hexgrad/Kokoro-82M", "licence": "apache-2.0"},
            "align": {"name": config.ALIGN_MODEL, "licence": "apache-2.0"},
        },
        upstream=upstream_hashes(args.script, args.research, style),
        shots=shot_list,
    )

    timeline.write(paths.timeline)          # write() re-validates as it serializes
    errors = timeline.validation["errors"]
    for w in timeline.validation["warnings"]:
        print(f"  warn   {w}")
    for e in errors:
        print(f"  ERROR  {e}")
    print(f"  wrote {paths.timeline}")
    if errors:
        print("\ntimeline is not renderable; see the errors above.", file=sys.stderr)
        return 1

    if args.skip_render:
        print(f"\n  --skip-render: stopping before image generation ({images.eta(len(shot_list))})")
        stage.done()
        return 0

    # ------------------------------------------------------------ images
    stage(f"generate images ({images.eta(len(shot_list))})")
    stats = images.generate_shots(shot_list, style, paths)
    print(f"  {stats.summary()}")
    timeline.write(paths.timeline)
    if stats.flagged:
        print(f"  warn   QA flagged {stats.flagged} after {images.MAX_ATTEMPTS} attempts")

    # ------------------------------------------------------------ render
    stage("render")
    video = assemble.build(timeline, paths)
    timeline.write(paths.timeline)

    stage.done()
    print(f"\nvideo    {video}")
    print(f"timeline {paths.timeline}")
    print(f"audio    {paths.audio}")
    if stats.flagged:
        print(f"\nQA flagged {stats.flagged} — look at those frames before trusting the run.")
    return 0
