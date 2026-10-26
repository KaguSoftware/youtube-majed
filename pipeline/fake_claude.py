"""A stand-in for `claude -p`, for the queue test. No network, no account.

Reads the prompt on stdin and prints what the real CLI prints with
`--output-format json`: a research document built from the Phase 1 fixture
(with URL sources in place of the FIXTURE sentinel), or the fixture script.

FAKE_CLAUDE_MODE picks the behaviour:
    ok       a well-formed document (default)
    limit    the usage-limit error a subscription returns
    garbage  a reply with no usable document
    slow     ok, after FAKE_CLAUDE_DELAY seconds (for shutdown tests)
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def research_doc() -> str:
    text = (FIXTURES / "barbarians-01.research.md").read_text()
    text = re.sub(r"<!--.*?-->\n*", "", text, flags=re.S)
    n = iter(range(1, 1000))
    return re.sub(r"source: FIXTURE", lambda _: f"source: https://example.org/source/{next(n)}", text)


def main() -> int:
    prompt = sys.stdin.read()
    mode = os.environ.get("FAKE_CLAUDE_MODE", "ok")
    if mode == "slow":
        time.sleep(float(os.environ.get("FAKE_CLAUDE_DELAY", "30")))
    if mode == "limit":
        print(json.dumps({"type": "result", "subtype": "error", "is_error": True,
                          "api_error_status": 429,
                          "result": "Claude usage limit reached. Your limit will reset at 6pm."}))
        return 1
    if mode == "garbage":
        body = "I could not find enough sources to write this."
    elif "Write the narration script" in prompt:
        body = "```markdown\n" + (FIXTURES / "barbarians-01.script.md").read_text() + "```"
    else:
        body = "Here is the research.\n\n```markdown\n" + research_doc() + "```\n\nSources: example.org"
    print(json.dumps({"type": "result", "subtype": "success", "is_error": False, "result": body,
                      "num_turns": 3, "duration_ms": 1200, "total_cost_usd": 0.0,
                      "session_id": "fake", "prompt_chars": len(prompt)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
