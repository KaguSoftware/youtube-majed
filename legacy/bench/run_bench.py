#!/usr/bin/env python3
"""Phase 0 benchmark runner.

    # validate the harness itself, no weights needed
    python -m bench.run_bench --backend synthetic

    # the real measurement, once mflux is installed
    python -m bench.run_bench --backend mflux-warm --quant int4,int8 \
        --res 832x480,1024x1024 --n 8

    # what a process-per-image worker would cost
    python -m bench.run_bench --backend mflux-cli --quant int4 --n 4

Writes JSON and a markdown report to bench/results/. A backend that fails
preflight is skipped with a reason rather than aborting the matrix, so one
missing dependency never costs you the rest of the run.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from .harness import RunConfig, measure, save_json
from . import report as report_mod

RESULTS_DIR = Path(__file__).resolve().parent / "results"
OUT_DIR = Path(__file__).resolve().parent / "out"


def build_backend(name: str, args):
    if name == "synthetic":
        from .backends.synthetic import SyntheticBackend

        return SyntheticBackend()
    if name == "mflux-warm":
        from .backends.mflux_klein import MfluxWarmBackend

        return MfluxWarmBackend(args.prompts or None)
    if name == "mflux-edit-warm":
        from .backends.mflux_klein import MfluxEditWarmBackend

        return MfluxEditWarmBackend(args.prompts or None)
    if name == "mflux-cli":
        from .backends.mflux_klein import MfluxCliBackend

        return MfluxCliBackend()
    if name == "comfyui":
        from .backends.comfy import ComfyBackend

        if not args.workflow:
            raise SystemExit("--workflow is required for the comfyui backend")
        return ComfyBackend(args.workflow, server=args.comfy_server)
    raise SystemExit(f"unknown backend {name!r}")


def parse_res(spec: str) -> list[tuple[int, int]]:
    out = []
    for item in spec.split(","):
        item = item.strip().lower()
        if not item:
            continue
        if "x" not in item:
            raise SystemExit(f"bad --res {item!r}, expected WIDTHxHEIGHT")
        w, h = item.split("x", 1)
        out.append((int(w), int(h)))
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Phase 0 image-generation benchmark")
    p.add_argument("--backend", default="synthetic",
                   help="comma list: synthetic,mflux-warm,mflux-edit-warm,mflux-cli,comfyui")
    p.add_argument("--quant", default="int4", help="comma list: int4,int8,bf16")
    p.add_argument("--res", default="832x480", help="comma list, e.g. 832x480,1024x1024")
    p.add_argument("--steps", type=int, default=4)
    p.add_argument("--n", type=int, default=8, help="measured images per config")
    p.add_argument("--warmup", type=int, default=1,
                   help="unmeasured images first; absorbs graph compile")
    p.add_argument("--shots", type=int, default=60, help="shots per job, for projection")
    p.add_argument("--refs", default="", help="comma list of reference image paths")
    p.add_argument("--ref-strength", type=float, default=0.4)
    p.add_argument("--workflow", default="", help="ComfyUI workflow JSON")
    p.add_argument("--comfy-server", default="127.0.0.1:8188")
    p.add_argument("--skip-preflight", action="store_true")
    p.add_argument("--tag", default="", help="suffix for output filenames")
    p.add_argument("--prompts", default="",
                   help="alternate prompt file, e.g. consistency.txt")
    args = p.parse_args(argv)

    backends = [b.strip() for b in args.backend.split(",") if b.strip()]
    quants = [q.strip() for q in args.quant.split(",") if q.strip()]
    resolutions = parse_res(args.res)
    refs = [r.strip() for r in args.refs.split(",") if r.strip()]

    report_mod.SHOTS_PER_JOB = args.shots

    results = []
    skipped: list[str] = []

    for backend_name in backends:
        # synthetic has no real quantization; one pass is enough
        quant_list = ["int4"] if backend_name == "synthetic" else quants

        try:
            backend = build_backend(backend_name, args)
        except SystemExit:
            raise
        except Exception as exc:
            skipped.append(f"{backend_name}: could not construct ({exc})")
            print(f"  SKIP {backend_name}: {exc}", file=sys.stderr)
            continue

        if not args.skip_preflight:
            ok, msg = backend.preflight()
            if not ok:
                skipped.append(f"{backend_name}: {msg}")
                print(f"  SKIP {backend_name}: {msg}", file=sys.stderr)
                continue

        for quant in quant_list:
            for width, height in resolutions:
                label = f"{quant}-{width}x{height}-s{args.steps}"
                cfg = RunConfig(
                    backend=backend_name,
                    label=label,
                    width=width,
                    height=height,
                    steps=args.steps,
                    quant=quant,
                    n_images=args.n,
                    warmup=args.warmup,
                    refs=refs,
                    extra={"ref_strength": args.ref_strength} if refs else {},
                )

                print(f"\n=== {backend_name} / {label} ===", flush=True)
                print(
                    f"    {args.warmup} warmup + {args.n} measured "
                    f"@ {width}×{height}, {args.steps} steps, {quant}",
                    flush=True,
                )

                # fresh instance per config so cold-load is honest
                run_backend = build_backend(backend_name, args)
                started = time.perf_counter()
                result = measure(run_backend, cfg, OUT_DIR / backend_name / label)

                if result.failed:
                    print(f"    FAILED: {result.failure}", flush=True)
                else:
                    for t in result.timings:
                        kind = "warmup " if t.is_warmup else "measured"
                        status = "" if t.ok else f"  ERROR {t.error}"
                        print(f"    [{kind} {t.index:02d}] {t.seconds:7.2f}s{status}",
                              flush=True)
                    print(
                        f"    cold load {result.cold_load_s:.2f}s · "
                        f"median {result.steady.median or float('nan'):.2f}s · "
                        f"p90 {result.steady.p90 or float('nan'):.2f}s · "
                        f"peak {(result.backend_peak_mb or result.peak_rss_mb)/1024:.1f} GB"
                        + ("  ** SWAPPED **" if result.swapped else ""),
                        flush=True,
                    )
                print(f"    wall {time.perf_counter() - started:.1f}s", flush=True)
                results.append(result)

    if not results:
        print("\nNo configurations ran.", file=sys.stderr)
        for s in skipped:
            print(f"  - {s}", file=sys.stderr)
        return 1

    synthetic_only = all(r.config.backend == "synthetic" for r in results)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    suffix = f"-{args.tag}" if args.tag else ""
    json_path = RESULTS_DIR / f"bench-{stamp}{suffix}.json"
    md_path = RESULTS_DIR / f"bench-{stamp}{suffix}.md"

    save_json(results, json_path)
    report_mod.save(results, md_path, synthetic=synthetic_only)

    print("\n" + "=" * 68)
    print(report_mod.render(results, synthetic=synthetic_only))
    print("=" * 68)
    if skipped:
        print("\nSkipped backends:")
        for s in skipped:
            print(f"  - {s}")
    print(f"\nJSON:   {json_path}")
    print(f"Report: {md_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
