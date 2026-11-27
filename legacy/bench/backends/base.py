"""Backend contract for the Phase 0 bake-off.

Every backend sees the same prompts, the same resolution and the same step
count, because otherwise the comparison measures the configuration rather
than the runtime.

Two shapes are supported deliberately. In-process backends (MLX) are
fastest and expose real peak-memory numbers. Subprocess backends exist
because several MLX FLUX implementations ship a CLI and no stable Python
API, and a CLI we can call today beats an import we have to wait for.
"""

from __future__ import annotations

import re
import shlex
import subprocess
import time
from abc import ABC, abstractmethod
from pathlib import Path

PROMPTS_FILE = Path(__file__).resolve().parent.parent / "prompts" / "shots.txt"


def load_prompts(path: str | Path | None = None) -> list[str]:
    """Load a prompt set. Defaults to the shot list.

    A consistency run needs the same character described across different
    scenes, which is a different question from the general shot list, so the
    file is selectable rather than hardcoded.
    """
    src = Path(path) if path else PROMPTS_FILE
    if not src.is_absolute() and not src.exists():
        src = PROMPTS_FILE.parent / src.name
    lines = [
        ln.strip()
        for ln in src.read_text().splitlines()
        if ln.strip() and not ln.startswith("#")
    ]
    if not lines:
        raise RuntimeError(f"no prompts found in {src}")
    return lines


class Backend(ABC):
    """One image-generation runtime under test."""

    name: str = "unnamed"

    def __init__(self, prompts_file: str | Path | None = None) -> None:
        self._prompts = load_prompts(prompts_file)

    # -- lifecycle ----------------------------------------------------

    @abstractmethod
    def load(self, config) -> None:
        """Load weights. Timed separately as cold-load, never as per-image."""

    def unload(self) -> None:
        """Release weights. Best-effort."""

    # -- work ---------------------------------------------------------

    @abstractmethod
    def generate(self, prompt: str, dest: Path, config) -> None:
        """Generate one image to `dest`. Must raise on failure."""

    def prompt_for(self, index: int) -> str:
        """Cycle the shot list so each config sees the same prompt order."""
        return self._prompts[index % len(self._prompts)]

    # -- introspection ------------------------------------------------

    def peak_memory_mb(self) -> float | None:
        """Backend-reported peak, if it knows better than `ps` does."""
        return None

    def pids(self) -> list[int]:
        """Extra pids the sampler should watch (servers, children)."""
        return []

    def preflight(self) -> tuple[bool, str]:
        """Cheap availability check so a missing backend skips, not crashes."""
        return True, "ok"


class SubprocessBackend(Backend):
    """Runs a CLI per image.

    Pays process startup on every image, which is exactly the cost the
    plan warns about, so the harness reports it honestly rather than
    hiding it: compare this against an in-process backend to see what
    keeping the model warm is actually worth.
    """

    #: template with {prompt} {dest} {width} {height} {steps} {quant}
    command_template: str = ""

    def __init__(self, command_template: str | None = None, prompts_file=None) -> None:
        super().__init__(prompts_file)
        if command_template:
            self.command_template = command_template
        self._last_stderr = ""

    def load(self, config) -> None:
        ok, msg = self.preflight()
        if not ok:
            raise RuntimeError(msg)

    def build_command(self, prompt: str, dest: Path, config) -> list[str]:
        if not self.command_template:
            raise RuntimeError(f"{self.name}: no command_template configured")
        rendered = self.command_template.format(
            prompt=shlex.quote(prompt),
            dest=shlex.quote(str(dest)),
            width=config.width,
            height=config.height,
            steps=config.steps,
            quant=config.quant,
        )
        return shlex.split(rendered)

    def generate(self, prompt: str, dest: Path, config) -> None:
        cmd = self.build_command(prompt, dest, config)
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
        self._last_stderr = (proc.stderr or "")[-2000:]
        if proc.returncode != 0:
            raise RuntimeError(
                f"{self.name} exited {proc.returncode}: {self._last_stderr.strip()[:400]}"
            )
        if not dest.exists() or dest.stat().st_size == 0:
            raise RuntimeError(f"{self.name} reported success but wrote no image")

    def peak_memory_mb(self) -> float | None:
        """Scrape a peak-memory line from the CLI's own output, if present."""
        m = re.search(r"peak\s*mem(?:ory)?[:=]\s*([\d.]+)\s*(gb|mb)", self._last_stderr, re.I)
        if not m:
            return None
        val = float(m.group(1))
        return val * 1024 if m.group(2).lower() == "gb" else val
