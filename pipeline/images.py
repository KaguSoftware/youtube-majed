"""Shot image generation: one warm klein process, content-addressed output.

This is the only GPU-bound step in the pipeline and everything around it exists
to protect it (PLAN.md section 4):

- **The model loads once.** A process per image would add a full cold weight
  load to every single shot. PLAN.md names this as the easiest available way to
  make the pipeline slow, and Phase 0 measured the gap.
- **Concurrency is one.** Unified memory means parallel generation causes swap,
  and on this step swap is not slow, it is disqualifying — Phase 0 recorded 7.3
  million swapouts at 1216x704 against 34k at 832x480 (PLAN.md 8.9).
- **Output is content-addressed.** The cache key covers every input that
  determines the image, including the bytes of the reference. A killed run
  resumes without regenerating finished shots, which is Phase 2's exit
  criterion arriving a phase early because the addressing scheme is the same.

The locked configuration, measured not assumed: 832x480, 4 steps, guidance 1.0,
the character crop as the sole reference, 15.26s median per image. Do not try
to tune steps or guidance — klein's distilled checkpoints exit with an error on
any guidance but 1.0, there is no negative prompt, and `image_strength` is a
no-op on this path because references are attention tokens rather than a noised
init image (PLAN.md section 5, 8.11).
"""

from __future__ import annotations

import os
import statistics
import time
from dataclasses import dataclass
from pathlib import Path

from . import config, pins, qa
from .timeline import ImageRecord, Shot, image_hash

#: How many rerolls a shot gets before it is flagged for a human. A reroll
#: costs ~15s; letting one shot reroll forever costs the whole run.
MAX_ATTEMPTS = 3


@dataclass
class GenStats:
    generated: int = 0
    cached: int = 0
    rerolled: int = 0
    flagged: list[str] = None
    times: list[float] = None

    def __post_init__(self) -> None:
        self.flagged = self.flagged or []
        self.times = self.times or []

    def summary(self) -> str:
        if not self.times:
            return f"{self.cached} cached, nothing generated"
        med = statistics.median(self.times)
        return (
            f"{self.generated} generated (median {med:.2f}s, "
            f"total {sum(self.times) / 60:.1f} min), {self.cached} cached, "
            f"{self.rerolled} rerolled, {len(self.flagged)} flagged"
        )


