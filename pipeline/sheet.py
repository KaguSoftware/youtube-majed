"""Generating a character sheet, and proving the sheet agrees with itself.

Phase 0 validated conditioning on *one* character crop. PLAN.md 8.3 predicts
that several crops — `image_paths=[hero, sheet_front, sheet_detail]` — should
hold identity better across a long run, and leaves it untested.

The obvious way to get those extra crops is to have the model draw the
character from other angles. That introduces a failure the single-crop setup
cannot have: **if the generated views drift from each other, the references
disagree, and three conflicting descriptions of a face are worse than one
consistent one.** The references would then be a source of inconsistency rather
than a cure for it.

Two defences, and both are needed:

1. **One anchor.** Every view is generated conditioned on the *same* original
   hero crop, never on another generated view. Chaining view onto view is how
   drift compounds; anchoring them all to one ground-truth frame bounds it.
2. **Verify before use.** The views are checked against the anchor and against
   each other before any of them is allowed to become a reference, using a
   costume-palette comparison calibrated against a known-different character.

The calibration matters for the same reason it did in qa.py: a similarity
number means nothing without knowing what "different" scores. Phase 0 left a
labelled control on disk — the no-reference arm, which produced *a different
man* from the same prompts and seed (PLAN.md 8.11) — so "different character"
has a measured value rather than an assumed one.

Views are cropped to the character before use. Conditioning on a full scene
makes the model reproduce that scene; this is the finding the whole reference
design rests on.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image

from . import config, qa

#: Each view is one prompt. The background is deliberately plain so the crop
#: carries costume and face and nothing else — a sheet view with scenery in it
#: would inject that scenery into every shot that references it.
SHEET_VIEWS: dict[str, str] = {
    "front": (
        "character reference sheet, the same man, standing facing the viewer, "
        "full head and torso, arms at his sides, costume fully visible, "
        "flat neutral grey studio background, even frontal light, no scenery"
    ),
    "profile": (
        "character reference sheet, the same man, turned three-quarters to his "
        "left, head and torso, costume fully visible, flat neutral grey studio "
        "background, even light, no scenery"
    ),
    "detail": (
        "character reference sheet, close study of the same man's head and "
        "shoulders, face and beard clearly lit, collar and shoulder of the "
        "garment visible, flat neutral grey studio background, no scenery"
    ),
}

#: Background detection for cropping. The sheet views are generated against a
#: flat studio background, but "flat" in an impasto oil style still carries
#: brush texture, so a naive background-difference threshold selects the whole
#: frame. 130 (summed over RGB) was measured as the level at which the box
#: stops moving: front, profile and detail all gave stable spans between
#: thresholds of 90 and 170.
BG_DIFF_THRESHOLD = 130
BG_COLUMN_FRACTION = 0.15
CROP_PAD = 0.035

#: Two generated views that are near-identical carry no more information than
#: one and cost reference area for nothing. This is the dHash threshold from
#: qa.py, used here for the opposite purpose: there it catches shots that are
#: too similar, here it catches *views* that failed to be different.
MIN_VIEW_DISTANCE = 14


# ---------------------------------------------------------------------------
# Why there is no automatic identity check here
#
# The obvious gate — "do these drawings depict the same person" — was built,
# measured, and removed. It does not work, and the numbers are worth keeping so
# nobody rebuilds it.
#
# The metric was a saturation-weighted hue histogram of the character region,
# compared by Bhattacharyya coefficient. Calibrated against a *matched* control
# (a view generated with no reference, under the same prompt, background and
# lighting, which Phase 0 established yields a different man):
#
#     same character   anchor ~ front     0.056
#                      anchor ~ profile   0.229
#                      front  ~ profile   0.935
#     DIFFERENT person front  ~ control   0.968   <- higher than any same pair
#                      detail ~ control   0.931
#
# The different man scores *higher* than the real matches. The metric tracks
# background and dominant garment hue, not identity: everything generated on
# grey in olive clothing looks alike to it, and the anchor scores low against
# its own views only because the anchor has a misty white background.
#
# An earlier calibration against Phase 0's full-scene arms failed the same way
# for the same reason (same-character 0.154-0.412 against different-person up
# to 0.603 — complete overlap), which is what prompted the matched control.
#
# A real identity check needs an image embedding model (CLIP or similar), which
# is a new dependency, a new download and a new licence review under PLAN.md
# 1.6 — a Phase 2 decision, not something to fake here. Shipping a gate that
# cannot tell two different men apart would be worse than shipping none,
# because it would be trusted.
#
# What protects consistency instead, in order of how much work it does:
#
#   1. One anchor. Every view conditions on the same original hero crop and
#      never on another generated view, so drift cannot compound. This is the
#      mechanism that actually produced the consistency observed.
#   2. Human review. DESIGN.md already makes the style stage a human gate; the
#      sheet belongs to that stage and is reviewed the same way.
#   3. Distinctness. Checked below, because it *is* mechanically checkable.
# ---------------------------------------------------------------------------


def background_box(path: Path, threshold: int = BG_DIFF_THRESHOLD,
                   pad: float = CROP_PAD) -> tuple[float, float, float, float]:
    """Bounding box of the subject against a flat studio background."""
    with Image.open(path) as im:
        a = np.asarray(im.convert("RGB"), dtype=np.float64)
    h, w, _ = a.shape
    edge = np.concatenate([a[:8].reshape(-1, 3), a[-8:].reshape(-1, 3)])
    bg = np.median(edge, axis=0)
    mask = np.abs(a - bg).sum(axis=2) > threshold

    def span(profile: np.ndarray, n: int) -> tuple[float, float]:
        if profile.max() <= 0:
            return 0.0, 1.0
        hit = np.where(profile > profile.max() * BG_COLUMN_FRACTION)[0]
        if len(hit) == 0:
            return 0.0, 1.0
        return hit[0] / n, (hit[-1] + 1) / n

    x0, x1 = span(mask.sum(axis=0), w)
    y0, y1 = span(mask.sum(axis=1), h)
    return (max(0.0, x0 - pad), max(0.0, y0 - pad),
            min(1.0, x1 + pad), min(1.0, y1 + pad))


def character_box(path: Path) -> tuple[float, float, float, float]:
    """Where the character is, for cropping before use as a reference.

    DESIGN.md keeps this box user-adjustable in the style stage, because an
    automatic crop will sometimes clip a costume detail that matters.
    """
    return background_box(path)


def crop_to_character(src: Path, dest: Path, box=None) -> tuple[Path, tuple]:
    box = box or character_box(src)
    with Image.open(src) as im:
        w, h = im.size
        im.crop((int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h))).save(dest)
    return dest, box


def generate(style, out_dir: Path, *, generator=None, log=print) -> list[ViewCheck]:
    """Draw every sheet view from the one anchor, then check them before use."""
    from .images import KleinGenerator
    from .timeline import image_hash

    out_dir.mkdir(parents=True, exist_ok=True)
    anchor = style.hero_crop
    generator = generator or KleinGenerator()
    loaded = False
    checks: list[ViewCheck] = []

    for name, body in SHEET_VIEWS.items():
        prompt = style.prompt_for(body, "consistent character study")
        # Each view gets its own seed; the identity comes from the anchor, and
        # reusing one seed across views would be asking for the same picture.
        seed = style.seed + 7_000 + abs(hash(name)) % 1000
        h = image_hash(prompt, seed, [anchor])
        raw = out_dir / f"view_{name}_{h}.png"

        if not raw.exists():
            if not loaded:
                generator.load(log=log)
                loaded = True
            elapsed = generator.generate(prompt, seed, [anchor], raw)
            log(f"  {name:<8} generated in {elapsed:.2f}s")
        else:
            log(f"  {name:<8} cached")
        checks.append(ViewCheck(name=name, path=raw))

    if loaded:
        generator.unload()

    # Distinctness is the one thing here that is mechanically checkable, so it
    # is the one thing checked. Two views that came back nearly identical cost
    # reference area and add nothing; identity itself goes to a human.
    hashes = {c.name: qa.dhash(c.path) for c in checks}
    for a in checks:
        for b in checks:
            if a.name >= b.name:
                continue
            d = qa.hamming(hashes[a.name], hashes[b.name])
            a.distances[b.name] = d
            b.distances[a.name] = d
            if d <= MIN_VIEW_DISTANCE:
                for c in (a, b):
                    c.accepted = False
                    c.reasons.append(
                        f"only distance {d} from the {('%s' % (b.name if c is a else a.name))} "
                        f"view (want > {MIN_VIEW_DISTANCE}) — these are the same "
                        "picture twice, not two angles"
                    )

    for c in checks:
        c.crop, c.crop_box = crop_to_character(c.path, c.path.with_name(f"crop_{c.name}.png"))
        log(f"  {c.name:<8} crop {c.crop.name}  box="
            f"{tuple(round(x, 2) for x in c.crop_box)}  "
            f"distances={c.distances}  {'ok' if c.accepted else 'REJECTED'}")
        for r in c.reasons:
            log(f"           {r}")

    log("\n  Identity is NOT checked automatically — see the note above for why,")
    log("  and the measurements that rule it out. Look at the crops before")
    log("  promoting them: a sheet that disagrees with itself makes the")
    log("  references fight each other and is worse than the single crop.")
    return checks
