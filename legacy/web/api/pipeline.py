"""The pipeline's Python, as a Vercel function: validation and prompts.

It runs pipeline/webapi.py itself rather than a TypeScript port, so the studio
and the worker can never disagree about what a valid research.md or script.md
is, or about what Claude is asked. Only the Next.js server calls it, with the
shared INTERNAL_API_KEY: the proxy does not run in front of Python functions,
so this checks its own caller.
"""

import hmac
import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path


def _find_repo() -> Path:
    # web/pyshared/pipeline is copied in at build time (scripts/vendor-pipeline.mjs):
    # Vercel bundles only web/. Locally the repo's own pipeline/ is a parent.
    here = Path(__file__).parent
    for base in (here.parent / "pyshared", *here.resolve().parents):
        if (base / "pipeline" / "webapi.py").is_file():
            return base
    raise RuntimeError("pipeline/webapi.py is not in the function bundle; have: "
                       + ", ".join(sorted(p.name for p in here.parent.iterdir())))


sys.path.insert(0, str(_find_repo()))
from pipeline import webapi  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:
        key = os.environ.get("INTERNAL_API_KEY", "")
        if not key or not hmac.compare_digest(key, self.headers.get("x-internal-key", "")):
            return self._send(401, {"error": "unauthorized"})
        length = int(self.headers.get("content-length") or 0)
        if length > webapi.MAX_DOCUMENT * 2:
            return self._send(413, {"error": "request too large"})
        try:
            return self._send(200, webapi.handle(json.loads(self.rfile.read(length) or b"{}")))
        except (KeyError, ValueError, TypeError) as exc:
            return self._send(400, {"error": f"bad request: {exc}"})
