"""Per-image QA: is this image usable, and is it actually a *different* image?

PLAN.md risk 2 is specific and was learned the expensive way: Phase 0 produced
technically perfect images that were useless because they reproduced the
reference. The benchmark reported 19.09s and PASS while generating near-
duplicate frames. A QA step that only looks for artefacts would have passed
them too.

So there are two checks, and the second is the one that was missing:

1. **Artefact / blur.** Variance of the Laplacian, plus flat-frame and
   blown-exposure detection. Catches a failed generation outright.
2. **Near-duplicate.** A perceptual hash compared against the hero reference
   *and* against every shot already generated. A shot that comes back as a copy
   of the reference means the prompt was ignored; a shot that matches an
   earlier shot means the film repeats itself. Both are silent failures in any
   metric that only measures one image at a time.

The response to a failure is a reroll on a new seed, up to a limit, then a
flag. Not an abort: one bad shot out of ten should not cost the other nine.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image

#: Below this, the frame has no edge content worth calling an image.
MIN_LAPLACIAN_VARIANCE = 60.0

#: A frame whose pixels barely vary is a flat fill, not a picture.
MIN_PIXEL_STD = 12.0

#: Hamming distance on a 64-bit dHash.
#:
#: Calibrated against labelled Phase 0 output rather than picked by feel, which
#: matters because Phase 0 has both a known-bad and a known-good arm:
#:
#:   known bad   full-scene reference, shot 3   distance  0 from the hero frame
#:               (the "reproduced the hero frame" case in PLAN.md 8.11)
#:               full-scene reference, shot 5   distance  9
#:               image_strength sweep 0.15/0.25/0.35, all six shots
#:               distance  0 from each other ("byte-different, perceptually
#:               identical" — the no-op confirmed in 8.11)
#:   known good  character-crop reference, six shots
#:               distance 27-36 from the hero crop, 17 minimum pairwise
#:
#: So the bad cases sit at 0-9 and the good ones at 17+, with nothing between.
#: 8 separates them with margin on both sides; 14 flags the partially-adapted
#: middle without failing it.
DUPLICATE_DISTANCE = 8
SIMILAR_DISTANCE = 14


@dataclass
class ImageQA:
    ok: bool
    phash: str
    laplacian: float
    pixel_std: float
    nearest: str | None = None
    nearest_distance: int | None = None
    failures: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_json(self) -> dict:
        return {
            "ok": self.ok,
            "phash": self.phash,
            "laplacian": round(self.laplacian, 1),
            "pixel_std": round(self.pixel_std, 1),
            "nearest": self.nearest,
            "nearest_distance": self.nearest_distance,
            "failures": self.failures,
            "warnings": self.warnings,
        }


def _gray(path: Path) -> np.ndarray:
    with Image.open(path) as im:
        return np.asarray(im.convert("L"), dtype=np.float64)


def dhash(path: Path, size: int = 8) -> int:
    """Difference hash: 64 bits of "is each pixel brighter than its neighbour".

    Chosen over an average hash because it responds to structure rather than
    overall brightness, so two shots that differ only in grading do not read as
    different images — which is exactly the mistake we are trying to catch.
    """
    with Image.open(path) as im:
        small = im.convert("L").resize((size + 1, size), Image.Resampling.LANCZOS)
    a = np.asarray(small, dtype=np.int16)
    bits = (a[:, 1:] > a[:, :-1]).flatten()
    out = 0
    for b in bits:
        out = (out << 1) | int(b)
    return out


def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def laplacian_variance(gray: np.ndarray) -> float:
    """Edge energy. The standard cheap sharpness proxy, as a 4-neighbour sum."""
    lap = (
        -4.0 * gray[1:-1, 1:-1]
        + gray[:-2, 1:-1] + gray[2:, 1:-1]
        + gray[1:-1, :-2] + gray[1:-1, 2:]
    )
    return float(lap.var())


def inspect(
    path: Path,
    *,
    reference: Path | None = None,
    others: dict[str, int] | None = None,
    adjacent: dict[str, int] | None = None,
    adjacent_limits: dict[str, int] | None = None,
) -> ImageQA:
    """Check one generated image. `others`/`adjacent` map shot_id -> dhash.

    `adjacent` is held to the stricter `SIMILAR_DISTANCE`, because proximity
    changes what similarity means. Two images 30 seconds apart that share a
    palette and a subject read as a motif; the same pair back to back reads as
    a video that has stopped. The first Phase 1 run made this concrete — S03/S04
    at distance 11 and S06/S07 at distance 9 both passed the duplicate check and
    both play as one held image for ten seconds.

    `adjacent_limits` lowers the adjacent limit per neighbour. An edit uses it
    to hold a repaint to the picture it replaces rather than to the absolute
    rule: two shots of one beat can sit at 12 because the film was made that
    way, and rerolling an edit three times to beat a likeness the original
    already had cost 68 s of a 99 s edit (PLAN.md 12.6).
    """
    gray = _gray(path)
    lap = laplacian_variance(gray)
    std = float(gray.std())
    h = dhash(path)

    qa = ImageQA(ok=True, phash=f"{h:016x}", laplacian=lap, pixel_std=std)

    if lap < MIN_LAPLACIAN_VARIANCE:
        qa.failures.append(f"blurred or empty: laplacian variance {lap:.0f} < {MIN_LAPLACIAN_VARIANCE:.0f}")
    if std < MIN_PIXEL_STD:
        qa.failures.append(f"flat frame: pixel std {std:.1f} < {MIN_PIXEL_STD:.1f}")
    if gray.mean() > 250 or gray.mean() < 5:
        qa.failures.append(f"exposure collapsed: mean level {gray.mean():.0f}")

    # (name, distance, limit) — the limit is what counts as too close *for that
    # relationship*, so a neighbour is judged more strictly than a distant shot.
    candidates: list[tuple[str, int, int]] = []
    if reference is not None:
        candidates.append(("hero_reference", hamming(h, dhash(reference)), DUPLICATE_DISTANCE))
    for shot_id, other in (others or {}).items():
        candidates.append((shot_id, hamming(h, other), DUPLICATE_DISTANCE))
    for shot_id, other in (adjacent or {}).items():
        limit = (adjacent_limits or {}).get(shot_id, SIMILAR_DISTANCE)
        candidates.append((f"{shot_id} (adjacent)", hamming(h, other), limit))

    if candidates:
        name, distance, _ = min(candidates, key=lambda c: c[1])
        qa.nearest, qa.nearest_distance = name, distance
        for cand_name, cand_distance, limit in candidates:
            if cand_distance <= limit:
                qa.failures.append(
                    f"too close to {cand_name} (distance {cand_distance} <= {limit})"
                    + (
                        " — the prompt was ignored and the reference was reproduced"
                        if cand_name == "hero_reference"
                        else ""
                    )
                )
            elif cand_distance <= SIMILAR_DISTANCE:
                qa.warnings.append(f"similar to {cand_name} (distance {cand_distance})")

    qa.ok = not qa.failures
    return qa
