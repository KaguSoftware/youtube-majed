"""The timeline: the actual artifact this pipeline produces.

The video is a render of this file, not the thing itself. Every renderer, agent
and view is a pure function of it (DESIGN.md), which is what makes the Phase 4
editing page possible: "the mood at 1:24 doesn't match" mutates a field here
and re-renders the shots that changed.

Two properties are load-bearing and both are enforced below:

- **Content addressing.** A shot's image is keyed by the hash of everything
  that determines it (model, steps, resolution, guidance, seed, prompt,
  reference images). Change nothing, regenerate nothing. That is what makes a
  re-render cost one shot instead of forty minutes, and it is also why a
  killed run resumes for free.
- **Contiguity.** Shots tile the audio with no gaps and no overlaps, from 0 to
  the audio duration. A gap is a black frame; an overlap is a desync. Both are
  cheap to assert and expensive to notice in a finished video.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path

from . import config

SCHEMA_VERSION = 1

#: Tolerance for timing assertions. One frame at 30fps is 33ms; half a frame is
#: below anything a viewer can perceive and above float noise.
EPSILON = 0.016


def sha(*parts: object) -> str:
    """Stable short hash over a canonical JSON rendering of `parts`."""
    blob = json.dumps(parts, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def file_sha(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()[:16]


@dataclass
class Motion:
    """A Ken Burns move, expressed as normalized crop rectangles.

    Stored rather than computed at render time so the render is reproducible
    and so Phase 4 can nudge a move without re-deriving it.
    """

    kind: str
    zoom: str                      # "in" | "out"
    pan: str                       # "left" | "right" | "up" | "down" | "none"
    zoom_amount: float


@dataclass
class ImageRecord:
    hash: str
    path: str
    prompt: str
    seed: int
    refs: list[str]
    attempts: int = 1
    qa: dict = field(default_factory=dict)


@dataclass
class Shot:
    index: int
    shot_id: str
    beat_id: str
    start: float
    end: float
    text: str
    visual: str
    mood: str
    framing: str | None
    cites: list[str]
    prompt: str
    seed: int
    motion: Motion
    words: list[dict] = field(default_factory=list)
    image: ImageRecord | None = None
    segment: dict = field(default_factory=dict)

    @property
    def duration(self) -> float:
        """How long this shot is *visible* on screen."""
        return self.end - self.start

    @property
    def rendered_duration(self) -> float:
        """How long this shot's segment file has to be.

        One cross-dissolve longer than the visible duration. The dissolve into
        this shot is drawn from its own first `XFADE_SECONDS`, so without the
        extra tail the chain runs out of frames and the film ends short — see
        the arithmetic in assemble.py. The first shot's tail goes unused, which
        costs a fraction of a second of encoding and keeps every segment
        rendered by the same rule.
        """
        return self.duration + config.XFADE_SECONDS


@dataclass
class Timeline:
    project: str
    topic: str
    target_duration: float
    duration: float
    audio: dict
    style: dict
    render: dict
    models: dict
    upstream: dict
    shots: list[Shot]
    schema: int = SCHEMA_VERSION
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    validation: dict = field(default_factory=lambda: {"errors": [], "warnings": []})

    # -- serialisation ------------------------------------------------

    def to_json(self) -> dict:
        def clean(o):
            if isinstance(o, float):
                return round(o, 4)
            if isinstance(o, dict):
                return {k: clean(v) for k, v in o.items()}
            if isinstance(o, list):
                return [clean(v) for v in o]
            return o

        d = asdict(self)
        d["shots"] = [
            {**clean(asdict(s)), "duration": round(s.duration, 4)} for s in self.shots
        ]
        return clean(d)

    def write(self, path: Path) -> None:
        """Serialize, re-validating first.

        The validation block is recomputed on every write rather than carried
        forward, because the timeline is written three times during a run — after
        planning, after images, after render — and each write describes more
        state than the last. Reusing the planning-time report left a finished
        timeline claiming every shot had "no image yet", which is worse than no
        report at all: this file is meant to fully describe the video, and
        anything reading it would have believed that.
        """
        errors, warnings = self.validate()
        self.validation = {"errors": errors, "warnings": warnings}
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_json(), indent=2) + "\n")

    # -- validation ---------------------------------------------------

    def validate(self) -> tuple[list[str], list[str]]:
        """Everything that must be true for this timeline to render correctly."""
        errors: list[str] = []
        warnings: list[str] = []

        if not self.shots:
            return ["timeline has no shots"], []

        if abs(self.shots[0].start) > EPSILON:
            errors.append(f"first shot starts at {self.shots[0].start:.3f}s, not 0")

        for a, b in zip(self.shots, self.shots[1:]):
            if abs(b.start - a.end) > EPSILON:
                errors.append(
                    f"{a.shot_id}->{b.shot_id}: "
                    f"{'gap' if b.start > a.end else 'overlap'} of "
                    f"{abs(b.start - a.end) * 1000:.0f}ms at {a.end:.3f}s"
                )

        last = self.shots[-1].end
        if abs(last - self.duration) > EPSILON:
            errors.append(
                f"last shot ends at {last:.3f}s but the audio is {self.duration:.3f}s — "
                "the video would end on a frozen frame or cut the narration off"
            )

        for s in self.shots:
            if s.duration <= 0:
                errors.append(f"{s.shot_id}: non-positive duration {s.duration:.3f}s")
            elif s.duration < config.MIN_SHOT_SECONDS:
                warnings.append(
                    f"{s.shot_id}: {s.duration:.2f}s is under the "
                    f"{config.MIN_SHOT_SECONDS}s minimum and will read as a flicker"
                )
            if s.duration <= config.XFADE_SECONDS:
                errors.append(
                    f"{s.shot_id}: {s.duration:.2f}s is not longer than the "
                    f"{config.XFADE_SECONDS}s cross-dissolve, so it would never be "
                    "fully visible"
                )
            if not s.prompt.strip():
                errors.append(f"{s.shot_id}: empty prompt")
            if s.image is None:
                warnings.append(f"{s.shot_id}: no image yet")

        # Identical prompts produce identical images, which is the
        # near-duplicate failure before a single pixel is generated.
        by_prompt: dict[str, list[str]] = {}
        for s in self.shots:
            by_prompt.setdefault(sha(s.prompt, s.seed), []).append(s.shot_id)
        for dupes in by_prompt.values():
            if len(dupes) > 1:
                errors.append(
                    f"shots {dupes} share a prompt and seed and would generate the "
                    "same image"
                )

        # Even dimensions, or ffmpeg's encoders reject the stream (failure 11).
        for key in ("width", "height"):
            if self.render[key] % 2:
                errors.append(f"render {key}={self.render[key]} is odd; ffmpeg needs even dimensions")

        return errors, warnings

    def assert_valid(self) -> None:
        errors, warnings = self.validate()
        self.validation = {"errors": errors, "warnings": warnings}
        if errors:
            raise RuntimeError(
                "timeline is not renderable:\n" + "\n".join(f"  - {e}" for e in errors)
            )


def image_hash(
    prompt: str,
    seed: int,
    refs: list[Path],
    *,
    model: str = config.IMAGE_MODEL,
    steps: int = config.GEN_STEPS,
    width: int = config.GEN_WIDTH,
    height: int = config.GEN_HEIGHT,
    guidance: float = config.GEN_GUIDANCE,
) -> str:
    """The content address of a generated image.

    Every input that changes the output is in here, including the *contents* of
    the reference images — swapping the hero crop must invalidate every shot,
    and keying on the filename would not.
    """
    return sha(
        "img-v1", model, steps, width, height, guidance, seed, prompt,
        [file_sha(r) for r in refs],
    )


def upstream_hashes(script_path: Path, research_path: Path, style) -> dict:
    """The staleness keys from DESIGN.md.

    `timeline <- hash(script.md, style)` is the one that matters here: when the
    script or the style changes, this timeline is stale and must not be reused
    silently.
    """
    style_sha = sha(
        style.style_id, style.preset, style.prompt_prefix, style.seed,
        file_sha(style.hero_crop),
    )
    return {
        "research_sha": file_sha(research_path),
        "script_sha": file_sha(script_path),
        "style_sha": style_sha,
        "timeline_sha": sha(file_sha(script_path), style_sha),
    }
