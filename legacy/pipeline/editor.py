"""The edit agent: a request in plain words -> a new version of the film.

    "the mood at 1:24 doesn't match"

Two halves, deliberately in different places:

1. **Claude decides** (`run_agent`). `claude -p` on the worker's sign-in, with
   the timeline tools of pipeline/edit_tools.py as its only tools. It finds
   the shot, looks at it, and changes the draft timeline: a mood, a
   description, a retouch, a cut. About 12 s with Opus, measured on this
   request against the Roman film (Haiku took 13 s, Sonnet 51 s; Opus also
   gave the best-reasoned change). PLAN.md 12.3.
2. **The worker makes it** (`apply`). The marked shots are painted on the
   warm model, the two chunks around each change are re-encoded, and only
   those are uploaded. Tools never paint, so Claude is never waiting on the
   GPU and the GPU is never waiting on a conversation.

A person can also skip the first half (`repaint`): frames picked out in the
studio as wrong are painted again on a new seed, with no request to read.
Sounds placed in the studio skip it the same way (`place_sounds`), and skip
the painting too: a sound changes the soundtrack and no picture.

The result is a new immutable timeline version on top of the one edited, and
the film's pointer moves to it. Undo moves the pointer back and costs nothing.

Claude never changes the narration: no tool adds, removes or retimes a word
(pipeline/edits.py). A request that needs that is answered, not attempted.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

from . import edits, sfx, writer
from .timeline import Timeline

#: The model for edits. Opus: as fast as Haiku on this loop and the only one
#: that weighed the neighbouring shots before choosing a mood (PLAN.md 12.3).
MODEL = os.environ.get("CLAUDE_EDIT_MODEL", "opus")

#: A request is a few tool calls. Past this something is wrong; the user
#: gets an error and the film is untouched.
TIMEOUT_SECONDS = 180

#: `claude --effort` for edits. Low: 9 s against 11-14 s at the default on
#: the exit request, the same decision, and on an anachronism it still looked
#: at both shots and boxed the right regions (PLAN.md 12.6). Empty for the
#: CLI's default.
EFFORT = os.environ.get("CLAUDE_EDIT_EFFORT", "low")

#: What the tool server needs from the worker's environment.
SERVER_ENV = ("DATABASE_URL", "BLOB_READ_WRITE_TOKEN", "MEDIA_DIR", "PATH", "HOME")

TOOL_NAMES = ["resolve_timecode", "view_shot", "set_shot_mood", "regenerate_shot",
              "edit_shot_image", "nudge_shot_boundary", "split_shot", "merge_shots",
              "add_sound", "remove_sound"]

SYSTEM = """You are the editor of a narrated, illustrated history film. A viewer watched it and asked for a change. You change the film through your tools, then say what you did.

How the film is made: the narration is fixed. It was recorded first, and every shot is a painted still on screen while certain words are spoken, joined to the next by a short dissolve. Each shot's picture is painted from its description (`visual`) and `mood`, in the film's look, with the main character matched to a reference. You cannot change the narration, the voice, the music or the look of the whole film; if the request needs that, change nothing and say so plainly. You can put sound effects from the sound list over the narration, and take them off.

