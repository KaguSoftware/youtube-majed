"""The edit agent's tools, as an MCP server over stdio.

    python -m pipeline.edit_tools <session dir>

`claude -p` starts this as its only tool server (pipeline/editor.py). Each
tool is an operation from pipeline/edits.py on the draft timeline in the
session directory, and after every change the draft is written back, so the
worker reads exactly what Claude did when Claude exits. Tools never paint or
render: Claude decides in seconds, then the worker's warm model paints what
changed.

Session directory:

    timeline.json   the version being edited (read once)
    context.json    style prefix, period, protagonist, work root
    draft.json      the draft after the latest change (written here)
    ops.jsonl       one line per tool call, as it happens, for the progress view

MCP over stdio is newline-delimited JSON-RPC 2.0. It is written out here
rather than taken from the `mcp` package: three methods are needed, and the
worker should not grow a dependency for them.
"""

from __future__ import annotations

import base64
import io
import json
import os
import sys
import time
from pathlib import Path

from . import config, edits, sfx
from .timeline import Timeline

#: The stills Claude looks at: full generation size, so a small wrong object
#: (a glass lantern in AD 100) is visible. About 500 image tokens each.
VIEW_QUALITY = 85

TOOLS = [
    {
        "name": "resolve_timecode",
        "description": "Find the shot on screen at a moment of the film, with the shots either side. "
                       "Use it whenever the request gives a time ('at 1:24') or says 'this' or 'here' "
                       "(then use the viewer's playhead).",
        "inputSchema": {"type": "object", "properties": {
            "time": {"type": "string", "description": "seconds ('84') or minutes:seconds ('1:24')"}},
            "required": ["time"]},
    },
    {
        "name": "view_shot",
        "description": "Look at a shot's current picture. Do this before changing a picture, and to "
                       "compare a shot with its neighbours.",
        "inputSchema": {"type": "object", "properties": {"shot_id": {"type": "string"}},
                        "required": ["shot_id"]},
    },
    {
        "name": "set_shot_mood",
        "description": "Change a shot's mood words (light, colour, atmosphere, emotion), e.g. 'warm "
                       "firelight, quiet, intimate'. The shot is repainted from its description with "
                       "the new mood; its subject and framing stay.",
        "inputSchema": {"type": "object", "properties": {
            "shot_id": {"type": "string"}, "mood": {"type": "string"}},
            "required": ["shot_id", "mood"]},
    },
    {
        "name": "regenerate_shot",
        "description": "Repaint a shot. With `visual`, from a new description of what the picture shows "
                       "(written like the others: concrete, period-accurate, one moment). Without it, the "
                       "same description painted afresh.",
        "inputSchema": {"type": "object", "properties": {
            "shot_id": {"type": "string"}, "visual": {"type": "string"}},
            "required": ["shot_id"]},
    },
    {
        "name": "edit_shot_image",
        "description": "Retouch the current picture, keeping its composition: for one wrong object or "
                       "detail. Give `region`, the box around the object as fractions of the frame "
                       "[left, top, right, bottom] read off the picture from view_shot, a little generous: "
                       "only that part is repainted and every other pixel stays. Write the instruction "
                       "as what the region should show, e.g. 'a small plain clay oil lamp with one flame "
                       "hanging from the beam on a cord, dark timber behind'. Without `region` the "
                       "whole picture is retouched and nearby objects can change too.",
        "inputSchema": {"type": "object", "properties": {
            "shot_id": {"type": "string"}, "instruction": {"type": "string"},
            "region": {"type": "array", "items": {"type": "number"}, "minItems": 4, "maxItems": 4}},
            "required": ["shot_id", "instruction"]},
    },
    {
        "name": "nudge_shot_boundary",
        "description": "Move the cut at the start or end of a shot, earlier (negative seconds) or later. "
                       "Cuts land only on word boundaries and every shot stays at least 2 s, so the cut "
                       "moves to the nearest place that allows.",
        "inputSchema": {"type": "object", "properties": {
            "shot_id": {"type": "string"},
            "edge": {"type": "string", "enum": ["start", "end"]},
            "seconds": {"type": "number"}},
            "required": ["shot_id", "edge", "seconds"]},
    },
    {
        "name": "split_shot",
        "description": "Split a shot in two at a word boundary near `at` (default: the middle). The first "
                       "part keeps its picture; the second is painted from `visual`, or the same scene "
                       "seen closer. Shot ids after it shift by one.",
        "inputSchema": {"type": "object", "properties": {
            "shot_id": {"type": "string"},
            "at": {"type": "string", "description": "a time inside the shot, '1:26' or '86'"},
            "visual": {"type": "string"}},
            "required": ["shot_id"]},
    },
    {
        "name": "merge_shots",
        "description": "Merge a shot with the shot after it, showing one picture for both. Shot ids "
                       "after it shift down by one.",
        "inputSchema": {"type": "object", "properties": {
            "shot_id": {"type": "string"},
            "keep": {"type": "string", "enum": ["first", "second"],
                     "description": "whose picture the merged shot shows"}},
            "required": ["shot_id"]},
    },
    {
        "name": "add_sound",
        "description": "Put a sound effect from the sound list on the film. Give `after`, a few words of "
                       "the narration quoted exactly, to land it just as they finish (a laugh after the "
                       "joke, a fail horn after the defeat); or `at`, a time. With both, the occurrence of "
                       "the words nearest the time. The narration stays as it is; the sound plays over it.",
        "inputSchema": {"type": "object", "properties": {
            "sound": {"type": "string", "description": "an id from the sound list"},
            "at": {"type": "string", "description": "'1:24' or '84'"},
            "after": {"type": "string", "description": "words of the narration, quoted exactly"},
            "volume": {"type": "string", "enum": ["quiet", "normal", "loud"],
                       "description": "quiet sits under the voice; normal is as loud as it"}},
            "required": ["sound"]},
    },
    {
        "name": "remove_sound",
        "description": "Take a sound effect off the film, by the id the shot list or resolve_timecode gives it.",
        "inputSchema": {"type": "object", "properties": {"sound_id": {"type": "string"}},
                        "required": ["sound_id"]},
    },
]


