"""Turns measurements into the decision PLAN.md section 3 asks for.

The exit criterion is not "we collected numbers", it is a runtime choice plus a
defensible estimate for a 60-shot job. So the report states a verdict per
configuration and a recommendation, rather than leaving a table to interpret.
"""

from __future__ import annotations

from pathlib import Path

from .harness import BenchResult

#: A 60-shot job slower than this makes iteration painful enough that PLAN.md
#: section 6 says to move the worker to a rented GPU.
JOB_MINUTES_BUDGET = 60.0
SHOTS_PER_JOB = 60


def _fmt(value: float | None, unit: str = "s", places: int = 2) -> str:
    return "—" if value is None else f"{value:.{places}f}{unit}"


def verdict(result: BenchResult) -> tuple[str, str]:
    """(symbol, reason). Swap is disqualifying regardless of speed."""
    if result.failed:
        return "FAIL", f"run failed: {result.failure}"

    errors = [t for t in result.timings if not t.ok]
    if errors and len(errors) == len([t for t in result.timings]):
        return "FAIL", "every image failed"

    ratio = result.memory_ratio

    # Real memory pressure: swap during generation while we hold a large share
    # of RAM. Disqualifying, because the timings no longer mean anything.
    if result.swapped and not result.swap_is_exogenous:
        return (
            "FAIL",
            f"swapped during generation ({result.steady_swapouts} pages) while "
            f"holding {ratio:.0%} of RAM — timings invalid, configuration does "
            "not fit in memory",
        )

    projected = result.projected_job_minutes(SHOTS_PER_JOB)
    if projected is None:
        return "FAIL", "no successful steady-state images"

    note = f"{projected:.1f} min for {SHOTS_PER_JOB} shots"
    if errors:
        note += f"; {len(errors)} image(s) errored"

    # Swap seen, but we were nowhere near filling memory, so it came from
    # elsewhere on the machine. Worth saying; not worth failing over.
    if result.swap_is_exogenous:
        note += (
            f"; {result.steady_swapouts} swapouts observed at only {ratio:.0%} "
            "of RAM — attributed to other processes, timings may be noisy"
        )

    if projected <= JOB_MINUTES_BUDGET:
        return "PASS", note
    return "OVER", note + f" — exceeds the {JOB_MINUTES_BUDGET:.0f} min budget"


def render(results: list[BenchResult], synthetic: bool = False) -> str:
    lines: list[str] = []
    add = lines.append

    add("# Phase 0 — benchmark results")
    add("")
    if synthetic:
        add("> **SYNTHETIC RUN — these numbers are fabricated.** They exist only to")
        add("> validate the harness. Do not use them for any decision.")
        add("")

    if results:
        host = results[0].host
        add(
            f"Host: {host.get('chip') or host.get('machine')} · "
            f"{host.get('memory_gb')} GB · {host.get('cpu_count')} cores · "
            f"python {host.get('python')}"
        )
        add(f"Started: {results[0].started_at}")
        add("")

    add("## Results")
    add("")
    add(
        "Cold load is weight-load time, which on a first run also includes the "
        "model download — discard it there. Swap is measured over the "
        "generation phase only; `ext` means swap was seen while this run held "
        "too little memory to have caused it."
    )
    add("")
    add(
        "| backend | config | res | steps | cold load | median | p90 | worst | "
        "peak mem | swap | 60-shot | verdict |"
    )
    add("|---|---|---|---|---|---|---|---|---|---|---|---|")

    for r in results:
        sym, _reason = verdict(r)
        c = r.config
        peak = r.backend_peak_mb or r.peak_rss_mb
        peak_src = "mlx" if r.backend_peak_mb else "rss"
        add(
            f"| `{c.backend}` | {c.label} | {c.width}×{c.height} | {c.steps} "
            f"| {_fmt(r.cold_load_s)} | **{_fmt(r.steady.median)}** "
            f"| {_fmt(r.steady.p90)} | {_fmt(r.steady.worst)} "
            f"| {peak/1024:.1f} GB ({peak_src}) "
            f"| {('ext' if r.swap_is_exogenous else 'YES') if r.swapped else 'no'} "
            f"| {_fmt(r.projected_job_minutes(SHOTS_PER_JOB), ' min', 1)} "
            f"| {sym} |"
        )

    add("")
    add("## Verdicts")
    add("")
    for r in results:
        sym, reason = verdict(r)
        add(f"- **{sym}** · `{r.config.backend}` / {r.config.label} — {reason}")

    # The headline efficiency finding: what keeping the model warm is worth.
    warm = _best(results, "mflux-warm")
    cli = _best(results, "mflux-cli")
    if warm and cli and warm.steady.median and cli.steady.median:
        delta = cli.steady.median - warm.steady.median
        factor = cli.steady.median / warm.steady.median
        add("")
        add("## Cost of not keeping the model warm")
        add("")
        add(
            f"Warm in-process: **{warm.steady.median:.2f}s** per image. "
            f"CLI per image (reloads weights every time): **{cli.steady.median:.2f}s**."
        )
        add("")
        add(
            f"That is **{delta:.2f}s of pure waste per image, a {factor:.1f}× penalty** "
            f"— about {delta * SHOTS_PER_JOB / 60:.1f} minutes thrown away on a "
            f"{SHOTS_PER_JOB}-shot job. The worker must hold the model in memory "
            "across all shots; spawning a process per image is not an acceptable "
            "shortcut."
        )

    add("")
    add("## Recommendation")
    add("")
    passing = [r for r in results if verdict(r)[0] == "PASS"]
    if synthetic:
        add("No recommendation from a synthetic run. Install a real backend and rerun.")
    elif passing:
        best = min(passing, key=lambda r: r.steady.p90 or float("inf"))
        add(
            f"Use **`{best.config.backend}` / {best.config.label}** "
            f"({best.config.width}×{best.config.height}, {best.config.steps} steps): "
            f"median {_fmt(best.steady.median)}, p90 {_fmt(best.steady.p90)}, "
            f"projected {_fmt(best.projected_job_minutes(SHOTS_PER_JOB), ' min', 1)} "
            f"for {SHOTS_PER_JOB} shots."
        )
        add("")
        add("Phase 0 exit criterion met. Proceed to Phase 1.")
    else:
        over = [r for r in results if verdict(r)[0] == "OVER"]
        swapped = [r for r in results if r.swapped]
        add("**Phase 0 exit criterion not met on this machine.**")
        add("")
        if swapped:
            add(
                f"{len(swapped)} configuration(s) swapped — those do not fit in "
                "unified memory. Try a smaller quantization or lower resolution."
            )
        if over:
            fastest = min(over, key=lambda r: r.projected_job_minutes(SHOTS_PER_JOB) or 1e9)
            add(
                f"Fastest viable configuration projects "
                f"{_fmt(fastest.projected_job_minutes(SHOTS_PER_JOB), ' min', 1)} per "
                f"{SHOTS_PER_JOB}-shot job. Per PLAN.md section 6 this is the trigger to "
                "decide on a rented GPU now rather than in Phase 3 — the worker is a "
                "stateless client, so relocating it is a deployment change."
            )
    add("")
    return "\n".join(lines)


def _best(results: list[BenchResult], backend: str) -> BenchResult | None:
    candidates = [
        r
        for r in results
        if r.config.backend == backend and r.steady.median is not None and not r.failed
    ]
    return min(candidates, key=lambda r: r.steady.median) if candidates else None


def save(results: list[BenchResult], path: Path, synthetic: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render(results, synthetic=synthetic))
