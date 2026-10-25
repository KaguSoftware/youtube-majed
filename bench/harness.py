"""Measurement machinery for the Phase 0 benchmark gate.

Answers exactly the questions PLAN.md section 3 requires before any
pipeline code gets written:

  - warm steady-state seconds per image, as median / p90 / worst (not best)
  - cold model-load time, measured separately and never folded into the above
  - peak memory, and whether the run pushed the machine into swap

Swap is tracked because on unified memory a run that swaps is not merely
slow, it invalidates the timing entirely. A result with a nonzero swap
delta should be read as "this configuration does not fit", regardless of
how good the seconds-per-image looks.

Standard library only, so the harness itself can never be blocked by a
backend's dependency problems.
"""

from __future__ import annotations

import json
import platform
import statistics
import subprocess
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Sequence

# ---------------------------------------------------------------- swap


def _vm_stat_counters() -> dict[str, int]:
    """Read swapin/swapout counters from vm_stat. Empty dict off-macOS."""
    try:
        out = subprocess.run(
            ["vm_stat"], capture_output=True, text=True, timeout=10
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return {}

    counters: dict[str, int] = {}
    for line in out.splitlines():
        low = line.lower()
        for key, label in (("swapins", "swapins"), ("swapouts", "swapouts")):
            if label in low:
                digits = "".join(c for c in line if c.isdigit())
                if digits:
                    counters[key] = int(digits)
    return counters


# ---------------------------------------------------------- mem sampler


class MemorySampler:
    """Polls RSS of a set of pids via `ps`, tracking the peak.

    Used instead of psutil to keep the harness dependency-free, and
    instead of getrusage because a backend may be a long-lived server
    process (ComfyUI) rather than a child of this process.
    """

    def __init__(self, pids: Sequence[int], interval: float = 0.25) -> None:
        self._pids = list(pids)
        self._interval = interval
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.peak_kb = 0

    def _sample_once(self) -> int:
        if not self._pids:
            return 0
        args = ["ps", "-o", "rss="]
        for pid in self._pids:
            args += ["-p", str(pid)]
        try:
            out = subprocess.run(
                args, capture_output=True, text=True, timeout=5
            ).stdout
        except (OSError, subprocess.SubprocessError):
            return 0
        total = 0
        for line in out.split():
            if line.strip().isdigit():
                total += int(line.strip())
        return total

    def _loop(self) -> None:
        while not self._stop.is_set():
            self.peak_kb = max(self.peak_kb, self._sample_once())
            self._stop.wait(self._interval)

    def add_pid(self, pid: int) -> None:
        if pid not in self._pids:
            self._pids.append(pid)

    def __enter__(self) -> "MemorySampler":
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *_exc: object) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)


# ------------------------------------------------------------- records


@dataclass
class RunConfig:
    backend: str
    label: str
    width: int = 832
    height: int = 480
    steps: int = 4
    quant: str = "int4"
    n_images: int = 8
    warmup: int = 1
    refs: list[str] = field(default_factory=list)
    extra: dict = field(default_factory=dict)

    @property
    def megapixels(self) -> float:
        return (self.width * self.height) / 1_000_000


@dataclass
class ImageTiming:
    index: int
    seconds: float
    is_warmup: bool
    ok: bool = True
    error: str | None = None
    out_path: str | None = None


@dataclass
class Stats:
    count: int = 0
    median: float | None = None
    p90: float | None = None
    mean: float | None = None
    best: float | None = None
    worst: float | None = None
    stdev: float | None = None

    @classmethod
    def of(cls, values: Sequence[float]) -> "Stats":
        vals = sorted(values)
        if not vals:
            return cls()
        idx = min(len(vals) - 1, int(round(0.9 * (len(vals) - 1))))
        return cls(
            count=len(vals),
            median=statistics.median(vals),
            p90=vals[idx],
            mean=statistics.fmean(vals),
            best=vals[0],
            worst=vals[-1],
            stdev=statistics.stdev(vals) if len(vals) > 1 else 0.0,
        )


#: Swapouts below this many pages (~10 MB at 4 KiB/page) in the measured
#: window are background noise, not memory pressure.
SWAP_NOISE_PAGES = 2500

#: Peak memory above this fraction of physical RAM makes swap plausibly ours.
#: Below it, concurrent swap almost certainly came from somewhere else.
MEMORY_PRESSURE_RATIO = 0.60