def prompt_builder(ctx: dict):
    """`prompt_for(visual, mood, framing)` for edits.Session, from the
    film-wide words in an edit context (worker._edit_context)."""
    style = config.Style(style_id="edit", preset="", prompt_prefix=ctx["prompt_prefix"], seed=0,
                         hero_full=Path(), hero_crop=Path(), crop_box=(0, 0, 1, 1))
    protagonist = tuple(ctx["protagonist"]) if ctx.get("protagonist") else None

    def prompt_for(visual: str, mood: str, framing: str | None) -> str:
        return style.prompt_for(visual, mood, framing, period=ctx.get("period"),
                                protagonist=protagonist)
    return prompt_for


class Server:
    def __init__(self, session_dir: Path) -> None:
        self.dir = session_dir
        ctx = json.loads((session_dir / "context.json").read_text())
        self.ctx = ctx
        timeline = Timeline.from_json(json.loads((session_dir / "timeline.json").read_text()))
        self.session = edits.Session(timeline, prompt_builder(ctx), sounds=ctx.get("sounds") or sfx.library())
        self._mirror = None

    # ------------------------------------------------------------ images

    def mirror(self):
        if self._mirror is None:
            from . import media
            from .store import MediaIndex, Store

            remote = media.remote_from_env()
            index = MediaIndex(Store(), remote.name) if remote.name != "none" else None
            self._mirror = media.Mirror(Path(self.ctx["work_root"]) / "cache", remote, index,
                                        log=lambda *a: None)
        return self._mirror

    def view(self, shot_id: str) -> list[dict]:
        from PIL import Image

        s = self.session.shot(shot_id)
        if s.image is None:
            raise edits.EditError(f"{s.shot_id} has no picture yet")
        path = Path(self.ctx["work_root"]) / s.image.path
        if not self.mirror().ensure(path):
            raise edits.EditError(f"{s.shot_id}'s picture is not available on this machine")
        with Image.open(path) as im:
            buf = io.BytesIO()
            im.convert("RGB").save(buf, "JPEG", quality=VIEW_QUALITY)
        note = f"{s.shot_id}, {edits.timecode(s.start)}-{edits.timecode(s.end)}, current picture"
        if s.repaint:
            note += " (it will be replaced when this edit is applied)"
        return [{"type": "text", "text": note},
                {"type": "image", "data": base64.b64encode(buf.getvalue()).decode(), "mimeType": "image/jpeg"}]

    # ------------------------------------------------------------- tools

    def call(self, name: str, args: dict) -> list[dict]:
        s = self.session
        before = len(s.ops)
        if name == "resolve_timecode":
            out = s.resolve_timecode(args["time"])
        elif name == "view_shot":
            return self.view(args["shot_id"])
        elif name == "set_shot_mood":
            out = s.set_shot_mood(args["shot_id"], args["mood"])
        elif name == "regenerate_shot":
            out = s.regenerate_shot(args["shot_id"], args.get("visual"))
        elif name == "edit_shot_image":
            out = s.edit_shot_image(args["shot_id"], args["instruction"], args.get("region"))
        elif name == "nudge_shot_boundary":
            out = s.nudge_shot_boundary(args["shot_id"], args["edge"], args["seconds"])
        elif name == "split_shot":
            out = s.split_shot(args["shot_id"], args.get("at"), args.get("visual"))
        elif name == "merge_shots":
            out = s.merge_shots(args["shot_id"], args.get("keep", "first"))
        elif name == "add_sound":
            out = s.add_sound(args["sound"], args.get("at"), args.get("volume", "normal"), args.get("after"))
        elif name == "remove_sound":
            out = s.remove_sound(args["sound_id"])
        else:
            raise edits.EditError(f"there is no tool {name}")
        if len(s.ops) > before:
            self.save()
        return [{"type": "text", "text": json.dumps(out, ensure_ascii=False)}]

    def save(self) -> None:
        draft = self.dir / "draft.json"
        tmp = draft.with_suffix(".partial")
        tmp.write_text(json.dumps(self.session.timeline.to_json()))
        os.replace(tmp, draft)

    def log(self, name: str, args: dict, ok: bool, result: str) -> None:
        with (self.dir / "ops.jsonl").open("a") as f:
            f.write(json.dumps({"at": time.time(), "tool": name, "args": args, "ok": ok,
                                "result": result[:500]}, ensure_ascii=False) + "\n")


