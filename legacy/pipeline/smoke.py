"""The smoke test: the real models through the real production stage, small.

    python -m pipeline.smoke             # run, compare with the goldens
    python -m pipeline.smoke --strict    # ...and fail on any drift (the deploy gate)
    python -m pipeline.smoke --record    # run, and keep its output as the goldens

Failure mode 10 (PLAN.md section 5) is a dependency update that changes the
output without failing. `selftest` cannot see that, by design: it runs no
model. `pins` sees a changed package or weight file, but not a change outside
every lockfile: an ffmpeg that `brew upgrade` moved, a macOS update that
changed how Metal runs the same kernels. So this renders a film of its own
from scratch, about 20 seconds and three shots of the Phase 1 script, and
checks it two ways.

**Invariants** must hold on any machine with any versions: the narration gate
passes on good audio *and fires* when a word is cut out of it (the negative
control of `gatecheck`, on one word), every shot passes QA, the timeline is
contiguous, and every chunk lands on its exact frame. A failure here means
films made now would be wrong, so a worker that fails stops claiming GPU
work until a later run passes, and says so on its `workers` row, which the
studio shows.

**Drift** is a difference from the goldens recorded on this machine
(`fixtures/smoke.golden.json`): the narration's bytes, word timings beyond a
frame, a picture beyond `IMAGE_TOLERANCE` bits, a reroll that was not needed
before. Drift is not necessarily wrong, but it is never silent: the nightly
run reports it, and the deploy gate (`--strict`, in
`deploy/install-worker.sh`) refuses it until someone has looked at the film
in `<work root>/smoke/` and re-recorded.

Every run starts from an empty cache. A cache hit would test the cache.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from . import align, assemble, config, docs, pins, production, qa
from .timeline import file_sha

FIXTURES = Path(__file__).resolve().parent / "fixtures"
SCRIPT = FIXTURES / "smoke.script.md"
RESEARCH = FIXTURES / "barbarians-01.research.md"
GOLDEN = FIXTURES / "smoke.golden.json"

TARGET_SHOTS = 3

#: A word boundary may move this far from its golden before it is drift: one
#: frame, the resolution a shot boundary is placed at.
WORD_TOLERANCE = 1.0 / config.FPS

#: dHash bits a shot may differ from its golden. Same weights, seed and
#: prompt on the same machine measured 0 across repeated runs; two different
#: pictures of one scene sit at 12 or more (qa.SIMILAR_DISTANCE is 14).
IMAGE_TOLERANCE = 4

#: How often an idle GPU worker runs this, and how soon it tries again after
#: a failure (a failed run stops it claiming GPU work, so it should not wait a
#: day to find out it has recovered).
EVERY_SECONDS = 24 * 3600.0
RETRY_SECONDS = 3600.0


@dataclass
class Report:
    at: str
    seconds: float
    fake: bool
    failures: list[str] = field(default_factory=list)
    drift: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.failures

    def to_json(self) -> dict:
        return asdict(self) | {"ok": self.ok}

    @classmethod
    def from_json(cls, d: dict) -> "Report":
        return cls(at=d["at"], seconds=d["seconds"], fake=d.get("fake", False),
                   failures=d.get("failures", []), drift=d.get("drift", []), notes=d.get("notes", []))

    def age(self) -> float:
        return (datetime.now(timezone.utc) - datetime.fromisoformat(self.at)).total_seconds()

    def render(self) -> str:
        lines = ([f"  FAIL   {f}" for f in self.failures] + [f"  drift  {d}" for d in self.drift]
                 + [f"  note   {n}" for n in self.notes])
        verdict = "FAIL" if self.failures else ("drift" if self.drift else "ok")
        return "\n".join(lines + [f"  {verdict} in {self.seconds:.0f}s"])


def due(last: Report | None, *, every: float = EVERY_SECONDS, retry: float = RETRY_SECONDS) -> bool:
    if last is None:
        return True
    return last.age() >= (every if last.ok else retry)


def read_last(root: Path) -> Report | None:
    try:
        return Report.from_json(json.loads((root / "report.json").read_text()))
    except (OSError, ValueError, KeyError):
        return None


def run(engines: production.Engines, root: Path, *, fake: bool = False, deep: bool = True,
        log=print) -> tuple[Report, dict]:
    """-> (report, what was observed). `root` is emptied first and keeps the
    run's film, stills and narration afterwards, so a failure can be looked at."""
    t0 = time.time()
    report = Report(at=datetime.now(timezone.utc).isoformat(timespec="seconds"), seconds=0.0, fake=fake)
    observed: dict = {}

    def finish() -> tuple[Report, dict]:
        report.seconds = round(time.time() - t0, 1)
        root.mkdir(parents=True, exist_ok=True)
        (root / "report.json").write_text(json.dumps(report.to_json(), indent=2) + "\n")
        return report, observed

    # ------------------------------------------------------------ the pins
    p = pins.check(models=not fake, deep=deep)
    report.failures += p.problems
    report.notes += p.notes

    # ------------------------------------------------- the production stage
    shutil.rmtree(root, ignore_errors=True)
    paths = config.Paths(root=root, project="smoke")
    inputs = production.Inputs(
        project="smoke", topic="smoke test",
        research=docs.parse_research(RESEARCH), script=docs.parse_script(SCRIPT),
        style=config.PHASE1_STYLE, target_shots=TARGET_SHOTS, allow_fixture_sources=True,
        render_size=(640, 360) if fake else None,
    )
    quiet = (lambda *a, **k: None)
    try:
        result = production.run(inputs, paths, engines=engines, log=quiet,
                                stage_log=lambda t: log(f"  smoke: {t}"))
    except production.Gate as gate:
        report.failures.append(f"the {gate.stage} gate refused good input: " + "; ".join(gate.errors[:3]))
        return finish()
    except Exception as exc:  # noqa: BLE001 - a smoke test reports, it does not crash the worker
        report.failures.append(f"production failed: {type(exc).__name__}: {exc}")
        return finish()
    tl = result.timeline

    # ----------------------------------------------------------- invariants
    errors, _ = tl.validate()
    report.failures += [f"timeline: {e}" for e in errors]
    if result.stats and result.stats.cached:
        report.failures.append(f"{result.stats.cached} shot(s) came from a cache the run started without")
    for s in tl.shots:
        if not s.image.qa.get("ok"):
            report.failures.append(f"{s.shot_id} failed QA after {s.image.attempts} attempt(s): "
                                   + "; ".join(s.image.qa.get("failures", [])))

    hls = tl.media.get("hls") or {}
    chunks = hls.get("chunks") or []
    want_frames = round(tl.duration * config.FPS)
    if sum(c["frames"] for c in chunks) != want_frames:
        report.failures.append(f"chunks hold {sum(c['frames'] for c in chunks)} frames, "
                               f"the narration {want_frames}")
    start = 0
    for i, c in enumerate(chunks):
        path = paths.mirror.path(c["key"])
        got = assemble.count_frames(path)
        pts = assemble.first_pts(path)
        if got != c["frames"]:
            report.failures.append(f"chunk {i}: {got} frames, the timeline says {c['frames']}")
        if abs(pts - (assemble.TS_BASE + start / config.FPS)) > 1e-3:
            report.failures.append(f"chunk {i}: first frame at {pts:.4f}s, "
                                   f"want {assemble.TS_BASE + start / config.FPS:.4f}s")
        start += c["frames"]
    narration_stream = paths.mirror.path(hls["narration"]) if hls.get("narration") else None
    if narration_stream is None or not narration_stream.is_file():
        report.failures.append("no narration stream was written")
    elif abs(assemble.first_pts(narration_stream) - (assemble.TS_BASE - 1024 / 48000)) > 1e-3:
        report.failures.append("the narration stream does not start at the chunks' base time")

    alignment = align.Alignment.from_json(json.loads(paths.alignment.read_text()))
    if not fake:
        caught = negative_control(paths, alignment, engines)
        if caught is not True:
            report.failures.append(caught)

    # ----------------------------------------------------------- the goldens
    observed = {
        "narration": {"sha": file_sha(paths.audio), "duration": round(tl.duration, 4),
                      "words": [[w.word, round(w.start, 4), round(w.end, 4)] for w in alignment.words]},
        "shots": [{"shot_id": s.shot_id, "start": round(s.start, 4), "end": round(s.end, 4),
                   "phash": s.image.qa.get("phash"), "attempts": s.image.attempts} for s in tl.shots],
        "ffmpeg": pins.ffmpeg_version(),
        "weights": pins.models_record(),
    }
    if not fake:
        if GOLDEN.is_file():
            report.drift += compare(json.loads(GOLDEN.read_text()), observed)
        else:
            report.notes.append(f"no goldens yet: record them with `python -m pipeline.smoke --record`")
    return finish()