class KleinGenerator:
    """`Flux2KleinEdit`, warm, licence-checked.

    Deliberately the *edit* variant even though Phase 1 passes a single
    reference: it takes a list, so multi-reference needs no code change, and it
    is the same class the Phase 4 editing page will call. One class, one warm
    process, one Apache-2.0 licence covers both (PLAN.md 8.3).
    """

    def __init__(self) -> None:
        self.pin = pins.MODELS["image"]
        #: What content addresses name this model by (pins.Model.identity).
        self.model_name = self.pin.identity
        self._model = None
        self._text_only = None

    def preflight(self) -> tuple[bool, str]:
        try:
            from mflux.models.flux2.variants import Flux2KleinEdit  # noqa: F401
            from mflux.models.common.config.model_config import ModelConfig  # noqa: F401
            import mlx.core  # noqa: F401
        except ImportError as exc:
            return False, f"mflux/mlx not importable: {exc}"
        return True, "ok"

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def load(self, log=print) -> None:
        if self._model is not None:
            return
        ok, msg = self.preflight()
        if not ok:
            raise RuntimeError(msg)

        # The licence register: cleared by name here (which also runs the
        # Phase 0 gate), and by hash in `pins.check`, which the worker runs
        # before it claims anything.
        pins.assert_cleared(self.pin)

        from mflux.models.common.config.model_config import ModelConfig
        from mflux.models.common.resolution.model_revisions import ModelRevisions
        from mflux.models.flux2.variants import Flux2KleinEdit

        # mflux's own pin table, which it consults for every snapshot lookup
        # and download; it pins the base klein repo but not this checkpoint.
        # With the entry, only the pinned commit's snapshot counts.
        ModelRevisions.PINNED[self.pin.repo] = self.pin.revision

        t = time.time()
        self._model = Flux2KleinEdit(
            quantize=None,  # the checkpoint is already 4-bit; see PLAN.md 8.1
            model_config=ModelConfig.from_name(
                self.pin.repo, base_model=config.IMAGE_BASE_MODEL
            ),
        )
        log(f"  loaded {self.pin.repo}@{self.pin.revision[:12]} in {time.time() - t:.1f}s")

    def _text_to_image(self):
        """`Flux2Klein` over the already-loaded weights, for prompts with no
        reference (the style stage's candidate looks).

        `Flux2KleinEdit` cannot run without one: its predict step concatenates
        the reference latents unconditionally, and an empty list fails inside
        mlx (found on the first real style job). Loading `Flux2Klein` as well
        would hold a second 4.3 GB copy of identical weights, which is the
        memory pressure PLAN.md 8.8 measured as fatal. Both classes are plain
        modules over the same VAE, transformer and text encoder, so the
        text-only class borrows them. Same checkpoint, same licence.
        """
        if self._text_only is None:
            import mlx.nn as nn
            from mflux.models.flux2.variants import Flux2Klein

            t2i = Flux2Klein.__new__(Flux2Klein)
            nn.Module.__init__(t2i)
            for attr in ("compute_precision", "model_config", "callbacks", "tiling_config", "tokenizers",
                         "vae", "transformer", "text_encoder", "bits", "lora_paths", "lora_scales"):
                setattr(t2i, attr, getattr(self._model, attr))
            t2i.prompt_cache = {}       # its own: the two variants may encode prompts differently
            self._text_only = t2i
        return self._text_only

    def generate(self, prompt: str, seed: int, refs: list[Path], dest: Path, *,
                 size: tuple[int, int] | None = None) -> float:
        """`size` (width, height), multiples of 16, overrides the locked
        832x480 for a region retouch, which paints only part of a frame."""
        if self._model is None:
            raise RuntimeError("generate() before load()")
        t = time.time()
        width, height = size or (config.GEN_WIDTH, config.GEN_HEIGHT)
        common = dict(seed=seed, prompt=prompt, num_inference_steps=config.GEN_STEPS,
                      height=height, width=width, guidance=config.GEN_GUIDANCE)
        if refs:
            image = self._model.generate_image(**common, image_paths=[str(r) for r in refs])
        else:
            image = self._text_to_image().generate_image(**common)
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = config.partial(dest)
        image.save(path=tmp, overwrite=True)  # overwrite defaults to False
        if not tmp.exists() or tmp.stat().st_size == 0:
            raise RuntimeError(f"generate_image returned but wrote nothing to {tmp}")
        os.replace(tmp, dest)
        return time.time() - t

    def unload(self) -> None:
        self._model = None
        self._text_only = None
        try:
            import mlx.core as mx

            mx.clear_cache()
        except Exception:
            pass


