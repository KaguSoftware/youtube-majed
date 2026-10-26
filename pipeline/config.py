"""The locked Phase 1 configuration.

Every value here was measured in Phase 0 or is a documented constraint, not a
default someone liked the look of. PLAN.md section numbers are cited inline
because the reason for a number outlives the number.

Nothing in this file is user-tunable from the CLI except where `run.py`
explicitly exposes it. Phase 2 moves these into the `styles` table and the job
payload; until then a module of constants is the honest representation of
"hardcoded style".
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

REPO = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------- image model

#: Pre-quantized 4-bit klein 4B. 4.30 GB against 22.11 GB for the bf16 base,
#: already quantized so there is no load-time quantize step (PLAN 8.1).
#: Apache 2.0, verified on both mirrors via the HF API. The repository, the
#: commit it loads from and its file hashes live in `pins.MODELS` (Phase 5);
#: this is mflux's name for the architecture.
IMAGE_BASE_MODEL = "flux2-klein-4b"

#: 832x480 is 4.7x faster than 1024^2 and the only resolution that held a flat
#: rate across a sustained run; the large ones generate gigabytes of swap and
#: get *worse* on AC power (PLAN 8.8, 8.9). Output is Ken-Burns-panned inside a
#: 1080p frame, so native 1024^2 buys nothing an upscale does not.
GEN_WIDTH = 832
GEN_HEIGHT = 480

#: klein's distilled checkpoints are trained for 4 steps and *require*
#: guidance 1.0 — mflux exits with an error on any other value. There is no
#: temperature and no negative branch. Do not try to tune these (PLAN 8.11).
GEN_STEPS = 4
GEN_GUIDANCE = 1.0

#: Measured medians per image on this machine, warm, int4, 4 steps:
#:   no reference          13.3s
#:   full-scene reference  19.1s
#:   character crop        15.3s   <- what we run
#: Used only to print an honest ETA before a run commits 15 minutes.
SECONDS_PER_IMAGE_ESTIMATE = 15.3

# ---------------------------------------------------------------------- audio

#: Kokoro-82M, Apache 2.0 (PLAN 1.4). Abstract voice ids keep TTS behind an
#: interface so ElevenLabs can be swapped in without touching the script
#: contract (PLAN section 6, open risk 4).
TTS_SAMPLE_RATE = 24_000

#: wav2vec2 CTC acoustic model, Apache 2.0 and ungated, used for *both* forced
#: alignment and the ASR cross-check — one forward pass serves both.
#:
#: Deliberately not MMS: `ctc-forced-aligner`'s default model is MMS, which is
#: CC-BY-NC-4.0 (verified via the HF API) and would be a licensing incident
#: under PLAN 1.6. The LibriSpeech wav2vec2 models are apache-2.0. Pinned,
#: with the other two models, in `pins.MODELS`.
ALIGN_SAMPLE_RATE = 16_000

#: Failure mode 1: TTS silently dropping a word desyncs everything downstream
#: while the video still looks fine. We ASR the generated audio and diff it
#: against the script we wrote.
#:
#: The threshold has to absorb the acoustic model's own error rate, not just
#: TTS error. wav2vec2-base-960h greedy-decodes without a language model, and
#: this script is full of exactly what hurts that most — `byred`, `woad`,
#: `madder`, `quern`. So this gate catches dropped and mangled *spans*, not
#: individual rare words. Tightening it below the measured floor would make it
#: fire on correct audio, which is how a safety gate gets switched off.
MAX_WER = 0.18

#: The sharper half of the gate. Measured on this script: the acoustic model
#: produced *zero* deletions across all six beats, while generating plenty of
#: substitutions and compound splits. So a deletion is a specific signal rather
#: than part of the noise floor, and one is worth failing over — which is not
#: true of a WER point, since one dropped word in a 26-word beat moves WER by
#: under four points. See align.py for why the zero-length-word check matters
#: even more than this one.
MAX_DELETIONS_PER_BEAT = 0

# ------------------------------------------------------------------ shot plan

#: Phase 1 target. A beat is 1-3 shots (DESIGN.md); the planner distributes
#: this budget across beats by measured duration, so the count is exact.
TARGET_SHOTS = 10
MIN_SHOTS_PER_BEAT = 1
MAX_SHOTS_PER_BEAT = 3

#: A shot shorter than this reads as a flicker rather than an image.
MIN_SHOT_SECONDS = 2.0

# --------------------------------------------------------------------- render

OUT_WIDTH = 1920
OUT_HEIGHT = 1080
FPS = 30

#: Cross-dissolve length. The stitcher compensates for it exactly, so this
#: does not shorten the film or drift the audio (see assemble.py).
XFADE_SECONDS = 0.4

#: Ken Burns. Generated stills are upscaled before the pan so the zoom has real
#: pixels to work with rather than interpolating 832x480 up to 1080p.
KENBURNS_UPSCALE = 2.5
KENBURNS_ZOOM = 0.12

# ------------------------------------------------------------------- hardware

#: An unplugged worker stops mid-batch: mflux's --battery-percentage-stop-limit
#: defaults to 5% (PLAN 8.6). Battery was *not* the cause of the large-res
#: slowdown (8.9) but this hard stop is real regardless.
BATTERY_STOP_PERCENT = 15


@dataclass(frozen=True)
class Style:
    """A locked style record. Phase 3 reads this from the `styles` table.

    `hero_crop` is the reference every shot conditions on. It is a *character*
    crop — face, beard, cloak, no background. Conditioning on the full frame
    makes the model reproduce the hero's scene, so shots near that setting come
    back as near-duplicates with the prompt ignored; the crop fixes it outright
    and is ~20% cheaper because reference cost scales with reference area
    (PLAN 8.11, DESIGN.md "Stage: style").

    There is no strength dial to fall back on. `image_strength` is a no-op on
    this path: references are injected as attention tokens, not as a noised
    init image. Reference influence is architectural and always fully on.
    """

    style_id: str
    preset: str
    prompt_prefix: str
    seed: int
    hero_full: Path
    hero_crop: Path
    crop_box: tuple[float, float, float, float]

    def to_record(self) -> dict:
        """The `styles.preset_json` form. A reference is either a repo-relative
        path (the Phase 1 library style) or a media key such as
        `refs/<sha>.png`, which the worker fetches through its mirror."""
        def rel(p: Path) -> str:
            return str(p.relative_to(REPO)) if p.is_relative_to(REPO) else str(p)

        return {
            "preset": self.preset, "prompt_prefix": self.prompt_prefix, "seed": self.seed,
            "hero_full": rel(self.hero_full), "hero_crop": rel(self.hero_crop),
            "crop_box": list(self.crop_box),
        }

    @classmethod
    def from_record(cls, style_id: str, d: dict,
                    resolve: Callable[[str], Path] | None = None) -> "Style":
        """`resolve` turns a stored reference into a local file; the default
        reads it as repo-relative, which is all the CLI slice needs."""
        resolve = resolve or (lambda ref: REPO / ref)
        return cls(
            style_id=style_id, preset=d["preset"], prompt_prefix=d["prompt_prefix"],
            seed=int(d["seed"]), hero_full=resolve(d["hero_full"]),
            hero_crop=resolve(d["hero_crop"]), crop_box=tuple(d["crop_box"]),
        )

    def prompt_for(self, visual: str, mood: str, framing: str | None = None,
                   period: str | None = None, protagonist: tuple[str, str] | None = None) -> str:
        """prefix, period, visual, framing, mood.

        The period (script front matter) anchors every image in place and time:
        without it "a soldier" came back in a brimmed hat and 19th-century work
        clothes. It is not enough on its own: with it, "the auxiliary Victor"
        still came back in First World War helmets under an electric bulb.
        Naming the equipment fixed it ("a mail shirt, a bronze Roman helmet with
        cheek guards", "a clay oil lamp"). So the script declares its
        protagonist's look once, and every visual that names the protagonist
        has that description spliced in after the name (Phase 3, measured on the
        first real look candidates; PLAN.md 11).
        """
        if protagonist and protagonist[0] and protagonist[1]:
            name, look = protagonist
            look = look.strip().rstrip(",")
            # Spliced after the first plain mention; a possessive ("the
            # farmer's hands") cannot take an apposition, so the description
            # goes at the end of the visual instead.
            plain = re.compile(rf"\b{re.escape(name)}\b(?!['\u2019]s)")
            if plain.search(visual):
                visual = plain.sub(f"{name}, {look},", visual, count=1)
            elif re.search(rf"\b{re.escape(name)}\b", visual):
                visual = f"{visual.rstrip(', ')}, {name}: {look}"
        style = style_text(self.prompt_prefix)
        parts = [style, (period or "").strip(), visual.strip()]
        if framing:
            parts.append(framing)
        parts.append(mood.strip())
        # The style again, last. One phrase at the front of a 500-character
        # prompt is outvoted by everything after it: on the Aztec film the
        # shots with no character in them came back as photographs.
        if style:
            parts.append(f"all of it as {style}")
        prompt = ", ".join(p.strip(", ") for p in parts if p and p.strip(", "))
        return re.sub(r"\s*,(\s*,)+", ",", prompt)


def style_text(prefix: str) -> str:
    """A look description as the image model can use it: a description of the
    medium, not an instruction. The model does not take orders, so a user's
    "make it stick figure doodles" is kept as "stick figure doodles"."""
    text = prefix.strip().rstrip(",. ")
    text = re.sub(r"^(please\s+)?(make|turn|render|draw|paint|do)\s+(it|this|them|everything|the\s+film)?\s*(look\s+)?(like|as|into|in)?\s*",
                  "", text, flags=re.I)
    return text.strip(" ,.")


#: The hardcoded Phase 1 style. The hero crop is the one validated in Phase 0 —
#: a bearded man in a fur-trimmed wool cloak over a green under-layer — which
#: is why the fixture script is about a northern settlement. Reusing a proven
#: reference keeps Phase 1 measuring the pipeline, not the art direction.
PHASE1_STYLE = Style(
    style_id="sty_phase1",
    preset="dark-oil-painting",
    prompt_prefix=(
        "dark oil painting, heavy impasto, chiaroscuro, muted earth palette, "
        "cinematic documentary still,"
    ),
    seed=88412,
    hero_full=REPO / "bench" / "refs" / "hero.png",
    hero_crop=REPO / "bench" / "refs" / "hero_crop.png",
    crop_box=(0.22, 0.0, 0.70, 1.0),
)


def partial(dest: Path) -> Path:
    """Where to write `dest` before it is complete.

    Every cache here treats "the file exists and is non-empty" as "this work is
    done", which is what makes a killed run resume for free. It also means a
    process killed *mid-write* would leave a non-empty half-file that the next
    run trusts — a truncated PNG or an mp4 without its index, read back as a
    finished shot. So nothing is written to its final name directly: it is
    written here and `os.replace`d into place, which is atomic on one volume.
    The suffix is kept because ffmpeg and PIL pick the format from it.
    """
    return dest.with_name(f".{dest.stem}.partial{dest.suffix}")


@dataclass
class Paths:
    """Where a run puts things.

    Split into `cache` (content-addressed, survives runs, safe to reuse) and
    `work` (per-run scratch). `mirror` puts a remote store behind the cache
    (media.py); without one it is the local cache alone, as in Phase 2.
    """

    root: Path
    project: str
    mirror: "object | None" = None

    def __post_init__(self) -> None:
        from .media import Mirror

        self.run = self.root / self.project
        self.cache = self.root / "cache"
        self.images = self.cache / "images"
        self.segments = self.cache / "segments"
        for d in (self.run, self.images, self.segments):
            d.mkdir(parents=True, exist_ok=True)
        if self.mirror is None:
            self.mirror = Mirror(self.cache)

    @property
    def audio(self) -> Path:
        return self.run / "narration.wav"

    @property
    def timeline(self) -> Path:
        return self.run / "timeline.json"

    @property
    def alignment(self) -> Path:
        return self.run / "alignment.json"

    @property
    def video(self) -> Path:
        return self.run / "out.mp4"
