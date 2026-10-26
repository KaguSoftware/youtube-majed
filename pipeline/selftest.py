"""Weights-free checks for the parts that fail silently.

    python -m pipeline.selftest

Mirrors `--backend synthetic` in the Phase 0 harness: validate the machinery
without downloading a model or spending GPU time. Everything here is something
that would otherwise be discovered by watching a finished video and noticing
that it feels slightly wrong.

The cross-dissolve sync check is the reason this file exists. It renders real
segments and chunks through real ffmpeg from throwaway stills and asserts the
output length and every chunk's timestamps against the timeline, because an
off-by-one-transition error produces a video that plays perfectly and drifts
a third of a second per cut.
"""

from __future__ import annotations

import re
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


def _first_pts(path: Path) -> float:
    """Presentation time of the first frame or sample in a stream file."""
    import subprocess
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "packet=pts_time",
                          "-of", "csv=p=0", str(path)], capture_output=True, text=True).stdout
    return min(float(x.strip(",")) for x in out.split() if x.strip(","))


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

                rendered = assemble.build(tl, paths, audio=wav, log=lambda *a: None)
                got = assemble.probe_duration(rendered.video)
                c.near(f"{label}: film length == sum of shot durations", got, total, 1.5 / config.FPS)

                naive = total - config.XFADE_SECONDS * (len(durations) - 1)
                if len(durations) > 1:
                    c.check(
                        f"{label}: not the uncompensated xfade length "
                        f"({naive:.2f}s)",
                        abs(got - naive) > 0.1,
                        f"got {got:.3f}s, which matches the un-compensated length",
                    )
                frames = [ch.frames for ch, _ in rendered.chunks]
                c.check(f"{label}: chunks tile the film in whole frames",
                        sum(frames) == round(total * config.FPS)
                        and all(assemble.count_frames(p) == ch.frames for ch, p in rendered.chunks),
                        f"{frames} vs {round(total * config.FPS)}")
                firsts = [_first_pts(p) for _, p in rendered.chunks]
                want = [assemble.TS_BASE + ch.start / config.FPS for ch, _ in rendered.chunks]
                c.check(f"{label}: each chunk is stamped with its own film time",
                        all(abs(a - b) < 1e-3 for a, b in zip(firsts, want)), f"{firsts} vs {want}")

            # The property the editing page rests on: change one shot and only
            # its chunk and the one dissolving into it are encoded again.
            print("\n-- an edit re-encodes two chunks, not the film --")
            tl = _timeline(_fake_shots([3.0, 3.5, 2.8, 3.2], stills), 12.5)
            paths = config.Paths(root=tmp / "edit", project="p")
            for i, s in enumerate(tl.shots):
                s.image.path = str(stills[i % len(stills)].resolve())
            wav = paths.run / "narration.wav"
            from .tts import _write_wav
            _write_wav(wav, np.zeros(int(12.5 * 24000), dtype=np.float32), 24000)
            before = assemble.build(tl, paths, audio=wav, log=lambda *a: None)
            tl.shots[2].image.hash, tl.shots[2].image.path = "fake-new", str(stills[0].resolve())
            seen: list[str] = []
            after = assemble.render_chunks(tl, paths, log=seen.append)
            changed = [ch.index for (ch, _), (old, _) in zip(after, before.chunks) if ch.hash != old.hash]
            c.check("a new still in shot 3 changes chunks 2 and 3 only", changed == [1, 2], str(changed))
            c.check("and only those two are encoded", any("2 encoded, 2 unchanged" in m for m in seen), str(seen))
            c.check("the narration stream is shared by every version",
                    assemble.narration_stream(tl, wav, paths)[0] == before.narration)
            c.near("narration stream starts at the base", _first_pts(before.narration),
                   assemble.TS_BASE - 1024 / 48000, 1e-3)
            import json as _json
            slices = _json.loads(before.narration_index.read_text())
            c.check("narration slices cover the file and the film",
                    sum(x[1] for x in slices) == before.narration.stat().st_size
                    and abs(sum(x[0] for x in slices) - 12.5) < 0.05, str(slices))

    print("\n-- edits: the operations the edit agent's tools apply --")
    from . import edits

    c.check("timecodes read as seconds", [edits.parse_timecode(x) for x in ("84", "1:24", "1:24.5", "0:01:02")]
            == [84.0, 84.0, 84.5, 62.0])

    def worded(durations):
        shots = _fake_shots(durations, [Path("x.png")])
        for sh in shots:  # four words a shot, evenly spread
            span = sh.duration / 4
            sh.words = [{"word": f"W{sh.index}{k}", "start": sh.start + k * span,
                         "end": sh.start + (k + 0.8) * span, "score": 1.0} for k in range(4)]
            sh.text = " ".join(w["word"] for w in sh.words)
        return _timeline(shots, sum(durations))

    def session(durations):
        return edits.Session(worded(durations), lambda v, m, f: f"{v}|{m}|{f}")

    e = session([8.0, 8.0, 8.0])
    e.set_shot_mood("S02", "cold dawn")
    c.check("a mood change marks one shot for repainting, with a rebuilt prompt",
            [x.shot_id for x in e.pending()] == ["S02"] and e.timeline.shots[1].prompt == "v|cold dawn|None")
    e = session([8.0, 8.0, 8.0])
    e.nudge_shot_boundary("S02", "start", 1.0)
    a, b = e.timeline.shots[0], e.timeline.shots[1]
    c.check("a nudged cut lands after a word and moves that word with it",
            a.end == b.start and any(abs(a.end - w["end"]) < 1e-9 for w in a.words)
            and len(a.words) == 5 and len(b.words) == 3 and not e.pending(), f"{a.end} {len(a.words)}")
    e = session([8.0, 8.0, 8.0])
    e.split_shot("S02")
    sh = e.timeline.shots
    c.check("a split makes two shots tiling the old one, the second to be painted",
            len(sh) == 4 and sh[1].end == sh[2].start and sh[1].start == 8.0 and sh[2].end == 16.0
            and [x.shot_id for x in e.pending()] == ["S03"] and sh[3].shot_id == "S04"
            and not e.timeline.validate()[0])
    e.merge_shots("S02", keep="first")
    c.check("a merge undoes it, keeping the first picture",
            len(e.timeline.shots) == 3 and e.timeline.shots[1].end == 16.0
            and len(e.timeline.shots[1].words) == 4 and not e.timeline.validate()[0])
    e = session([2.05, 8.0, 8.0])   # no word ends after 2 s in S01
    before = [(x.start, x.end) for x in e.timeline.shots]
    try:
        e.nudge_shot_boundary("S02", "start", -1.0)
        refused = False
    except edits.EditError:
        refused = True
    c.check("a nudge that would leave a shot under 2 s is refused, and nothing changes",
            refused and [(x.start, x.end) for x in e.timeline.shots] == before and not e.ops)
    try:
        e.edit_shot_image("S09", "x")
        refused = False
    except edits.EditError as exc:
        refused = "S01-S03" in str(exc)
    c.check("an unknown shot is refused with the shots that exist", refused)

    print("\n-- docs.check: the one entry point both slot modes share --")
    r_text = (FIXTURES / "barbarians-01.research.md").read_text()
    s_text = (FIXTURES / "barbarians-01.script.md").read_text()
    v = docs.check("script", s_text, research_markdown=r_text)
    c.check("a clean script is `valid` with its beats parsed",
            v["doc_status"] == "valid" and len(v["parsed"]["beats"]) == 6, str(v["errors"]))
    c.check("fixture research is `invalid` unless fixture sources are allowed",
            docs.check("research", r_text)["doc_status"] == "invalid"
            and docs.check("research", r_text, allow_fixture_sources=True)["doc_status"] == "valid")
    bad = docs.check("script", "### B01 - x\nnarration: [unclosed")
    c.check("malformed YAML is `invalid` with the parse error, not an exception",
            bad["doc_status"] == "invalid" and "not valid YAML" in bad["errors"][0]
            and bad["parsed"] is None)
    c.check("a script checked without research says it could not check cites",
            any("cites" in w for w in docs.check("script", s_text)["warnings"]))

    print("\n-- media: local, then the store, then generate --")
    from . import media

    class Idx:
        def __init__(self):
            self.sizes = {}

        def size(self, key):
            return self.sizes.get(key)

        def known(self, key):
            return key in self.sizes

        def record(self, key, *, size, kind):
            self.sizes[key] = size

    class Counting(media.DirRemote):
        gets = 0

        def get(self, key, dest):
            Counting.gets += 1
            return super().get(key, dest)

    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        remote, idx = Counting(td / "store"), Idx()
        a = media.Mirror(td / "a", remote, idx)
        img = td / "a" / "images" / "abc.png"
        img.parent.mkdir(parents=True)
        img.write_bytes(b"\x89PNG fake bytes")
        c.check("publish uploads and indexes", a.publish(img, "image") == "images/abc.png"
                and (td / "store" / "images" / "abc.png").is_file() and idx.known("images/abc.png"))
        b = media.Mirror(td / "b", remote, idx)
        c.check("another disk fetches it", b.ensure(td / "b" / "images" / "abc.png")
                and (td / "b" / "images" / "abc.png").read_bytes() == img.read_bytes())
        before = Counting.gets
        c.check("a key the index does not know is never asked for",
                not b.ensure(td / "b" / "images" / "new.png") and Counting.gets == before)
        (td / "store" / "images" / "abc.png").write_bytes(b"\x89PNG fa")   # truncated in the store
        c2 = media.Mirror(td / "c", remote, idx)
        try:
            c2.ensure(td / "c" / "images" / "abc.png")
            c.check("a short download is refused, not cached", False)
        except RuntimeError as exc:
            c.check("a short download is refused, not cached",
                    "recorded" in str(exc) and not (td / "c" / "images" / "abc.png").exists())
        c.check("no store means local only", not media.Mirror(td / "d").ensure(td / "d" / "x.png"))

    c.check("a tone beat's sentence-initial capitals are not mistaken for proper nouns",
            docs.fact_markers("Rain on stone. Wind off the moor. Behind the rampart, a fire.") == [])
    c.check("...while real names and numbers inside a sentence still are",
            docs.fact_markers("Rain falls on Vindolanda in 1915.") == ["Vindolanda", "1915"])

    st = config.Style("s", "p", "oil,", 1, Path(), Path(), (0, 0, 1, 1))
    pr = st.prompt_for("a room, Victor kneels, Victor rests", "dim", period="Roman Britain",
                       protagonist=("Victor", "a Roman auxiliary in a mail shirt"))
    c.check("the protagonist's period look is spliced in after their first mention, once",
            pr == "oil, Roman Britain, a room, Victor, a Roman auxiliary in a mail shirt, kneels, Victor rests, "
                  "dim, all of it as oil", pr)
    poss = st.prompt_for("the farmer's hands", "dim", protagonist=("the farmer", "a lean man,"))
    c.check("a possessive mention gets the description after the visual, not a broken splice",
            poss == "oil, the farmer's hands, the farmer: a lean man, dim, all of it as oil", poss)
    c.check("the style is restated last, so a long prompt cannot outvote it",
            st.prompt_for("a room", "dim").endswith("all of it as oil"))
    c.check("an instruction becomes a description (the model takes no orders)",
            config.style_text("make it stick figure doodles,") == "stick figure doodles")

    s_period = docs.parse_script_text("---\ntarget_duration: 10\nperiod: Roman Britain, the fort at Vindolanda\n"
                                      "protagonist: V\nprotagonist_look: a man\n---\n### B01 - x\nnarration: |\n"
                                      "  one two three four five six seven eight nine ten eleven twelve thirteen\n"
                                      "visual: V stands\nmood: m\ntone: true\n")
    c.check("a period line naming a fort is warned about (the castle effect)",
            any("castle" in w for w in docs.validate_script(s_period).warnings))

    from .align import deletions
    c.check("an ASR word merge is not a dropped word (SOUTH SHIELDS heard as SOUTHSHIELDS)",
            deletions("ROSE AT SOUTH SHIELDS", "ROS AT SOUTHSHIELDS") == ([], ["SOUTH+SHIELDS"]))
    c.check("...while a word with no trace anywhere still is",
            deletions("THE CATTLE BYRED BEHIND", "THE CATTLE BEHIND") == (["BYRED"], []))

    from .align import effective_wer
    c.check("names the recogniser spells by ear do not fail the WER backstop (Aztec B21)",
            effective_wer("TENOCHTITLAN JOINED TEXCOCO AND TLACOPAN IN A TRIPLE ALLIANCE",
                          "TENACHTET LAN JOIND TEXCOCO AND TE LACAPAN IN A TRIPLE ALLIANCE")[0] == 0.0)
    c.check("...a merge by sound is not a dropped word (CAN SEAL heard as CONCEAL)",
            deletions("THE HILL CAN SEAL AN ALLIANCE", "THE HILL CONCEAL AND ALLIANCE")[0] == [])
    c.check("...and a long word heard as a scrap counts as dropped (EVENINGS heard as ETN)",
            deletions("A WINTER OF EVENINGS", "A WINTER OF ETN")[0] == ["EVENINGS (heard only 'ETN')"])
    c.check("...but a split is not a scrap (MODII heard as MODI I)",
            deletions("NINE MODII OF WHEAT", "NINE MODI I OF WHEAT")[0] == [])
    c.check("...while dropped words still count in full",
            effective_wer("THE CATTLE BYRED BEHIND A PARTITION", "THE CATTLE BEHIND")[0] >= 0.5)

    from .timeline import Timeline as _TL
    rt = _timeline(_fake_shots([2.0, 3.0], [Path("a.png")]), 5.0)
    c.check("a timeline survives a round trip through JSON (Postgres) unchanged",
            _TL.from_json(rt.to_json()).to_json() == rt.to_json())

    print("\n-- writer: what Claude is asked, and what is kept of its reply --")
    from . import writer

    doc = "---\nproject: x\n---\n\n## Claims\n\n### c1\nclaim: a\nsource: https://e.org\n"
    reply = f"Here is the research.\n\n```markdown\n{doc}```\n\nSources: [e](https://e.org)"
    c.check("the document is taken from its fence, without the chatter around it",
            writer.extract_document(reply) == doc)
    c.check("an unfenced reply is kept from its front matter on",
            writer.extract_document("Sure.\n---\nproject: x\n---\nbody") .startswith("---\nproject: x"))
    project = {"id": "p", "topic": "Rations on Hadrian's Wall", "angle": "not battles", "target_duration": 180}
    system, prompt = writer.script_prompt(project, doc)
    c.check("the script prompt budgets words at the validator's own rate (150 wpm)",
            "450 words" in prompt and "Period-accurate" in system)
    system, prompt = writer.research_prompt(project, note="more on bread")
    c.check("the research prompt carries the topic, angle and reviewer's note",
            "Rations on Hadrian's Wall" in prompt and "not battles" in prompt and "more on bread" in prompt
            and "Never cite a URL you did not open" in system)
    _, prompt = writer.script_prompt(project | {"narrative": "mystery"}, doc)
    c.check("the film's chosen narrative is carried into the script prompt and its front matter",
            writer.NARRATIVES["mystery"].script in prompt and "narrative: mystery" in prompt)
    _, prompt = writer.research_prompt(project | {"narrative": "mystery"})
    c.check("...and into the research prompt", writer.NARRATIVES["mystery"].research in prompt)
    c.check("a film from before narratives is written as the default",
            writer.NARRATIVES[writer.DEFAULT_NARRATIVE].script in writer.script_prompt(project, doc)[1])
    try:
        writer.script_prompt(project | {"narrative": "sonnet"}, doc)
        c.check("an unknown narrative is refused", False)
    except ValueError:
        c.check("an unknown narrative is refused", True)
    ts = (Path(__file__).resolve().parent.parent / "web" / "lib" / "narratives.ts").read_text()
    c.check("the studio's narrative picker offers exactly writer.NARRATIVES",
            re.findall(r'id: "(\w+)"', ts) == list(writer.NARRATIVES), str(re.findall(r'id: "(\w+)"', ts)))
    told = docs.check("script", "---\nproject: x\nperiod: Roman Britain\nprotagonist: Victor\n"
                      "protagonist_look: a man\n---\n### B01 - x\nnarration: |\n  The wind finds Victor.\n"
                      "visual: Victor on a turf rampart\nmood: cold\ntone: true\n")
    c.check("a tone beat may name the protagonist without being flagged as asserting a fact",
            not any("asserts" in w for w in told["warnings"]), str(told["warnings"]))

    print(f"\n{c.run - len(c.failures)}/{c.run} checks passed")
    if c.failures:
        print("failed: " + ", ".join(c.failures))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
