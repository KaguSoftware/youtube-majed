"""What the web app asks of the pipeline's Python, in one place.

The Vercel function (web/api/pipeline.py) and local development
(`python -m pipeline.webapi`, JSON on stdin) both call `handle`, so the
studio validates and builds prompts with exactly the code the worker runs:

    {"action": "check", "kind": "research"|"script", "markdown": ..., "research_markdown"?,
     "verify_sources"?}                       -> docs.check verdict
    {"action": "prompt", "kind": ..., "project": {id, topic, angle, target_duration},
     "research_markdown"?, "note"?}           -> {"system", "prompt"} as the worker would send
    {"action": "publish_draft", "project": {topic, angle}, "research_markdown"?, "credits"?}
                                              -> {"title", "description", "tags", "sources"}
    {"action": "publish_check", "meta": {title, description, tags, privacy}}
                                              -> {"errors": [...]}, as the worker judges it

Only stdlib + PyYAML may be imported from here: the function bundle has
nothing else.
"""

from __future__ import annotations

import json
import sys

from . import docs, publish, writer

MAX_DOCUMENT = 512 * 1024


def handle(req: dict) -> dict:
    action = req.get("action", "check")
    if action == "publish_draft":
        return publish.draft(req["project"], req.get("research_markdown"), req.get("credits") or [])
    if action == "publish_check":
        return {"errors": publish.check(req["meta"])}
    kind = req["kind"]
    if kind not in ("research", "script"):
        raise ValueError(f"unknown kind {kind!r}")
    if action == "check":
        markdown = str(req["markdown"])
        if len(markdown.encode()) > MAX_DOCUMENT:
            raise ValueError(f"document over {MAX_DOCUMENT // 1024} KB")
        return docs.check(kind, markdown, research_markdown=req.get("research_markdown"),
                          verify_sources=bool(req.get("verify_sources", False)))
    if action == "prompt":
        project = req["project"]
        if kind == "research":
            system, prompt = writer.research_prompt(project, req.get("note"))
        else:
            system, prompt = writer.script_prompt(project, req["research_markdown"], req.get("note"))
        return {"system": system, "prompt": prompt}
    raise ValueError(f"unknown action {action!r}")


def main() -> int:
    try:
        print(json.dumps(handle(json.load(sys.stdin))))
        return 0
    except (KeyError, ValueError, TypeError) as exc:
        print(json.dumps({"error": f"bad request: {exc}"}))
        return 2


if __name__ == "__main__":
    sys.exit(main())