def generate_shots(
    shots: list[Shot],
    style,
    paths,
    *,
    generator: KleinGenerator | None = None,
    max_attempts: int = MAX_ATTEMPTS,
    on_shot=None,
    unload: bool = True,
    log=print,
) -> GenStats:
    """Fill every shot's `image`, generating only what the cache lacks.

    QA runs against the hero reference and against every shot already accepted
    in this run, so a near-duplicate is caught while there is still a cheap
    reroll available rather than after the render.

    Resuming is a re-run. A finished shot is a cache hit, and QA is recomputed
    from the cached bytes rather than trusted from a checkpoint, so the reroll
    decisions — and therefore which seed each shot ends up on — come out the
    same as the first attempt's. `on_shot(shot, stats)` runs after each shot is
    settled; the worker uses it to checkpoint, and it may raise to stop.

    `unload=False` leaves the model warm for the next job. A worker that
    reloaded klein per job would be paying the cost PLAN.md section 4 exists
    to avoid, just once per video instead of once per image.
    """
    refs = [style.hero_crop]
    stats = GenStats()
    seen: dict[str, int] = {}          # shot_id -> dhash of accepted image
    previous: tuple[str, int] | None = None   # the immediately preceding shot
    generator = generator or KleinGenerator()
    loaded = False

    for shot in shots:
        attempt, record = 0, None
        while attempt < max_attempts:
            attempt += 1
            # The seed only moves on a reroll, so an accepted first attempt is
            # keyed by the style seed exactly as the style record promises.
            seed = shot.seed if attempt == 1 else shot.seed + 10_000 * (attempt - 1) + shot.index
            # The generator's name is part of the address, so a fake or a
            # different model can never satisfy a lookup for klein's output.
            h = image_hash(shot.prompt, seed, refs, model=generator.model_name)
            dest = paths.images / f"{h}.png"

            if paths.mirror.ensure(dest):
                elapsed, source = 0.0, "cached"
                stats.cached += 1
            else:
                if not generator.loaded:
                    log(f"  loading image model (one warm process for all "
                        f"{len(shots)} shots)")
                    generator.load(log=log)
                loaded = True
                elapsed = generator.generate(shot.prompt, seed, refs, dest)
                stats.generated += 1
                stats.times.append(elapsed)
                source = f"{elapsed:5.2f}s"

            # Every attempt is published, rejected rerolls included: QA is
            # recomputed on resume, so a takeover on another machine needs
            # attempt 1's bytes to reach the same reroll decision. Cache hits
            # too, so a file whose upload failed last attempt is healed now
            # (media.py, "Publishing heals"); an indexed key costs one query.
            paths.mirror.publish(dest, "image")

            # The preceding shot is judged on the stricter threshold and so is
            # excluded from the general pool, or it would be checked twice and
            # the looser verdict would mask the stricter one.
            neighbour = dict([previous]) if previous else {}
            result = qa.inspect(
                dest,
                reference=style.hero_crop,
                others={k: v for k, v in seen.items() if k not in neighbour},
                adjacent=neighbour,
            )
            record = ImageRecord(
                hash=h, path=str(dest.relative_to(paths.root)), prompt=shot.prompt,
                seed=seed, refs=[str(r.name) for r in refs], attempts=attempt,
                qa=result.to_json(),
            )
            flag = "ok" if result.ok else "QA FAIL"
            log(f"  {shot.shot_id}  {source:>9}  {flag:<8} "
                f"nearest={result.nearest or '-'}@{result.nearest_distance} "
                f"lap={result.laplacian:.0f}")
            for f in result.failures:
                log(f"            {f}")
            for w in result.warnings:
                log(f"            warn: {w}")

            if result.ok:
                seen[shot.shot_id] = int(result.phash, 16)
                previous = (shot.shot_id, int(result.phash, 16))
                break
            if attempt < max_attempts:
                stats.rerolled += 1
                log(f"            rerolling {shot.shot_id} on a new seed "
                    f"({attempt}/{max_attempts - 1})")
        else:
            # Flag, do not abort: one bad shot should not cost the other nine.
            # Phase 3 surfaces this in the production view for a human to fix.
            stats.flagged.append(shot.shot_id)
            log(f"            {shot.shot_id} flagged after {max_attempts} attempts; "
                "keeping the last image")
            # Still the neighbour for the next shot, flagged or not: the next
            # shot should not be allowed to match a frame we already distrust.
            seen[shot.shot_id] = int(record.qa["phash"], 16)
            previous = (shot.shot_id, int(record.qa["phash"], 16))

        shot.image = record
        if on_shot is not None:
            on_shot(shot, stats)

    if loaded and unload:
        generator.unload()
    return stats


#: Region retouch geometry. The margin gives the model context around the
#: object; the feather hides the seam in a painted frame.
RETOUCH_MARGIN = 0.06
RETOUCH_FEATHER = 0.12
RETOUCH_MIN_PX = 160
#: The region is painted at about this long side: enough pixels to paint a
#: small object well, and far cheaper than a whole frame.
RETOUCH_LONG_SIDE = 768


def retouch_box(region, size: tuple[int, int]) -> tuple[int, int, int, int]:
    """A normalized [left, top, right, bottom] region as a pixel box in a
    frame of `size`, widened by the margin and to the minimum size, and
    kept inside the frame."""
    w, h = size
    x0, x1 = sorted(min(max(float(v), 0.0), 1.0) for v in (region[0], region[2]))
    y0, y1 = sorted(min(max(float(v), 0.0), 1.0) for v in (region[1], region[3]))
    out = []
    for lo, hi, full in ((x0, x1, w), (y0, y1, h)):
        a = round((lo - RETOUCH_MARGIN) * full)
        b = round((hi + RETOUCH_MARGIN) * full)
        short = min(RETOUCH_MIN_PX, full) - (b - a)
        if short > 0:
            a, b = a - short // 2, b + short - short // 2
        if a < 0:
            a, b = 0, b - a
        if b > full:
            a, b = a - (b - full), full
        out.append((max(0, a), min(full, b)))
    (bx0, bx1), (by0, by1) = out
    return bx0, by0, bx1, by1


