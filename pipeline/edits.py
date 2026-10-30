"""Edits to a timeline: what the edit agent's tools do.

The timeline is the artifact and the film is a render of it (DESIGN.md), so
an edit never touches pixels or audio here. It changes fields on a draft copy
of the timeline and marks the shots that must be painted again; the worker
paints them afterwards and re-cuts only the chunks they touch
(pipeline/editor.py).

Every operation either leaves the draft renderable or changes nothing and
raises `EditError` with a message written for the agent to act on: which
limit it hit and what would work instead. A refused operation costs the agent
one turn; a half-applied one would cost the user a broken version.

What an edit may never change is the narration. The words, their timing and
the audio are the film's spine: shot boundaries come from where words were
measured to fall (shots.py), so cuts move only onto word boundaries, and no
operation adds, removes or retimes a word. Sound effects go on top of it
(pipeline/sfx.py): a cue at a time, which no other edit moves.
"""

from __future__ import annotations

import copy
import re
from dataclasses import dataclass, field
from typing import Callable

from . import config, sfx
from .shots import FRAMINGS
from .timeline import Motion, Shot, Timeline

#: How far a reroll moves the seed. A large prime, so a rerolled shot cannot
#: land on a neighbour's seed by accident (identical prompt and seed would
#: be the same picture, which the timeline validator rejects).
RESEED = 104_729

#: Framings an extra shot can take when a split adds one, closest last.
SPLIT_FRAMINGS = [f for f in FRAMINGS[3] if f]


class EditError(ValueError):
    """The operation was refused and nothing changed."""


def parse_timecode(value: str | float | int) -> float:
    """'1:24', '84', '1:24.5', '01:02:03' or a number -> seconds."""
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if re.fullmatch(r"\d+(\.\d+)?", text):
        return float(text)
    m = re.fullmatch(r"(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)", text)
    if not m:
        raise EditError(f"{value!r} is not a timecode; use seconds (84) or minutes:seconds (1:24)")
    h, mi, se = m.groups()
    return int(h or 0) * 3600 + int(mi) * 60 + float(se)


def timecode(seconds: float) -> str:
    """84.3 -> '1:24.3'."""
    m, s = divmod(max(0.0, seconds), 60)
    return f"{int(m)}:{s:04.1f}"


