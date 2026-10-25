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

from . import config, qa
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

    def __init__(self, *, model: str = config.IMAGE_MODEL) -> None:
        self.model_name = model
        self._model = None

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

        # Reuse the Phase 0 licence gate rather than restating the cleared set.
        # A second copy of a licence whitelist is a second thing to forget to
        # update, and PLAN.md 1.6 treats this as a business constraint.
        from bench.backends.mflux_klein import assert_licence_ok

        assert_licence_ok(self.model_name)

        from mflux.models.common.config.model_config import ModelConfig
        from mflux.models.flux2.variants import Flux2KleinEdit

        t = time.time()
        self._model = Flux2KleinEdit(
            quantize=None,  # the checkpoint is already 4-bit; see PLAN.md 8.1
            model_config=ModelConfig.from_name(
                self.model_name, base_model=config.IMAGE_BASE_MODEL
            ),
        )
        log(f"  loaded {self.model_name} in {time.time() - t:.1f}s")

    def generate(self, prompt: str, seed: int, refs: list[Path], dest: Path) -> float:
        if self._model is None:
            raise RuntimeError("generate() before load()")
        t = time.time()
        image = self._model.generate_image(
            seed=seed,
            prompt=prompt,
            num_inference_steps=config.GEN_STEPS,
            height=config.GEN_HEIGHT,
            width=config.GEN_WIDTH,
            guidance=config.GEN_GUIDANCE,
            image_paths=[str(r) for r in refs],
        )
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = config.partial(dest)
        image.save(path=tmp, overwrite=True)  # overwrite defaults to False
        if not tmp.exists() or tmp.stat().st_size == 0:
            raise RuntimeError(f"generate_image returned but wrote nothing to {tmp}")
        os.replace(tmp, dest)
        return time.time() - t

    def unload(self) -> None:
        self._model = None
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

            if dest.exists() and dest.stat().st_size > 0:
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


def eta(n_shots: int) -> str:
    """An honest estimate before committing a quarter of an hour to a run."""
    seconds = n_shots * config.SECONDS_PER_IMAGE_ESTIMATE
    return f"~{seconds / 60:.1f} min for {n_shots} shots at {config.SECONDS_PER_IMAGE_ESTIMATE}s each"
