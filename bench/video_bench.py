"""Phase A of animation: can Wan2.2 TI2V-5B animate our stills on this Mac?

The same questions the Phase 0 gate asked of klein (PLAN.md section 3), now of
image-to-video: seconds per clip as median / p90 / worst, peak memory, and
whether a generation pushes the machine into swap — which on unified memory
disqualifies a configuration however fast it looks.

Each clip starts from a real still of the Aztec film, so the clips also answer
the question no number can: does the doodle style survive the motion, and does
the farmer stay the farmer.

The model runs through mlx-video's CLI in its own venv (work/video-bench/.venv),
so nothing here touches the pipeline's pinned environment. The CLI loads the
weights on every call: the seconds below include a cold load, and the per-clip
figure the pipeline would see with a warm model is lower by that load.

    python -m bench.video_bench --model-dir work/video-bench/models/Wan2.2-TI2V-5B-MLX \
        --label ti2v5b-s20 --steps 20

Standard library only, like the harness it borrows from.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

from .harness import MemorySampler, Stats, _vm_stat_counters, host_info, SWAP_NOISE_PAGES

ROOT = Path(__file__).resolve().parent.parent
FILM = ROOT / "work" / "who-are-the-aztec-583280"
VENV_PY = ROOT / "work" / "video-bench" / ".venv" / "bin" / "python"
OUT = ROOT / "bench" / "out" / "video"
RESULTS = ROOT / "bench" / "results"

#: What a beat's `animation` cue would say for these shots: one motion each,
#: the style named again so the model does not drift toward a photograph.
MOTION: dict[str, str] = {
    "S09": "the small wood fire flickers and sparks rise into the night, the farmer "
           "blinks and slowly turns his head toward the flames, stick figure doodle style",
    "S13": "the golden eagle beats its spread wings twice and settles on the cactus, "
           "reeds sway in the wind, stick figure doodle style",
    "S17": "the farmer swings the stone and hammers the wooden post down into the lake "
           "bed, brown water ripples outward, stick figure doodle style",
    "S29": "people walk between the rows of goods, a seller lifts a bundle and hands it "
           "over, cloth awnings flutter, stick figure doodle style",
}

NEGATIVE = "photograph, photorealistic, 3d render, text, letters, watermark, blurry, distorted, extra limbs"


def stills() -> dict[str, Path]:
    timeline = json.loads((FILM / "timeline.json").read_text())
    by_id = {s["shot_id"]: s for s in timeline["shots"]}
    # Image paths are relative to the shared work root, not the film's folder.
    return {sid: ROOT / "work" / by_id[sid]["image"]["path"] for sid in MOTION}


#: The CLI prints each phase's seconds. Encoding and loading are paid once by
#: a warm worker; denoising and decode are paid per clip.
PHASES = {
    "t5": r"T5 encoding: ([\d.]+)s",
    "image": r"Image encoding: ([\d.]+)s",
    "load": r"Models loaded: ([\d.]+)s",
    "denoise": r"Denoising: ([\d.]+)s",
    "decode": r"VAE decode: ([\d.]+)s",
    "total": r"Total time: ([\d.]+)s",
}


def phases(log_text: str) -> dict[str, float]:
    plain = re.sub(r"\x1b\[[0-9;]*m", "", log_text)
    found = {}
    for name, pattern in PHASES.items():
        m = re.search(pattern, plain)
        if m:
            found[name] = float(m.group(1))
    return found


def run_clip(args, sid: str, still: Path, dest: Path) -> dict:
    cmd = [
        str(VENV_PY), "-m", "mlx_video.models.wan_2.generate",
        "--model-dir", str(args.model_dir),
        "--image", str(still),
        "--prompt", MOTION[sid],
        "--negative-prompt", NEGATIVE,
        "--width", str(args.width), "--height", str(args.height),
        "--num-frames", str(args.frames),
        "--steps", str(args.steps),
        "--seed", str(args.seed),
        "--output-path", str(dest),
    ]
    if args.guide is not None:
        cmd += ["--guide-scale", str(args.guide)]
    if args.scheduler:
        cmd += ["--scheduler", args.scheduler]

    log_path = dest.with_suffix(".log")
    swap0 = _vm_stat_counters()
    t0 = time.perf_counter()
    with open(log_path, "w") as log, MemorySampler([]) as mem:
        proc = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT)
        mem.add_pid(proc.pid)
        code = proc.wait()
    seconds = time.perf_counter() - t0
    swap1 = _vm_stat_counters()
    swapouts = max(0, swap1.get("swapouts", 0) - swap0.get("swapouts", 0))
    ok = code == 0 and dest.exists() and dest.stat().st_size > 0
    ph = phases(log_path.read_text(errors="replace"))
    return {
        "shot": sid, "still": str(still.relative_to(ROOT)), "out": str(dest.relative_to(ROOT)),
        "log": str(log_path.relative_to(ROOT)), "ok": ok, "returncode": code,
        "seconds": round(seconds, 1), "phases": ph,
        "warm_seconds": round(ph["denoise"] + ph.get("decode", 0) + ph.get("image", 0), 1)
        if "denoise" in ph else None,
        "peak_rss_mb": round(mem.peak_kb / 1024),
        "swapouts": swapouts, "swapped": swapouts > SWAP_NOISE_PAGES,
    }


def report(args, runs: list[dict], host: dict) -> str:
    good = [r for r in runs if r["ok"]]
    st = Stats.of([r["seconds"] for r in good])
    clip_s = args.frames / 24
    lines = [
        f"# Video bench — {args.label}",
        "",
        f"{host.get('chip')}, {host.get('memory_gb')} GB, power {host.get('power_source')}",
        f"model `{args.model_dir}`, {args.width}x{args.height}, {args.frames} frames "
        f"({clip_s:.1f}s at 24 fps), {args.steps} steps, seed {args.seed}",
        "",
        "| shot | wall s | warm s | denoise | decode | load + T5 | peak RSS | swapouts | ok |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for r in runs:
        ph = r["phases"]
        lines.append(
            f"| {r['shot']} | {r['seconds']} | {r['warm_seconds'] or '—'} | {ph.get('denoise', '—')} "
            f"| {ph.get('decode', '—')} | {round(ph.get('load', 0) + ph.get('t5', 0), 1) or '—'} "
            f"| {r['peak_rss_mb']} MB | {r['swapouts']}{' (SWAP)' if r['swapped'] else ''} "
            f"| {'yes' if r['ok'] else 'NO'} |")
    if st.median is not None:
        lines += ["", f"Per clip, cold load included: median {st.median:.0f}s, p90 {st.p90:.0f}s, "
                      f"worst {st.worst:.0f}s."]
    warm = Stats.of([r["warm_seconds"] for r in good if r["warm_seconds"]])
    if warm.p90 is not None:
        # A warm worker pays load + T5 once per film, not per clip.
        lines.append(
            f"Per clip, warm (image encode + denoise + decode): median {warm.median:.0f}s, "
            f"p90 {warm.p90:.0f}s. Projected at p90: 10 animated shots {warm.p90 * 10 / 60:.0f} min, "
            f"25 shots {warm.p90 * 25 / 60:.0f} min, all 50 shots {warm.p90 * 50 / 60:.0f} min.")
    if any(r["swapped"] for r in runs):
        lines += ["", "**Swapped during generation: this configuration does not fit.**"]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--model-dir", type=Path, required=True)
    p.add_argument("--label", required=True)
    p.add_argument("--width", type=int, default=832)
    p.add_argument("--height", type=int, default=480)
    p.add_argument("--frames", type=int, default=121, help="4n+1; 121 is 5s at 24 fps")
    p.add_argument("--steps", type=int, default=20)
    p.add_argument("--guide", type=float, default=None)
    p.add_argument("--scheduler", default=None)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--shots", default=",".join(MOTION), help="comma-separated shot ids")
    args = p.parse_args(argv)

    if not VENV_PY.exists():
        print(f"no video venv at {VENV_PY}; see the module docstring", file=sys.stderr)
        return 2
    OUT.mkdir(parents=True, exist_ok=True)
    host = host_info()
    if host.get("power_source") != "ac":
        print(f"warning: power is {host.get('power_source')}; timings will be a lower bound")

    paths = stills()
    runs = []
    for sid in args.shots.split(","):
        dest = OUT / f"{args.label}_{sid}.mp4"
        print(f"{sid}: generating ...", flush=True)
        r = run_clip(args, sid, paths[sid], dest)
        print(f"{sid}: {r['seconds']}s, peak {r['peak_rss_mb']} MB, "
              f"swapouts {r['swapouts']}, {'ok' if r['ok'] else 'FAILED, see ' + r['log']}", flush=True)
        runs.append(r)

    stamp = time.strftime("%Y%m%d-%H%M%S")
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / f"video-{stamp}-{args.label}.json").write_text(json.dumps(
        {"args": {k: str(v) for k, v in vars(args).items()}, "host": host, "runs": runs}, indent=2))
    md = report(args, runs, host)
    (RESULTS / f"video-{stamp}-{args.label}.md").write_text(md)
    print("\n" + md)
    return 0 if all(r["ok"] for r in runs) else 1


if __name__ == "__main__":
    raise SystemExit(main())