def retouch_region(base: Path, region, instruction: str, seed: int, *, generator, cache: Path,
                   mirror=None) -> tuple[Path, str, float]:
    """Repaint one region of a still and feather it back in. -> (the new
    still, its hash, seconds spent generating; 0 on a cache hit).

    A whole-frame retouch changes things it was told to keep: asked to swap
    a glass lantern for a clay lamp, klein also turned the bronze measure in
    the man's hands into a clay pot, twice (PLAN.md 12.5). Painting only the
    region around the lantern leaves every pixel outside it as it was, and
    is faster, since the reference and the output are both smaller.
    """
    import numpy as np
    from PIL import Image, ImageFilter

    from .timeline import file_sha, sha

    with Image.open(base) as im:
        frame = im.convert("RGB")
    x0, y0, x1, y1 = retouch_box(region, frame.size)
    crop = frame.crop((x0, y0, x1, y1))
    cw, ch = crop.size
    scale = min(2.5, max(1.0, RETOUCH_LONG_SIDE / max(cw, ch)))
    size = (max(256, round(cw * scale / 16) * 16), max(256, round(ch * scale / 16) * 16))

    work = cache / "retouch"
    work.mkdir(parents=True, exist_ok=True)
    tmp = work / ".ref.partial.png"
    crop.save(tmp)
    ref = work / f"{file_sha(tmp)}.png"
    os.replace(tmp, ref)

    h_edit = image_hash(instruction, seed, [ref], model=generator.model_name,
                        width=size[0], height=size[1])
    h = sha("retouch-v1", h_edit, file_sha(base), [x0, y0, x1, y1])
    dest = cache / "images" / f"{h}.png"
    if mirror.ensure(dest) if mirror is not None else dest.exists():
        return dest, h, 0.0
    painted = cache / "retouch" / f"{h_edit}.png"
    elapsed = 0.0
    if not painted.exists():
        if not generator.loaded:
            generator.load()
        elapsed = generator.generate(instruction, seed, [ref], painted, size=size)

    with Image.open(painted) as im:
        patch = im.convert("RGB").resize((cw, ch), Image.LANCZOS)
    # Opaque in the middle, fading into the old frame at the region's edges,
    # except where it meets the frame's own edge: nothing to blend with there.
    f = max(4, round(RETOUCH_FEATHER * min(cw, ch)))
    edges = {"l": x0 == 0, "t": y0 == 0, "r": x1 == frame.width, "b": y1 == frame.height}
    m = np.ones((ch, cw), dtype=np.float32)
    ramp = np.linspace(0.0, 1.0, f, dtype=np.float32)
    ramp = ramp * ramp * (3 - 2 * ramp)            # smoothstep
    if not edges["l"]: m[:, :f] *= ramp[None, :]
    if not edges["r"]: m[:, -f:] *= ramp[::-1][None, :]
    if not edges["t"]: m[:f, :] *= ramp[:, None]
    if not edges["b"]: m[-f:, :] *= ramp[::-1][:, None]
    mask = Image.fromarray((m * 255).astype(np.uint8))
    out = frame.copy()
    out.paste(patch, (x0, y0), mask)

    tmp = config.partial(dest)
    out.save(tmp)
    os.replace(tmp, dest)
    return dest, h, elapsed


