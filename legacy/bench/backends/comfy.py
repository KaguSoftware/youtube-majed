"""ComfyUI over its HTTP API.

Kept in the bake-off for two reasons, neither of which is FLUX.2 klein:
native ComfyUI klein support on macOS MPS is not verified, so this backend is
mainly how we benchmark SDXL and FLUX.1-schnell as fallbacks, and how we would
drive a remote GPU box later without changing the pipeline's contract.

Weights live in the server, so the model is already warm when we connect.
Cold-load time measured here is connection time, not weight-load time, and the
report labels it as such rather than pretending the two are comparable.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from .base import Backend


class ComfyBackend(Backend):
    name = "comfyui"

    def __init__(
        self,
        workflow_path: str | Path,
        server: str = "127.0.0.1:8188",
        poll_interval: float = 0.4,
        timeout: float = 1800.0,
    ) -> None:
        super().__init__()
        self.server = server.rstrip("/")
        self.workflow_path = Path(workflow_path)
        self.poll_interval = poll_interval
        self.timeout = timeout
        self._workflow: dict | None = None
        self._client_id = str(uuid.uuid4())

    # -- http ---------------------------------------------------------

    def _url(self, path: str) -> str:
        return f"http://{self.server}{path}"

    def _get(self, path: str, timeout: float = 10.0) -> dict:
        with urllib.request.urlopen(self._url(path), timeout=timeout) as resp:
            return json.loads(resp.read().decode())

    def _post(self, path: str, payload: dict, timeout: float = 30.0) -> dict:
        req = urllib.request.Request(
            self._url(path),
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())

    # -- lifecycle ----------------------------------------------------

    def preflight(self) -> tuple[bool, str]:
        if not self.workflow_path.exists():
            return False, f"workflow not found: {self.workflow_path}"
        try:
            self._get("/system_stats", timeout=5)
        except (urllib.error.URLError, OSError, TimeoutError) as exc:
            return False, f"ComfyUI unreachable at {self.server}: {exc}"
        return True, "ok"

    def load(self, config) -> None:
        ok, msg = self.preflight()
        if not ok:
            raise RuntimeError(msg)
        self._workflow = json.loads(self.workflow_path.read_text())

    def pids(self) -> list[int]:
        """Watch the server process so peak memory covers the real consumer."""
        import subprocess

        try:
            out = subprocess.run(
                ["pgrep", "-f", "ComfyUI/main.py"],
                capture_output=True, text=True, timeout=5,
            ).stdout
        except (OSError, subprocess.SubprocessError):
            return []
        return [int(p) for p in out.split() if p.strip().isdigit()]

    # -- work ---------------------------------------------------------

    def _patch(self, prompt: str, config) -> dict:
        """Apply prompt and dimensions to nodes tagged in the workflow JSON.

        Tagging by `_bench_role` in `_meta` keeps the harness from guessing at
        node ids, which differ between workflows and silently break when a
        workflow is re-exported.
        """
        wf = json.loads(json.dumps(self._workflow))  # deep copy per request
        patched = set()
        for node in wf.values():
            role = (node.get("_meta") or {}).get("_bench_role")
            inputs = node.setdefault("inputs", {})
            if role == "prompt":
                inputs["text"] = prompt
                patched.add("prompt")
            elif role == "latent":
                inputs["width"] = config.width
                inputs["height"] = config.height
                patched.add("latent")
            elif role == "sampler":
                inputs["steps"] = config.steps
                inputs["seed"] = 88412
                patched.add("sampler")

        missing = {"prompt", "latent", "sampler"} - patched
        if missing:
            raise RuntimeError(
                f"workflow {self.workflow_path.name} has no nodes tagged "
                f"_bench_role for: {sorted(missing)}"
            )
        return wf

    def generate(self, prompt: str, dest: Path, config) -> None:
        if self._workflow is None:
            raise RuntimeError("generate() before load()")

        resp = self._post(
            "/prompt",
            {"prompt": self._patch(prompt, config), "client_id": self._client_id},
        )
        prompt_id = resp.get("prompt_id")
        if not prompt_id:
            raise RuntimeError(f"ComfyUI rejected the job: {resp}")

        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            history = self._get(f"/history/{prompt_id}")
            entry = history.get(prompt_id)
            if entry:
                status = (entry.get("status") or {}).get("status_str")
                if status == "error":
                    raise RuntimeError(f"ComfyUI job failed: {entry.get('status')}")
                images = [
                    img
                    for out in entry.get("outputs", {}).values()
                    for img in out.get("images", [])
                ]
                if images:
                    self._fetch_image(images[0], dest)
                    return
            time.sleep(self.poll_interval)

        raise TimeoutError(f"ComfyUI job {prompt_id} exceeded {self.timeout}s")

    def _fetch_image(self, image: dict, dest: Path) -> None:
        from urllib.parse import urlencode

        query = urlencode(
            {
                "filename": image.get("filename", ""),
                "subfolder": image.get("subfolder", ""),
                "type": image.get("type", "output"),
            }
        )
        dest.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(self._url(f"/view?{query}"), timeout=120) as resp:
            dest.write_bytes(resp.read())
        if dest.stat().st_size == 0:
            raise RuntimeError("ComfyUI returned an empty image")
