"""FLUX.2 [klein] 4B on Apple Silicon via mflux.

Bound against the real mflux API, verified by introspection:

    Flux2Klein(quantize: int | None = None, model_config: ModelConfig | None = None,
               compute_precision: mx.Dtype | None = None, ...)
    .generate_image(seed, prompt, num_inference_steps=4, height=1024, width=1024,
                    guidance=1.0, image_path=None, image_strength=None, ...)
        -> GeneratedImage.save(path, export_json_metadata=False, overwrite=False)

Two backends, and the difference between them is the point.

`MfluxCliBackend` shells out once per image, reloading weights every time.
`MfluxWarmBackend` loads once and generates N against the loaded model.

Run both. The gap is the measured value of keeping the model warm, which
PLAN.md section 4 names as the easiest way to make this pipeline slow. Quoting
CLI timings as per-image cost would overstate real batch cost on every image.

Quantization is a *load-time* argument here, not a baked checkpoint — contrary
to what the HF model cards suggest. One set of weights serves every quant level.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

from .base import Backend, SubprocessBackend

#: mflux model alias. Pinned explicitly rather than relying on the CLI default,
#: so a future change to that default cannot silently swap in a 9B model.
KLEIN_4B = "flux2-klein-4b"

#: Pre-quantized 4-bit klein 4B, published for mflux. 4.30 GB against 22.11 GB
#: for the bf16 base, and already quantized so there is no load-time quantize
#: step. This is what the worker should ship. Both mirrors carry apache-2.0 on
#: their model cards, verified via the HF API.
KLEIN_4B_INT4 = "mlx-community/flux2-klein-4b-4bit"
KLEIN_4B_INT4_MIRROR = "Runpod/FLUX.2-klein-4B-mflux-4bit"

#: Apache 2.0, cleared for commercial use. See PLAN.md section 1.6.
LICENCE_CLEARED = {
    "flux2-klein-4b",
    "flux2-klein-base-4b",
    KLEIN_4B_INT4,
    KLEIN_4B_INT4_MIRROR,
}

#: Non-commercial licences. Present in mflux's registry and one typo away from
#: being used, so the block is enforced in code rather than left to discipline.
LICENCE_BLOCKED = {
    "flux2-klein-9b",
    "flux2-klein-9b-kv",
    "flux2-klein-base-9b",
    "flux3-image-klein",
    "flux3-image-klein-base",
    "dev",
    "dev_redux",
    "dev_kontext",
}

#: bench quant label -> mflux `--quantize` / `quantize=` value. None is bf16.
QUANT_LEVELS: dict[str, int | None] = {"int4": 4, "int8": 8, "bf16": None}

BASE_SEED = 88412

#: klein's distilled variants are trained for guidance 1.0; mflux only permits
#: other values on the `base` fine-tunes.
GUIDANCE = 1.0


def assert_licence_ok(model_alias: str) -> str:
    if model_alias in LICENCE_BLOCKED:
        raise RuntimeError(
            f"{model_alias!r} is under a non-commercial licence and must never "
            "enter this pipeline. See PLAN.md section 1.6."
        )
    if model_alias not in LICENCE_CLEARED:
        raise RuntimeError(
            f"{model_alias!r} is not in the cleared-licence set "
            f"{sorted(LICENCE_CLEARED)}. Clear it explicitly before use."
        )
    return model_alias


def quant_value(label: str) -> int | None:
    if label not in QUANT_LEVELS:
        raise RuntimeError(
            f"unknown quant {label!r}; expected one of {sorted(QUANT_LEVELS)}"
        )
    return QUANT_LEVELS[label]


def resolve_model(quant: str, extra: dict | None = None) -> tuple[str, str | None, int | None]:
    """(model_name, base_model, quantize) for a quant label.

    int4 resolves to the pre-quantized checkpoint: a 4.30 GB download instead
    of 22.11 GB, with no load-time quantization. int8 and bf16 need the full
    bf16 base weights and quantize at load.

    `extra["checkpoint"]` overrides the model name, for testing a mirror or a
    local path; it still has to pass the licence check.
    """
    extra = extra or {}
    override = extra.get("checkpoint")
    if override:
        return assert_licence_ok(override), extra.get("base_model", KLEIN_4B), quant_value(quant)

    if quant == "int4":
        return assert_licence_ok(KLEIN_4B_INT4), KLEIN_4B, None
    return assert_licence_ok(KLEIN_4B), None, quant_value(quant)


class MfluxCliBackend(SubprocessBackend):
    """Upper bound: pays a full cold weight load on every single image."""

    name = "mflux-cli"

    #: resolved once; console scripts live beside the interpreter in a venv,
    #: which is not necessarily on PATH when invoked as `.venv/bin/python -m`.
    EXE = "mflux-generate-flux2"

    def _exe_path(self) -> str | None:
        beside = Path(sys.executable).parent / self.EXE
        if beside.exists():
            return str(beside)
        return shutil.which(self.EXE)

    def preflight(self) -> tuple[bool, str]:
        if self._exe_path() is None:
            return False, (
                f"{self.EXE} not found beside {sys.executable} or on PATH "
                "(uv pip install mflux)"
            )
        return True, "ok"

    def build_command(self, prompt: str, dest: Path, config) -> list[str]:
        model, base_model, quant = resolve_model(config.quant, config.extra)
        exe = self._exe_path()
        if exe is None:
            raise RuntimeError(f"{self.EXE} not found")
        cmd = [
            exe,
            "--model", model,
            "--prompt", prompt,
            "--steps", str(config.steps),
            "--width", str(config.width),
            "--height", str(config.height),
            "--guidance", str(GUIDANCE),
            "--seed", str(BASE_SEED),
            "--output", str(dest),
            "--no-exif",
        ]
        if base_model:
            cmd += ["--base-model", base_model]
        if quant is not None:
            cmd += ["--quantize", str(quant)]

        # a laptop worker on battery otherwise stops mid-batch at 5%
        if config.extra.get("battery_stop") is not None:
            cmd += ["--battery-percentage-stop-limit", str(config.extra["battery_stop"])]
        if config.extra.get("low_ram"):
            cmd.append("--low-ram")
        if config.extra.get("vae_tiling"):
            cmd.append("--vae-tiling")
        if config.extra.get("mlx_cache_gb"):
            cmd += ["--mlx-cache-limit-gb", str(config.extra["mlx_cache_gb"])]
        if config.extra.get("compute_precision"):
            cmd += ["--compute-precision", str(config.extra["compute_precision"])]

        # klein's single init-image slot; see the multi-reference note below
        if config.refs:
            cmd += ["--image", config.refs[0], str(config.extra.get("ref_strength", 0.4))]
        return cmd


class MfluxWarmBackend(Backend):
    """The number that matters: load once, generate many."""

    name = "mflux-warm"

    def __init__(self, prompts_file=None) -> None:
        super().__init__(prompts_file)
        self._model = None

    def preflight(self) -> tuple[bool, str]:
        try:
            from mflux.models.flux2 import Flux2Klein  # noqa: F401
            from mflux.models.common.config.model_config import ModelConfig  # noqa: F401
        except ImportError as exc:
            return False, f"mflux Flux2Klein not importable: {exc}"
        try:
            import mlx.core  # noqa: F401
        except ImportError as exc:
            return False, f"mlx not importable: {exc}"
        return True, "ok"

    def load(self, config) -> None:
        ok, msg = self.preflight()
        if not ok:
            raise RuntimeError(msg)

        from mflux.models.common.config.model_config import ModelConfig
        from mflux.models.flux2 import Flux2Klein

        model, base_model, quant = resolve_model(config.quant, config.extra)
        kwargs: dict = {
            "quantize": quant,
            "model_config": (
                ModelConfig.flux2_klein_4b()
                if model == KLEIN_4B
                else ModelConfig.from_name(model, base_model=base_model)
            ),
        }

        # float16 attention/FFN reportedly helps on M1/M2 and is ~neutral on
        # M4/M5. M3 is unmeasured either way, so it is a bench variable.
        precision = config.extra.get("compute_precision")
        if precision:
            import mlx.core as mx

            kwargs["compute_precision"] = getattr(mx, str(precision))

        self._model = Flux2Klein(**kwargs)

    def unload(self) -> None:
        self._model = None
        try:
            import mlx.core as mx

            mx.clear_cache()
        except Exception:
            pass

    def generate(self, prompt: str, dest: Path, config) -> None:
        if self._model is None:
            raise RuntimeError("generate() before load()")

        kwargs: dict = {
            "seed": BASE_SEED,
            "prompt": prompt,
            "num_inference_steps": config.steps,
            "height": config.height,
            "width": config.width,
            "guidance": GUIDANCE,
        }
        if config.refs:
            kwargs["image_path"] = config.refs[0]
            kwargs["image_strength"] = config.extra.get("ref_strength", 0.4)

        image = self._model.generate_image(**kwargs)

        dest.parent.mkdir(parents=True, exist_ok=True)
        # overwrite defaults to False and would raise on a rerun
        image.save(path=dest, overwrite=True)

        if not dest.exists() or dest.stat().st_size == 0:
            raise RuntimeError("generate_image returned but no image was written")

    def peak_memory_mb(self) -> float | None:
        """MLX knows its own unified-memory peak better than `ps` does."""
        try:
            import mlx.core as mx
        except ImportError:
            return None
        for attr in ("get_peak_memory",):
            fn = getattr(mx, attr, None)
            if callable(fn):
                try:
                    return round(fn() / 1024**2, 1)
                except Exception:
                    pass
        metal = getattr(mx, "metal", None)
        fn = getattr(metal, "get_peak_memory", None) if metal else None
        if callable(fn):
            try:
                return round(fn() / 1024**2, 1)
            except Exception:
                pass
        return None


class MfluxEditWarmBackend(MfluxWarmBackend):
    """klein 4B via `Flux2KleinEdit`: the multi-reference path.

    Same weights and the same licence as the plain variant, but it accepts a
    *list* of reference images, which is how one character survives 60 shots.
    Benchmarked separately because conditioning on several references is not
    free, and Phase 0 needs that cost measured rather than assumed.

    This is also the Phase 4 editing model. One warm process serves both.
    """

    name = "mflux-edit-warm"

    def preflight(self) -> tuple[bool, str]:
        try:
            from mflux.models.flux2.variants import Flux2KleinEdit  # noqa: F401
            from mflux.models.common.config.model_config import ModelConfig  # noqa: F401
        except ImportError as exc:
            return False, f"mflux Flux2KleinEdit not importable: {exc}"
        try:
            import mlx.core  # noqa: F401
        except ImportError as exc:
            return False, f"mlx not importable: {exc}"
        return True, "ok"

    def load(self, config) -> None:
        ok, msg = self.preflight()
        if not ok:
            raise RuntimeError(msg)

        from mflux.models.common.config.model_config import ModelConfig
        from mflux.models.flux2.variants import Flux2KleinEdit

        model, base_model, quant = resolve_model(config.quant, config.extra)
        kwargs: dict = {
            "quantize": quant,
            "model_config": (
                ModelConfig.flux2_klein_4b()
                if model == KLEIN_4B
                else ModelConfig.from_name(model, base_model=base_model)
            ),
        }
        precision = config.extra.get("compute_precision")
        if precision:
            import mlx.core as mx

            kwargs["compute_precision"] = getattr(mx, str(precision))

        self._model = Flux2KleinEdit(**kwargs)

    def generate(self, prompt: str, dest: Path, config) -> None:
        if self._model is None:
            raise RuntimeError("generate() before load()")

        kwargs: dict = {
            "seed": BASE_SEED,
            "prompt": prompt,
            "num_inference_steps": config.steps,
            "height": config.height,
            "width": config.width,
            "guidance": GUIDANCE,
        }
        if config.refs:
            kwargs["image_paths"] = list(config.refs)
            if config.extra.get("ref_strength") is not None:
                kwargs["image_strength"] = config.extra["ref_strength"]

        image = self._model.generate_image(**kwargs)
        dest.parent.mkdir(parents=True, exist_ok=True)
        image.save(path=dest, overwrite=True)
        if not dest.exists() or dest.stat().st_size == 0:
            raise RuntimeError("generate_image returned but no image was written")