@dataclass
class BenchResult:
    config: RunConfig
    cold_load_s: float | None
    timings: list[ImageTiming]
    steady: Stats
    peak_rss_mb: float
    backend_peak_mb: float | None
    swap_delta: dict[str, int]
    host: dict
    started_at: str
    #: swap during load/download only — never used for the verdict
    swap_delta_load: dict[str, int] = field(default_factory=dict)
    #: swap during the measured generations only — this is what counts
    swap_delta_steady: dict[str, int] = field(default_factory=dict)
    failed: bool = False
    failure: str | None = None

    @property
    def peak_mb(self) -> float:
        """Largest footprint either source saw.

        MLX's counter tracks only its own buffers, not total process RSS
        (interpreter, mmapped weights, VAE staging). Preferring it understated
        the real footprint and let the headroom check mislabel genuine memory
        pressure as someone else's swap. Take whichever is larger.
        """
        return max(self.backend_peak_mb or 0.0, self.peak_rss_mb or 0.0)

    @property
    def memory_ratio(self) -> float | None:
        """Peak as a fraction of physical RAM."""
        gb = self.host.get("memory_gb")
        return None if not gb else self.peak_mb / (gb * 1024)

    @property
    def steady_swapouts(self) -> int:
        return int(self.swap_delta_steady.get("swapouts", 0))

    @property
    def swapped(self) -> bool:
        """Meaningful swap *during generation*, not across the whole run."""
        return self.steady_swapouts > SWAP_NOISE_PAGES

    @property
    def swap_is_exogenous(self) -> bool:
        """Swap seen while this run used far too little memory to cause it.

        vm_stat counters are system-wide and cumulative, so a concurrent
        download or another app lands here. Attributing that to the model
        under test is how a sound configuration gets failed — which is
        exactly what happened on the first real Phase 0 run.
        """
        ratio = self.memory_ratio
        return self.swapped and ratio is not None and ratio < MEMORY_PRESSURE_RATIO

    @property
    def seconds_per_mp(self) -> float | None:
        if self.steady.median is None or not self.config.megapixels:
            return None
        return self.steady.median / self.config.megapixels

    def projected_job_minutes(self, shots: int = 60) -> float | None:
        """Wall-clock for a real job: cold load once, then p90 per shot.

        p90 rather than median, because a 60-shot job is long enough that
        the slow tail is what you actually wait for.
        """
        if self.steady.p90 is None:
            return None
        return ((self.cold_load_s or 0) + self.steady.p90 * shots) / 60

    def to_dict(self) -> dict:
        d = asdict(self)
        d["swapped"] = self.swapped
        d["swap_is_exogenous"] = self.swap_is_exogenous
        d["memory_ratio"] = self.memory_ratio
        d["steady_swapouts"] = self.steady_swapouts
        d["seconds_per_megapixel"] = self.seconds_per_mp
        d["projected_60_shot_minutes"] = self.projected_job_minutes(60)
        return d


def host_info() -> dict:
    def sysctl(key: str) -> str | None:
        try:
            return subprocess.run(
                ["sysctl", "-n", key], capture_output=True, text=True, timeout=5
            ).stdout.strip()
        except (OSError, subprocess.SubprocessError):
            return None

    mem = sysctl("hw.memsize")

    # Apple Silicon reduces GPU performance on battery, so a result taken
    # unplugged is a lower bound, not a measurement. Recorded because Phase 0
    # produced a set of degraded 1024x1024 timings before anyone noticed.
    power = "unknown"
    try:
        batt = subprocess.run(
            ["pmset", "-g", "batt"], capture_output=True, text=True, timeout=5
        ).stdout
        if "AC Power" in batt:
            power = "ac"
        elif "Battery Power" in batt:
            pct = "".join(c for c in batt.split("\t")[-1][:4] if c.isdigit())
            power = f"battery ({pct}%)" if pct else "battery"
    except (OSError, subprocess.SubprocessError):
        pass

    return {
        "power_source": power,
        "platform": platform.platform(),
        "machine": platform.machine(),
        "python": platform.python_version(),
        "chip": sysctl("machdep.cpu.brand_string"),
        "cpu_count": sysctl("hw.ncpu"),
        "memory_gb": round(int(mem) / 1024**3, 1) if mem and mem.isdigit() else None,
    }


# ----------------------------------------------------------- the runner


def measure(backend, config: RunConfig, out_dir: Path) -> BenchResult:
    """Run one configuration against one backend and measure it."""
    out_dir.mkdir(parents=True, exist_ok=True)
    started = time.strftime("%Y-%m-%dT%H:%M:%S")
    swap_before = _vm_stat_counters()
    timings: list[ImageTiming] = []
    cold_load_s: float | None = None
    swap_after_load: dict[str, int] = {}
    failed, failure = False, None

    import os

    with MemorySampler([os.getpid()]) as sampler:
        try:
            t0 = time.perf_counter()
            backend.load(config)
            cold_load_s = time.perf_counter() - t0
            swap_after_load = _vm_stat_counters()

            for pid in getattr(backend, "pids", lambda: [])():
                sampler.add_pid(pid)

            total = config.warmup + config.n_images
            for i in range(total):
                is_warm = i < config.warmup
                prompt = backend.prompt_for(i)
                dest = out_dir / f"{config.label}_{i:03d}.png"
                t1 = time.perf_counter()
                try:
                    backend.generate(prompt, dest, config)
                    elapsed = time.perf_counter() - t1
                    timings.append(
                        ImageTiming(i, elapsed, is_warm, out_path=str(dest))
                    )
                except Exception as exc:  # one bad image must not void the run
                    timings.append(
                        ImageTiming(
                            i,
                            time.perf_counter() - t1,
                            is_warm,
                            ok=False,
                            error=f"{type(exc).__name__}: {exc}",
                        )
                    )
        except Exception as exc:
            failed, failure = True, f"{type(exc).__name__}: {exc}"
        finally:
            try:
                backend.unload()
            except Exception:
                pass

    swap_after = _vm_stat_counters()
    def _delta(a: dict, b: dict) -> dict:
        return {k: max(0, b.get(k, 0) - a.get(k, 0)) for k in set(a) | set(b)}

    swap_delta = _delta(swap_before, swap_after)
    swap_delta_load = _delta(swap_before, swap_after_load)
    # generations only: excludes weight load and any first-run download
    swap_delta_steady = _delta(swap_after_load, swap_after)

    steady_vals = [t.seconds for t in timings if not t.is_warmup and t.ok]

    return BenchResult(
        config=config,
        cold_load_s=cold_load_s,
        timings=timings,
        steady=Stats.of(steady_vals),
        peak_rss_mb=round(sampler.peak_kb / 1024, 1),
        backend_peak_mb=backend.peak_memory_mb(),
        swap_delta=swap_delta,
        swap_delta_load=swap_delta_load,
        swap_delta_steady=swap_delta_steady,
        host=host_info(),
        started_at=started,
        failed=failed,
        failure=failure,
    )


def save_json(results: list[BenchResult], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps([r.to_dict() for r in results], indent=2, default=str)
    )