@dataclass
class Session:
    """A draft timeline under edit, and the record of what was done to it.

    `prompt_for(visual, mood, framing)` builds a shot prompt exactly as the
    planner did (config.Style.prompt_for with the film's style, period and
    protagonist), so a shot whose mood is changed is asked for in the same
    shape as every other shot in the film.
    """

    timeline: Timeline
    prompt_for: Callable[[str, str, str | None], str]
    ops: list[dict] = field(default_factory=list)
    #: The sounds a cue may use (sfx.library): the stock ones, and the
    #: studio's uploads when the worker passes them.
    sounds: dict[str, dict] = field(default_factory=sfx.library)

    # ------------------------------------------------------------- reading

    def shot(self, shot_id: str) -> Shot:
        sid = str(shot_id).strip().upper()
        if re.fullmatch(r"S?\d+", sid):
            sid = f"S{int(sid.lstrip('S')):02d}"
        for s in self.timeline.shots:
            if s.shot_id == sid:
                return s
        raise EditError(f"there is no shot {shot_id}; the film has S01-S{len(self.timeline.shots):02d}")

    def at(self, seconds: float) -> Shot:
        t = min(max(0.0, seconds), self.timeline.duration)
        for s in self.timeline.shots:
            if s.start <= t < s.end:
                return s
        return self.timeline.shots[-1]

    def describe(self, s: Shot) -> dict:
        d = {
            "shot": s.shot_id, "from": timecode(s.start), "to": timecode(s.end),
            "seconds": round(s.duration, 2), "beat": s.beat_id, "narration": s.text,
            "visual": s.visual, "mood": s.mood,
        }
        if s.framing:
            d["framing"] = s.framing
        if s.repaint:
            d["pending"] = ("will be repainted from its description" if s.repaint["mode"] == "generate"
                            else f"will be retouched: {s.repaint['instruction']}")
        elif s.retouch:
            d["retouched"] = s.retouch["instruction"]
        cues = [c for c in self.timeline.sounds if s.start <= c["at"] < s.end]
        if cues:
            d["sounds"] = [f"{c['name']} at {timecode(c['at'])} (id {c['id']})" for c in cues]
        return d

    def around(self, s: Shot, *, before: int = 1, after: int = 1) -> list[dict]:
        shots = self.timeline.shots
        i = shots.index(s)
        return [self.describe(x) for x in shots[max(0, i - before): i + after + 1]]

    def resolve_timecode(self, time: str | float) -> dict:
        t = parse_timecode(time)
        if t > self.timeline.duration + 0.5:
            raise EditError(f"{timecode(t)} is past the end of the film ({timecode(self.timeline.duration)})")
        s = self.at(t)
        out = {"time": timecode(t), "on_screen": s.shot_id, "shots": self.around(s)}
        nxt = self._next(s)
        if nxt is not None and t >= s.end - self.timeline.render["xfade"]:
            out["note"] = f"{timecode(t)} is inside the dissolve from {s.shot_id} into {nxt.shot_id}"
        return out

    # ------------------------------------------------------------- writing

    def _apply(self, tool: str, args: dict, fn: Callable[[], str]) -> dict:
        """Run one operation on the draft, or refuse it without a trace."""
        saved = copy.deepcopy(self.timeline.shots)
        saved_sounds = copy.deepcopy(self.timeline.sounds)
        try:
            message = fn()
            self._renumber()
            errors, _ = self.timeline.validate()
            if errors:
                raise EditError("that would leave the film unplayable: " + "; ".join(errors[:3]))
        except EditError:
            self.timeline.shots = saved
            self.timeline.sounds = saved_sounds
            raise
        self.ops.append({"tool": tool, "args": args, "result": message})
        return {"done": message}

    def _renumber(self) -> None:
        for i, s in enumerate(self.timeline.shots):
            s.index, s.shot_id = i, f"S{i + 1:02d}"

    def _next(self, s: Shot) -> Shot | None:
        shots = self.timeline.shots
        i = shots.index(s)
        return shots[i + 1] if i + 1 < len(shots) else None

    def _prev(self, s: Shot) -> Shot | None:
        i = self.timeline.shots.index(s)
        return self.timeline.shots[i - 1] if i > 0 else None

    def _repaint(self, s: Shot, mode: str = "generate", **extra) -> None:
        s.repaint = {"mode": mode, **extra}

    def set_shot_mood(self, shot_id: str, mood: str) -> dict:
        s = self.shot(shot_id)
        mood = _clean(mood, "mood")

        def op() -> str:
            prompt = self.prompt_for(s.visual, mood, s.framing)
            if prompt == s.prompt and not s.repaint:
                raise EditError(f"{s.shot_id} already has that mood")
            old = s.mood
            s.mood, s.prompt = mood, prompt
            self._repaint(s)
            return f"{s.shot_id} ({timecode(s.start)}): mood '{old}' -> '{mood}'; it will be repainted"
        return self._apply("set_shot_mood", {"shot_id": shot_id, "mood": mood}, op)

    def regenerate_shot(self, shot_id: str, visual: str | None = None) -> dict:
        s = self.shot(shot_id)
        visual = _clean(visual, "visual") if visual else None

        def op() -> str:
            if visual and visual != s.visual:
                s.visual = visual
                s.prompt = self.prompt_for(visual, s.mood, s.framing)
                what = f"new description: {visual}"
            else:
                # The same words on a new seed: a different painting of them.
                s.seed = (s.seed + RESEED) % (2 ** 31)
                what = "same description, a new painting of it"
            self._repaint(s)
            return f"{s.shot_id} ({timecode(s.start)}) will be repainted, {what}"
        return self._apply("regenerate_shot", {"shot_id": shot_id, "visual": visual}, op)

    def edit_shot_image(self, shot_id: str, instruction: str, region=None) -> dict:
        """Retouch the current picture. `region` [left, top, right, bottom]
        (fractions of the frame) limits the change to that part of it, which
        is what keeps everything else exactly as it was (images.retouch_region)."""
        s = self.shot(shot_id)
        instruction = _clean(instruction, "instruction", limit=600)
        if region is not None:
            try:
                region = [round(min(max(float(v), 0.0), 1.0), 4) for v in region]
            except (TypeError, ValueError):
                raise EditError("region is [left, top, right, bottom], each a fraction of the frame from 0 to 1") from None
            if len(region) != 4 or region[2] - region[0] < 0.03 or region[3] - region[1] < 0.03:
                raise EditError("region is [left, top, right, bottom] with right > left and bottom > top")
            if (region[2] - region[0]) * (region[3] - region[1]) > 0.7:
                region = None              # most of the frame: retouch the whole of it

        def op() -> str:
            if s.image is None:
                raise EditError(f"{s.shot_id} has no picture yet to edit; use regenerate_shot")
            if s.repaint and s.repaint["mode"] == "generate":
                raise EditError(f"{s.shot_id} is already being repainted from its description in "
                                "this edit, so there is no picture to retouch yet")
            if s.repaint:
                raise EditError(f"{s.shot_id} is already being retouched in this edit; one retouch per "
                                "shot, so put everything for it in one instruction")
            base = {"hash": s.image.hash, "path": s.image.path}
            self._repaint(s, "retouch", instruction=instruction, base=base,
                          **({"region": region} if region else {}))
            where = f" within {region}" if region else ""
            return f"{s.shot_id} ({timecode(s.start)}) will be retouched{where}: {instruction}"
        return self._apply("edit_shot_image", {"shot_id": shot_id, "instruction": instruction,
                                               "region": region}, op)

    def nudge_shot_boundary(self, shot_id: str, edge: str, seconds: float) -> dict:
        """Move the cut at the start or end of a shot by `seconds` (negative is
        earlier), onto the nearest word boundary."""
        s = self.shot(shot_id)
        edge = str(edge).strip().lower()
        if edge not in ("start", "end"):
            raise EditError("edge is 'start' or 'end'")
        try:
            delta = float(seconds)
        except (TypeError, ValueError):
            raise EditError("seconds is a number, negative to move the cut earlier") from None
        a, b = (self._prev(s), s) if edge == "start" else (s, self._next(s))
        if a is None or b is None:
            raise EditError(f"the {edge} of {s.shot_id} is the {'beginning' if edge == 'start' else 'end'} "
                            "of the film, which is fixed to the narration")

        def op() -> str:
            old = b.start
            cut = snap_cut(a, b, old + delta)
            if abs(cut - old) < 1e-6:
                raise EditError(
                    f"the cut between {a.shot_id} and {b.shot_id} cannot move that way: it sits on "
                    f"word boundaries, and each shot must stay at least {config.MIN_SHOT_SECONDS:.0f} s")
            move_cut(a, b, cut)
            return (f"cut between {a.shot_id} and {b.shot_id} moved from {timecode(old)} to "
                    f"{timecode(cut)}; {b.shot_id} now starts on '{b.text.split()[0] if b.text else ''}'")
        return self._apply("nudge_shot_boundary", {"shot_id": shot_id, "edge": edge, "seconds": delta}, op)

    def split_shot(self, shot_id: str, at: str | float | None = None, visual: str | None = None) -> dict:
        """Two shots where there was one. The first keeps its picture; the
        second is painted, from `visual` or the same scene seen closer."""
        s = self.shot(shot_id)
        visual = _clean(visual, "visual") if visual else None

        def op() -> str:
            target = parse_timecode(at) if at is not None else (s.start + s.end) / 2
            cuts = [t for t in _word_cuts(s.words) if _fits(s.start, t) and _fits(t, s.end)]
            if not cuts:
                raise EditError(f"{s.shot_id} is {s.duration:.1f} s; splitting it needs two pieces of at "
                                f"least {config.MIN_SHOT_SECONDS:.0f} s that each start on a word")
            cut = min(cuts, key=lambda t: abs(t - target))
            second = copy.deepcopy(s)
            first_words = [w for w in s.words if w["end"] <= cut + 1e-6]
            s.words, second.words = first_words, s.words[len(first_words):]
            s.text, second.text = _text(s.words), _text(second.words)
            s.end, second.start = cut, cut
            second.image, second.retouch, second.segment = s.image, None, {}
            if visual:
                second.visual = visual
            else:
                used = {s.framing}
                second.framing = next((f for f in reversed(SPLIT_FRAMINGS) if f not in used),
                                      SPLIT_FRAMINGS[-1])
            second.prompt = self.prompt_for(second.visual, second.mood, second.framing)
            if second.prompt == s.prompt:
                second.seed = (s.seed + RESEED) % (2 ** 31)
            # A different move from the half before it, or the cut between two
            # pictures of one scene drifting the same way reads as a stutter.
            second.motion = Motion(kind=s.motion.kind, zoom="out" if s.motion.zoom == "in" else "in",
                                   pan=_turn(s.motion.pan), zoom_amount=s.motion.zoom_amount)
            self._repaint(second)
            shots = self.timeline.shots
            shots.insert(shots.index(s) + 1, second)
            return (f"{s.shot_id} split at {timecode(cut)}: the first part keeps its picture, the "
                    f"second ('{second.text[:40]}...') will be painted"
                    + (f" as: {visual}" if visual else f" closer: {second.framing}"))
        return self._apply("split_shot", {"shot_id": shot_id, "at": at, "visual": visual}, op)

    def merge_shots(self, shot_id: str, keep: str = "first") -> dict:
        """`shot_id` and the shot after it become one shot, keeping one picture."""
        a = self.shot(shot_id)
        b = self._next(a)
        if b is None:
            raise EditError(f"{a.shot_id} is the last shot; merge the shot before it instead")
        keep = str(keep).strip().lower()
        if keep not in ("first", "second"):
            raise EditError("keep is 'first' or 'second': whose picture the merged shot shows")

        def op() -> str:
            kept, gone = (a, b) if keep == "first" else (b, a)
            if b.end - a.start > 30:
                raise EditError("the merged shot would run over 30 s on one picture")
            merged = copy.deepcopy(kept)
            merged.start, merged.end = a.start, b.end
            merged.words = a.words + b.words
            merged.text = _text(merged.words)
            merged.cites = list(dict.fromkeys(a.cites + b.cites))
            merged.segment = {}
            shots = self.timeline.shots
            i = shots.index(a)
            shots[i:i + 2] = [merged]
            return (f"{a.shot_id} and {b.shot_id} merged into one shot from {timecode(a.start)} to "
                    f"{timecode(b.end)}, showing the picture of the {keep} ({gone.shot_id}'s is dropped)")
        return self._apply("merge_shots", {"shot_id": shot_id, "keep": keep}, op)

    # ------------------------------------------------------------- sounds

    def add_sound(self, sound: str, at: str | float | None = None, volume: str | float = "normal",
                  after: str | None = None) -> dict:
        """A sound effect at `at`, or just after the words `after` (the
        occurrence nearest `at`, if both are given): "a laugh after the joke"
        lands on the joke's last word, not wherever the playhead was."""
        key = self._sound_id(sound)
        entry = self.sounds[key]
        if isinstance(volume, str):
            gain = sfx.VOLUMES.get(volume.strip().lower())
            if gain is None:
                raise EditError(f"volume is one of {', '.join(sfx.VOLUMES)}")
        else:
            gain = float(volume)
        near = parse_timecode(at) if at is not None and str(at).strip() else None
        if near is None and not after:
            raise EditError("say where: `at` a time, or `after` some words of the narration")

        def op() -> str:
            t = self._phrase_end(after, near) + 0.05 if after else near
            if not 0 <= t < self.timeline.duration:
                raise EditError(f"{timecode(t)} is outside the film (0:00.0-{timecode(self.timeline.duration)})")
            if len(self.timeline.sounds) >= sfx.MAX_CUES:
                raise EditError(f"the film already has {sfx.MAX_CUES} sounds; remove some first")
            cue = {"id": self._cue_id(), "sound": key, "name": entry["name"], "at": round(t, 3), "volume": gain}
            for extra in ("key", "credit"):
                if entry.get(extra):
                    cue[extra] = entry[extra]
            self.timeline.sounds.append(cue)
            self.timeline.sounds.sort(key=lambda c: c["at"])
            word = self._word_at(t)
            return (f"{entry['name']} at {timecode(t)}" + (f", on '{word}'" if word else "")
                    + (f" ({volume})" if volume != "normal" else "") + f"; id {cue['id']}")
        return self._apply("add_sound", {"sound": key, "at": at, "after": after, "volume": volume}, op)

    def remove_sound(self, sound_id: str) -> dict:
        def op() -> str:
            cue = next((c for c in self.timeline.sounds if c["id"] == str(sound_id).strip()), None)
            if cue is None:
                have = ", ".join(f"{c['id']} ({c['name']} at {timecode(c['at'])})" for c in self.timeline.sounds)
                raise EditError(f"there is no sound {sound_id} on the film" + (f"; it has {have}" if have
                                else "; it has none"))
            self.timeline.sounds.remove(cue)
            return f"{cue['name']} at {timecode(cue['at'])} removed"
        return self._apply("remove_sound", {"sound_id": sound_id}, op)

    def _sound_id(self, sound: str) -> str:
        """A library id, or a sound's name in any case."""
        text = str(sound or "").strip()
        if text in self.sounds:
            return text
        by_name = {v["name"].lower(): k for k, v in self.sounds.items()}
        if text.lower() in by_name:
            return by_name[text.lower()]
        raise EditError(f"there is no sound {sound!r}; use an id from the sound list")

    def _cue_id(self) -> str:
        used = [int(c["id"][1:]) for c in self.timeline.sounds if re.fullmatch(r"x\d+", c["id"])]
        return f"x{max(used, default=0) + 1}"

    def _words(self) -> list[dict]:
        return [w for s in self.timeline.shots for w in s.words]

    def _word_at(self, t: float) -> str | None:
        words = self._words()
        hit = next((w for w in words if w["start"] <= t < w["end"]), None)
        if hit is None:
            before = [w for w in words if w["end"] <= t]
            if before and t - before[-1]["end"] < 0.6:
                return f"just after {before[-1]['word']}"
        return hit["word"] if hit else None

    def _phrase_end(self, phrase: str, near: float | None) -> float:
        """Where the narration finishes saying `phrase`, nearest `near`."""
        norm = lambda w: re.sub(r"[^\w']", "", w.lower())
        want = [norm(w) for w in str(phrase).split() if norm(w)]
        words = self._words()
        said = [norm(w["word"]) for w in words]
        ends = [words[i + len(want) - 1]["end"] for i in range(len(said) - len(want) + 1)
                if want and said[i:i + len(want)] == want]
        if not ends:
            raise EditError(f"the narration never says {phrase!r}; quote a few of its words exactly, "
                            "or give `at` a time instead")
        return min(ends, key=lambda e: abs(e - near)) if near is not None else ends[0]

    # ------------------------------------------------------------- results

    def pending(self) -> list[Shot]:
        return [s for s in self.timeline.shots if s.repaint]

    def changed(self) -> bool:
        return bool(self.ops)