def repaint_shots(
    shots: list[Shot],
    style,
    paths,
    *,
    generator: KleinGenerator | None = None,
    max_attempts: int = MAX_ATTEMPTS,
    on_shot=None,
    log=print,
) -> GenStats:
    """Paint the shots an edit marked (`shot.repaint`), each judged against
    the film it is going into.

    The rest of the film is already painted, so QA compares against the
    perceptual hashes recorded on its shots rather than re-reading 50 stills,
    and both neighbours count as adjacent (in a first render only the shot
    before exists yet). Two modes:

    - **generate**: the shot's prompt on the character crop, exactly as a
      first render paints it. Same addressing, so undoing an edit and asking
      for it again is a cache hit.
    - **retouch**: the current still is the reference and the instruction is
      the prompt. A full-frame reference makes the model keep the frame's
      composition (the effect the style stage avoids by cropping, PLAN.md
      8.11, used here on purpose), so one wrong object can change while the
      rest stays. Measured: 27 s per retouch against ~17 s for a crop-
      conditioned shot, because reference cost grows with reference area.
    """
    stats = GenStats()
    generator = generator or KleinGenerator()
    painted = {s.shot_id: int(s.image.qa["phash"], 16) for s in shots
               if s.image is not None and not s.repaint and s.image.qa.get("phash")}

    for i, shot in enumerate(shots):
        if not shot.repaint:
            continue
        mode = shot.repaint["mode"]
        if mode == "retouch":
            base = paths.root / shot.repaint["base"]["path"]
            if not paths.mirror.ensure(base):
                raise RuntimeError(f"{shot.shot_id}: the picture to retouch ({base.name}) is missing")
            refs, prompt = [base], shot.repaint["instruction"]
        else:
            refs, prompt = [style.hero_crop], shot.prompt
        near = {x.shot_id for x in shots[max(0, i - 1): i + 2] if x is not shot}
        adjacent = {k: v for k, v in painted.items() if k in near}
        others = {k: v for k, v in painted.items() if k not in near and k != shot.shot_id}
        # No worse than the picture it replaces: a neighbour it was already
        # close to (same beat, other framing) is held to that distance, never
        # below the duplicate floor.
        limits = {}
        old = shot.image.qa.get("phash") if shot.image is not None else None
        if old:
            for k, v in adjacent.items():
                before = qa.hamming(int(old, 16), v)
                limits[k] = max(qa.DUPLICATE_DISTANCE, min(qa.SIMILAR_DISTANCE, before - 1))

        region = shot.repaint.get("region") if mode == "retouch" else None
        attempt, record = 0, None
        while attempt < max_attempts:
            attempt += 1
            seed = shot.seed if attempt == 1 else shot.seed + 10_000 * (attempt - 1) + shot.index
            if region:
                dest, h, elapsed = retouch_region(refs[0], region, prompt, seed, generator=generator,
                                                  cache=paths.cache, mirror=paths.mirror)
            else:
                h = image_hash(prompt, seed, refs, model=generator.model_name)
                dest = paths.images / f"{h}.png"
                elapsed = 0.0
                if not paths.mirror.ensure(dest):
                    if not generator.loaded:
                        generator.load(log=log)
                    elapsed = generator.generate(prompt, seed, refs, dest)
            if elapsed:
                stats.generated += 1
                stats.times.append(elapsed)
                source = f"{elapsed:5.2f}s"
            else:
                stats.cached += 1
                source = "cached"
            paths.mirror.publish(dest, "image")
            result = qa.inspect(dest, reference=style.hero_crop, others=others, adjacent=adjacent,
                                adjacent_limits=limits)
            record = ImageRecord(
                hash=h, path=str(dest.relative_to(paths.root)), prompt=prompt, seed=seed,
                refs=[r.name for r in refs], attempts=attempt, qa=result.to_json())
            log(f"  {shot.shot_id}  {mode:<8} {source:>9}  {'ok' if result.ok else 'QA FAIL'}"
                + "".join(f"\n            {f}" for f in result.failures))
            if result.ok:
                break
            if attempt < max_attempts:
                stats.rerolled += 1
        else:
            stats.flagged.append(shot.shot_id)

        shot.image = record
        shot.retouch = ({"instruction": prompt, "base": shot.repaint["base"]["hash"],
                         **({"region": list(region)} if region else {})}
                        if mode == "retouch" else None)
        shot.repaint = None
        painted[shot.shot_id] = int(record.qa["phash"], 16)
        if on_shot is not None:
            on_shot(shot, stats)
    return stats


def eta(n_shots: int) -> str:
    """An honest estimate before committing a quarter of an hour to a run."""
    seconds = n_shots * config.SECONDS_PER_IMAGE_ESTIMATE
    return f"~{seconds / 60:.1f} min for {n_shots} shots at {config.SECONDS_PER_IMAGE_ESTIMATE}s each"
