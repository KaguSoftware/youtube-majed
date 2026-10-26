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

from . import edits, writer
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
              "edit_shot_image", "nudge_shot_boundary", "split_shot", "merge_shots"]

SYSTEM = """You are the editor of a narrated, illustrated history film. A viewer watched it and asked for a change. You change the film through your tools, then say what you did.

How the film is made: the narration is fixed. It was recorded first, and every shot is a painted still on screen while certain words are spoken, joined to the next by a short dissolve. Each shot's picture is painted from its description (`visual`) and `mood`, in the film's look, with the main character matched to a reference. You cannot change the narration, the voice, the music or the look of the whole film; if the request needs that, change nothing and say so plainly.

How to work:
1. Find the shot or shots the request is about. A time ("at 1:24") or "this", "here", "now" means resolve_timecode (use the viewer's playhead for "this"). A description ("the shot with the lantern") means the shot list below.
2. If the complaint is about what a picture shows, view_shot first, and view the neighbours when the complaint is that something does not match.
3. Make the smallest change that fixes it:
   - one wrong object or detail, an anachronism: edit_shot_image with a region boxed around it (read the box off the picture), the instruction saying what that region should show;
   - light, colour, atmosphere or feeling: set_shot_mood;
   - the wrong subject or composition: regenerate_shot with a new `visual` written like the others (concrete, one moment, period-accurate: name materials and light sources in period terms);
   - a cut that comes too early or too late: nudge_shot_boundary;
   - a picture held too long, or two pictures for one idea: split_shot or merge_shots.
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


def _tail_ops(session: Path, seen: int, on_op) -> int:
    lines = (session / "ops.jsonl").read_text().splitlines()
    for line in lines[seen:]:
        if line.strip() and on_op is not None:
            on_op(json.loads(line))
    return len(lines)


def changes(ops: list[dict]) -> list[dict]:
    """The tool calls that changed the draft, without the looking."""
    return [o for o in ops if o.get("ok") and o["tool"] not in ("resolve_timecode", "view_shot")]