def negative_control(paths: config.Paths, alignment: align.Alignment, engines) -> bool | str:
    """Cut the longest word out of the first beat and re-run the gate: it must
    fire. The good-audio half of the control already ran: production passed
    the gate on the uncut narration."""
    from .gatecheck import _load, _rebuild, _splice_out

    beats, sr, data = _load(paths.run, SCRIPT)
    first = data["beats"][0]
    word = max((w for w in first["words"] if len(w["word"]) >= 5),
               key=lambda w: w["end"] - w["start"], default=None)
    if word is None:
        return "negative control: the first beat has no word long enough to cut"
    cut = _rebuild(_splice_out(beats, sr, first["beat_id"], word["start"], word["end"], first["start"]), sr)
    spliced = align.align_narration(cut, aligner=engines.aligner, log=lambda *a, **k: None)
    if not spliced.errors:
        return f"negative control: the narration gate did not notice {word['word']!r} cut from the audio"
    return True


def compare(golden: dict, observed: dict) -> list[str]:
    drift: list[str] = []
    g, o = golden["narration"], observed["narration"]
    if g["sha"] != o["sha"]:
        drift.append("the narration's bytes differ from the golden (Kokoro, torch or the voice moved)")
    if abs(g["duration"] - o["duration"]) > WORD_TOLERANCE:
        drift.append(f"narration is {o['duration']:.3f}s, golden {g['duration']:.3f}s")
    if [w[0] for w in g["words"]] != [w[0] for w in o["words"]]:
        drift.append("the aligner timed different words than the golden")
    else:
        moved = max((max(abs(a[1] - b[1]), abs(a[2] - b[2])) for a, b in zip(g["words"], o["words"])),
                    default=0.0)
        if moved > WORD_TOLERANCE:
            drift.append(f"a word boundary moved {moved * 1000:.0f} ms from the golden (tolerance one frame)")
    if [s["shot_id"] for s in golden["shots"]] != [s["shot_id"] for s in observed["shots"]]:
        drift.append(f"{len(observed['shots'])} shots, golden {len(golden['shots'])}")
    else:
        for gs, os_ in zip(golden["shots"], observed["shots"]):
            if abs(gs["start"] - os_["start"]) > WORD_TOLERANCE or abs(gs["end"] - os_["end"]) > WORD_TOLERANCE:
                drift.append(f"{os_['shot_id']} spans {os_['start']:.2f}-{os_['end']:.2f}s, "
                             f"golden {gs['start']:.2f}-{gs['end']:.2f}s")
            if gs["phash"] and os_["phash"]:
                d = qa.hamming(int(gs["phash"], 16), int(os_["phash"], 16))
                if d > IMAGE_TOLERANCE:
                    drift.append(f"{os_['shot_id']} is {d} bits from its golden picture "
                                 f"(tolerance {IMAGE_TOLERANCE})")
            if gs["attempts"] != os_["attempts"]:
                drift.append(f"{os_['shot_id']} took {os_['attempts']} attempt(s), golden {gs['attempts']}")
    if golden.get("ffmpeg") != observed.get("ffmpeg"):
        drift.append(f"ffmpeg {observed.get('ffmpeg')}, golden {golden.get('ffmpeg')}")
    return drift


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m pipeline.smoke", description=__doc__.split("\n")[0])
    ap.add_argument("--work-root", type=Path, default=Path("work"),
                    help="the run goes in <work root>/smoke, replaced each time")
    ap.add_argument("--record", action="store_true",
                    help="keep this run's output as the goldens (after looking at it)")
    ap.add_argument("--strict", action="store_true", help="drift fails the run (the deploy gate)")
    ap.add_argument("--fake", action="store_true", help="weights-free engines: invariants only")
    args = ap.parse_args(argv)

    if args.fake:
        from .fakes import fake_engines
        engines = fake_engines()
    else:
        import os
        # Only the pinned snapshots, never a download of `main` (pins.py).
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        engines = production.Engines()
    root = (args.work_root / "smoke").resolve()
    print(f"smoke test in {root}")
    report, observed = run(engines, root, fake=args.fake, log=print)
    print(report.render())
    if args.record and observed and report.ok and not args.fake:
        GOLDEN.write_text(json.dumps(observed | {
            "recorded_at": report.at, "seconds": report.seconds}, indent=2) + "\n")
        print(f"  recorded {GOLDEN.relative_to(pins.REPO)}")
    elif args.record:
        print("  not recorded: a failing or fake run is not a golden")
    return 0 if report.ok and not (args.strict and report.drift) else 1


if __name__ == "__main__":
    sys.exit(main())