def serve(session_dir: Path, stdin=sys.stdin, stdout=sys.stdout) -> None:
    server = Server(session_dir)

    def reply(mid, result=None, error=None) -> None:
        msg = {"jsonrpc": "2.0", "id": mid}
        msg.update({"error": error} if error else {"result": result})
        stdout.write(json.dumps(msg) + "\n")
        stdout.flush()

    for line in stdin:
        if not line.strip():
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        mid, method = msg.get("id"), msg.get("method")
        if mid is None:
            continue                      # a notification: nothing to answer
        params = msg.get("params") or {}
        if method == "initialize":
            reply(mid, {"protocolVersion": params.get("protocolVersion", "2025-06-18"),
                        "capabilities": {"tools": {}},
                        "serverInfo": {"name": "timeline", "version": "1"}})
        elif method == "tools/list":
            reply(mid, {"tools": TOOLS})
        elif method == "tools/call":
            name, args = params.get("name", ""), params.get("arguments") or {}
            try:
                content = server.call(name, args)
                server.log(name, args, True, " ".join(c.get("text", "[image]") for c in content))
                reply(mid, {"content": content})
            except (edits.EditError, KeyError) as exc:
                text = str(exc) if isinstance(exc, edits.EditError) else f"missing argument {exc}"
                server.log(name, args, False, text)
                reply(mid, {"content": [{"type": "text", "text": f"Not done: {text}"}], "isError": True})
        elif method == "ping":
            reply(mid, {})
        else:
            reply(mid, error={"code": -32601, "message": f"no method {method}"})


if __name__ == "__main__":
    serve(Path(sys.argv[1]))