def _clean(text: str | None, what: str, limit: int = 300) -> str:
    text = " ".join(str(text or "").split())
    if not text:
        raise EditError(f"{what} is empty")
    if len(text) > limit:
        raise EditError(f"{what} is {len(text)} characters; keep it under {limit}")
    return text


def _text(words: list[dict]) -> str:
    return " ".join(w["word"] for w in words)


def _turn(pan: str) -> str:
    order = ("right", "up", "left", "down")
    return order[(order.index(pan) + 1) % 4] if pan in order else "right"


def _fits(start: float, end: float) -> bool:
    return end - start >= config.MIN_SHOT_SECONDS - 1e-6


def _word_cuts(words: list[dict]) -> list[float]:
    """Where a cut may land inside a run of words: right after a word ends,
    as the planner cuts (shots.py), never inside one."""
    return [w["end"] for w in words[:-1]]


def snap_cut(a: Shot, b: Shot, target: float) -> float:
    """The word boundary nearest `target` that keeps both shots long enough.
    -> the current cut if none qualifies."""
    words = a.words + b.words
    options = [t for t in _word_cuts(words) if _fits(a.start, t) and _fits(t, b.end)]
    if not options:
        return b.start
    return min(options + [b.start], key=lambda t: abs(t - target))


def move_cut(a: Shot, b: Shot, cut: float) -> None:
    words = a.words + b.words
    a.words = [w for w in words if w["end"] <= cut + 1e-6]
    b.words = words[len(a.words):]
    a.text, b.text = _text(a.words), _text(b.words)
    a.end = b.start = cut