How to work:
1. Find the shot or shots the request is about. A time ("at 1:24") or "this", "here", "now" means resolve_timecode (use the viewer's playhead for "this"). A description ("the shot with the lantern") means the shot list below.
2. If the complaint is about what a picture shows, view_shot first, and view the neighbours when the complaint is that something does not match.
3. Make the smallest change that fixes it:
   - one wrong object or detail, an anachronism: edit_shot_image with a region boxed around it (read the box off the picture), the instruction saying what that region should show;
   - light, colour, atmosphere or feeling: set_shot_mood;
   - the wrong subject or composition: regenerate_shot with a new `visual` written like the others (concrete, one moment, period-accurate: name materials and light sources in period terms);
   - a cut that comes too early or too late: nudge_shot_boundary;
   - a picture held too long, or two pictures for one idea: split_shot or merge_shots;
   - a sound effect (a laugh, a fail horn, a boom): add_sound, with `after` quoting the narration's words it should follow exactly, or `at` a time; a sound that is wrong or unwanted: remove_sound. Add only the sounds asked for, one per moment asked for.
4. Everything must be right for the period below. Never introduce glass lanterns, metal buckets, modern tools or clothing unless the period had them.
5. Do not change shots the request is not about.
6. Changes are applied after you finish, so viewing a shot you just changed shows the old picture: do not.

When you are done, reply with one or two short sentences for the viewer saying what you changed, by time in the film ("the shot at 1:24"), never by shot id, and in plain words: no tool names, no "prompt", "seed", "timeline" or "model". If you changed nothing, say why in one sentence."""


@dataclass
class AgentResult:
    summary: str
    ops: list[dict]
    draft: Timeline
    prompt: str
    response_raw: str
    meta: dict = field(default_factory=dict)
    seconds: float = 0.0


def shot_list(timeline: Timeline) -> str:
    lines = []
    for s in timeline.shots:
        extra = f" | retouched: {s.retouch['instruction']}" if s.retouch else ""
        lines.append(f"{s.shot_id} {edits.timecode(s.start)}-{edits.timecode(s.end)} "
                     f"| says: {s.text} | shows: {s.visual} | mood: {s.mood}{extra}")
    return "\n".join(lines)


def build_prompt(timeline: Timeline, request: str, *, at: float | None, context: dict) -> str:
    who = context.get("protagonist")
    parts = [
        f"Film: {timeline.topic}",
        f"Length: {edits.timecode(timeline.duration)}",
        f"Period: {context.get('period') or 'as the shot descriptions say'}",
    ]
    if who:
        parts.append(f"Main character: {who[0]}, {who[1]}")
    parts.append(f"Look of the whole film: {context['prompt_prefix'].strip().rstrip(',')}")
    parts.append("")
    parts.append("Shots, in order (id, from-to, the words spoken over it, what it shows, its mood):")
    parts.append(shot_list(timeline))
    parts.append("")
    if timeline.sounds:
        parts.append("Sound effects on the film now (id, time, sound):")
        parts += [f"{c['id']} {edits.timecode(c['at'])} {c['name']}" for c in timeline.sounds]
        parts.append("")
    library = context.get("sounds") or sfx.library()
    parts.append("The sound list, for add_sound (id: name):")
    groups: dict[str, list[str]] = {}
    for sid, entry in library.items():
        groups.setdefault(entry["group"], []).append(f"{sid}: {entry['name']}")
    parts += [f"{g}. " + "; ".join(items) for g, items in groups.items()]
    parts.append("")
    if at is not None:
        parts.append(f"The viewer's playhead was at {edits.timecode(at)} when they wrote this.")
    parts.append(f"The viewer's request: {request.strip()}")
    return "\n".join(parts)


def run_agent(timeline: Timeline, request: str, *, at: float | None, context: dict, work_root: Path,
              should_stop=None, on_op=None, log=print) -> AgentResult:
    """Claude edits a draft of `timeline` through the tools. -> the draft and
    what was done. `on_op(op)` sees each tool call as it happens."""
    prompt = build_prompt(timeline, request, at=at, context=context)
    with tempfile.TemporaryDirectory(prefix="ytm-edit-") as td:
        session = Path(td)
        (session / "timeline.json").write_text(json.dumps(timeline.to_json()))
        (session / "context.json").write_text(json.dumps({**context, "work_root": str(work_root)}))
        (session / "ops.jsonl").touch()
        mcp = {"mcpServers": {"timeline": {
            "type": "stdio", "command": sys.executable,
            "args": ["-m", "pipeline.edit_tools", str(session)],
            # Explicit: the tool server reads stills through the media store
            # (view_shot), and nothing promises the CLI passes its own
            # environment on. The session directory is private and deleted.
            "env": {"PYTHONPATH": str(Path(__file__).resolve().parent.parent),
                    **{k: os.environ[k] for k in SERVER_ENV if k in os.environ}},
        }}}
        (session / "mcp.json").write_text(json.dumps(mcp))
        cwd = session / "cwd"
        cwd.mkdir()
        cmd = [writer.CLAUDE_BIN, "-p", "--output-format", "json", "--model", MODEL,
               "--system-prompt", SYSTEM, "--strict-mcp-config", "--mcp-config", str(session / "mcp.json"),
               "--no-session-persistence", "--tools", "", *(["--effort", EFFORT] if EFFORT else []),
               "--allowedTools", *[f"mcp__timeline__{t}" for t in TOOL_NAMES]]
        t0 = time.monotonic()
        proc = subprocess.Popen(cmd, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True)
        assert proc.stdin is not None
        proc.stdin.write(prompt)
        proc.stdin.close()
        seen = 0
        try:
            while proc.poll() is None:
                if should_stop is not None:
                    should_stop()
                if time.monotonic() - t0 > TIMEOUT_SECONDS:
                    raise TimeoutError(f"Claude took over {TIMEOUT_SECONDS} s on this request")
                seen = _tail_ops(session, seen, on_op)
                time.sleep(0.25)
        except BaseException:
            proc.kill()
            proc.wait()
            raise
        _tail_ops(session, seen, on_op)
        out = proc.stdout.read() if proc.stdout else ""
        err = proc.stderr.read() if proc.stderr else ""
        seconds = time.monotonic() - t0
        result = writer.parse_result(out, err, proc.returncode)
        ops = [json.loads(line) for line in (session / "ops.jsonl").read_text().splitlines() if line.strip()]
        draft_path = session / "draft.json"
        draft = Timeline.from_json(json.loads(draft_path.read_text())) if draft_path.exists() \
            else Timeline.from_json(timeline.to_json())
    log(f"  claude: {result.get('num_turns')} turns, {seconds:.1f}s, "
        f"{sum(1 for o in ops if o['ok'] and o['tool'] not in ('resolve_timecode', 'view_shot'))} change(s)")
    return AgentResult(
        summary=str(result.get("result") or "").strip(),
        ops=ops, draft=draft, prompt=f"[system]\n{SYSTEM}\n\n[user]\n{prompt}",
        response_raw=json.dumps(result), seconds=round(seconds, 2),
        meta={k: result.get(k) for k in ("session_id", "num_turns", "duration_ms", "total_cost_usd",
                                          "modelUsage")} | {"model": MODEL},
    )


#: Most frames one "paint again" may ask for: a run past this is a re-render.
MAX_REPAINT = 12


def repaint(timeline: Timeline, shot_ids: list[str], *, context: dict, on_op=None) -> AgentResult:
    """The frames a person picked out as wrong, painted again from the same
    words on a new seed, without asking Claude: the person already decided
    which shots, and "try again" needs no reading. -> the same shape as
    run_agent, so the worker paints and cuts it the same way."""
    from .edit_tools import prompt_builder

    if not shot_ids or len(shot_ids) > MAX_REPAINT:
        raise edits.EditError(f"paint 1 to {MAX_REPAINT} frames again at a time, not {len(shot_ids)}")
    draft = Timeline.from_json(timeline.to_json())
    session = edits.Session(draft, prompt_builder(context))
    ops = []
    for shot_id in dict.fromkeys(shot_ids):
        args = {"shot_id": shot_id}
        try:
            op = {"tool": "regenerate_shot", "args": args, "ok": True,
                  "result": session.regenerate_shot(shot_id)["done"]}
        except edits.EditError as exc:
            op = {"tool": "regenerate_shot", "args": args, "ok": False, "result": str(exc)}
        ops.append(op)
        if on_op is not None:
            on_op(op)
    done = sum(1 for o in ops if o["ok"])
    return AgentResult(summary=f"Painted {done} frame{'s' if done != 1 else ''} again from the same "
                               "description, on a new seed.",
                       ops=ops, draft=draft, prompt="", response_raw="", meta={"model": None})


def place_sounds(timeline: Timeline, *, add: list[dict], remove: list[str], context: dict,
                 on_op=None) -> AgentResult:
    """Sounds a person placed or took off in the studio, applied without
    asking Claude: they already chose what and when. -> the same shape as
    run_agent, so the worker cuts it the same way (with nothing to paint)."""
    if not add and not remove:
        raise edits.EditError("place or remove at least one sound")
    if len(add) + len(remove) > sfx.MAX_CUES:
        raise edits.EditError(f"place up to {sfx.MAX_CUES} sounds at a time")
    draft = Timeline.from_json(timeline.to_json())
    session = edits.Session(draft, lambda *a: "", sounds=context.get("sounds") or sfx.library())
    ops = []

    def run(tool: str, args: dict, fn) -> bool:
        try:
            op = {"tool": tool, "args": args, "ok": True, "result": fn()["done"]}
        except edits.EditError as exc:
            op = {"tool": tool, "args": args, "ok": False, "result": str(exc)}
        ops.append(op)
        if on_op is not None:
            on_op(op)
        return op["ok"]

    # Said the way the studio says times ("1:24"), from the cues themselves.
    said = lambda c: f"{c['name']} at {int(c['at'] // 60)}:{int(c['at'] % 60):02d}"
    added, removed = [], []
    for sound_id in dict.fromkeys(remove):
        cue = next((c for c in draft.sounds if c["id"] == sound_id), None)
        if run("remove_sound", {"sound_id": sound_id}, lambda: session.remove_sound(sound_id)):
            removed.append(said(cue))
    for a in add:
        volume = a.get("volume", "normal")
        if run("add_sound", {"sound": a.get("sound"), "at": a.get("at"), "volume": volume},
               lambda: session.add_sound(a.get("sound"), a.get("at"), volume)):
            cue = max(draft.sounds, key=lambda c: int(c["id"][1:]) if c["id"][1:].isdigit() else 0)
            added.append(said(cue) + (f" ({volume})" if volume != "normal" else ""))
    summary = "; ".join(p for p in (
        ("Added " + ", ".join(added)) if added else "",
        ("Took off " + ", ".join(removed)) if removed else "",
    ) if p) + "." if added or removed else "No sound could be placed: " + "; ".join(o["result"] for o in ops)
    return AgentResult(summary=summary, ops=ops, draft=draft, prompt="", response_raw="", meta={"model": None})


def _tail_ops(session: Path, seen: int, on_op) -> int:
    lines = (session / "ops.jsonl").read_text().splitlines()
    for line in lines[seen:]:
        if line.strip() and on_op is not None:
            on_op(json.loads(line))
    return len(lines)


def changes(ops: list[dict]) -> list[dict]:
    """The tool calls that changed the draft, without the looking."""
    return [o for o in ops if o.get("ok") and o["tool"] not in ("resolve_timecode", "view_shot")]
