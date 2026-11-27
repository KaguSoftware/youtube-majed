"""The asset library: assets/sources.json -> files in assets/ -> assets/index.sqlite.

    uv run python -m studio_audio.assets seed     # copy legacy SFX, download Commons files, render synth ones
    uv run python -m studio_audio.assets index    # measure every file into assets/index.sqlite
    (from the repo root: pnpm assets seed | index)

`assets/sources.json` (committed) is the list of every asset the studio may
mix, with its licence: CC0, public domain or own work only (docs/PLAN.md
section 7). The audio files themselves stay local (gitignored).

- legacy: copied (never moved) from legacy/pipeline/sounds/, whose licence
  records live in legacy/pipeline/sfx.py. The three CC BY 3.0 laughs are not
  imported (they need a credit; the plan wants CC0 or Sonniss).
- commons: downloaded from Wikimedia Commons, checked against the SHA-1 the
  manifest records (taken from the Commons API with the licence), trimmed,
  resampled to 48 kHz, stored as FLAC.
- url: any other direct download (Free Music Archive, OpenGameArt music),
  handled like commons: SHA-1 checked, trimmed, resampled, stored as FLAC.
  The licence is the one shown on the track's own page (`source.url`).
- synth: rendered by studio_audio.sfx_synth.

The index stores per file: kind, tags, moods, length, loudness (integrated
LUFS, loudest 400 ms window, sample peak), where the sound starts and peaks,
loop points, and the licence. Node reads it (worker/src/assets.ts).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sqlite3
import subprocess
import ssl
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy.signal import lfilter, resample_poly

from . import sfx_synth
from .config import REPO

ASSETS = REPO / "assets"
SOURCES = ASSETS / "sources.json"
INDEX = ASSETS / "index.sqlite"
SR = 48_000
UA = {"User-Agent": "StudioAssetFetcher/0.1 (personal sound library indexer)"}

KINDS = {"sfx", "ambience", "riser", "hit", "whoosh", "music"}
LICENCES = {"CC0", "Public domain", "Own work"}


def load_sources() -> list[dict]:
    data = json.loads(SOURCES.read_text())
    seen = set()
    for a in data["assets"]:
        for key in ("id", "file", "kind", "tags", "moods", "description", "licence", "author", "source"):
            if key not in a:
                raise SystemExit(f"sources.json: {a.get('id', '?')} has no {key}")
        if a["kind"] not in KINDS:
            raise SystemExit(f"sources.json: {a['id']}: unknown kind {a['kind']!r}")
        if a["licence"]["name"] not in LICENCES:
            raise SystemExit(f"sources.json: {a['id']}: licence {a['licence']['name']!r} is not CC0, public domain or own work")
        if a["id"] in seen:
            raise SystemExit(f"sources.json: {a['id']} appears twice")
        seen.add(a["id"])
    return data["assets"]


# ---------------------------------------------------------------- seed


def _ssl() -> ssl.SSLContext:
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def _download(url: str, dest: Path) -> None:
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120, context=_ssl()) as r, dest.open("wb") as f:
                shutil.copyfileobj(r, f)
            return
        except Exception as e:  # Commons rate-limits bursts (429): back off and retry
            print(f"    retry {attempt + 1}: {e}")
            time.sleep(60 * (attempt + 1))
    raise SystemExit(f"could not download {url}")


def _decode(path: Path) -> tuple[np.ndarray, int]:
    """soundfile first; ffmpeg for codecs libsndfile lacks (some Commons Ogg files)."""
    try:
        audio, sr = sf.read(path, always_2d=True, dtype="float32")
        return audio, sr
    except sf.LibsndfileError:
        wav = path.with_suffix(".wav")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(path), "-ar", str(SR), "-c:a", "pcm_f32le", str(wav)], check=True)
        audio, sr = sf.read(wav, always_2d=True, dtype="float32")
        return audio, sr


def _to48k(audio: np.ndarray, sr: int) -> np.ndarray:
    if sr == SR:
        return audio
    g = np.gcd(sr, SR)
    return resample_poly(audio, SR // g, sr // g, axis=0)


def _write(path: Path, audio: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    peak = np.abs(audio).max()
    if peak > 0.999:
        audio = audio / peak * 0.999
    sf.write(path, audio.astype(np.float32), SR, subtype="PCM_24")


def seed(only: set[str] | None = None, force: bool = False) -> None:
    for a in load_sources():
        if only and a["id"] not in only:
            continue
        dest = ASSETS / a["file"]
        if dest.exists() and not force:
            continue
        src = a["source"]
        print(f"  {a['id']}")
        if src["type"] == "legacy":
            legacy = REPO / src["ref"]
            if not legacy.exists():
                print(f"    ! {legacy} is missing; skipped")
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(legacy, dest)  # copy, never move: legacy/ is read-only
        elif src["type"] in ("commons", "url"):
            with tempfile.TemporaryDirectory() as tmp:
                raw = Path(tmp) / ("download" + Path(src["download"].split("?")[0]).suffix)
                _download(src["download"].split("?")[0], raw)
                sha1 = hashlib.sha1(raw.read_bytes()).hexdigest()
                if sha1 != src["sha1"]:
                    raise SystemExit(f"{a['id']}: SHA-1 {sha1} does not match the manifest ({src['sha1']}); the file at the source changed")
                audio, sr = _decode(raw)
            if "trim" in a:
                s, e = a["trim"]
                audio = audio[int(s * sr) : int(e * sr)]
            _write(dest, _to48k(audio, sr))
            if src["type"] == "commons":
                time.sleep(20)  # Wikimedia asks automated clients to go slowly
        elif src["type"] == "synth":
            name = src["ref"].split(".", 1)[1]
            _write(dest, sfx_synth.RECIPES[name]().T)
        else:
            raise SystemExit(f"{a['id']}: unknown source type {src['type']!r}")


# ---------------------------------------------------------------- index

# BS.1770 K-weighting at 48 kHz (pre-filter shelf, then the RLB high-pass)
_K1 = ([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585])
_K2 = ([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621])


def loudest_window(audio: np.ndarray, window: float = 0.4) -> float:
    """Loudest momentary loudness (LUFS, 400 ms K-weighted window): the level of a one-shot."""
    k = lfilter(*_K2, lfilter(*_K1, audio, axis=0), axis=0)
    power = (k**2).sum(axis=1)
    n = int(window * SR)
    if len(power) <= n:
        return float(-0.691 + 10 * np.log10(max(power.mean(), 1e-12)))
    c = np.concatenate([[0.0], np.cumsum(power)])
    hop = int(0.05 * SR)
    means = (c[n::hop] - c[: len(c) - n : hop][: len(c[n::hop])]) / n
    return float(-0.691 + 10 * np.log10(max(means.max(), 1e-12)))


def measure(path: Path) -> dict:
    audio, sr = sf.read(path, always_2d=True, dtype="float64")
    audio = _to48k(audio, sr)
    dur = len(audio) / SR
    mono = np.abs(audio).max(axis=1)
    peak = float(mono.max())
    env = np.convolve(mono, np.ones(int(0.005 * SR)) / int(0.005 * SR), mode="same")
    above = np.nonzero(env > peak * 10 ** (-30 / 20))[0]
    rms = np.sqrt(np.convolve((audio**2).mean(axis=1), np.ones(int(0.05 * SR)) / int(0.05 * SR), mode="same"))
    lufs = None
    if dur >= 0.5:
        v = pyln.Meter(SR).integrated_loudness(audio)
        lufs = float(v) if np.isfinite(v) else None
    return {
        "duration": dur,
        "sample_rate": sr,
        "channels": audio.shape[1],
        "lufs": lufs,
        "loudest": loudest_window(audio),
        "peak_db": float(20 * np.log10(max(peak, 1e-9))),
        "onset": float(above[0] / SR) if len(above) else 0.0,
        "peak_at": float(np.argmax(rms) / SR),
    }


SCHEMA = """
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  file TEXT NOT NULL,
  kind TEXT NOT NULL,
  tags TEXT NOT NULL,
  moods TEXT NOT NULL,
  description TEXT NOT NULL,
  duration REAL NOT NULL,
  sample_rate INTEGER NOT NULL,
  channels INTEGER NOT NULL,
  lufs REAL,
  loudest REAL NOT NULL,
  peak_db REAL NOT NULL,
  onset REAL NOT NULL,
  peak_at REAL NOT NULL,
  loop_start REAL,
  loop_end REAL,
  licence TEXT NOT NULL,
  licence_url TEXT,
  author TEXT,
  source_url TEXT,
  sha256 TEXT NOT NULL,
  indexed_at TEXT NOT NULL
);
CREATE INDEX assets_kind ON assets(kind);
"""


def index() -> dict:
    rows, missing = [], []
    for a in load_sources():
        path = ASSETS / a["file"]
        if not path.exists():
            missing.append(a["id"])
            continue
        m = measure(path)
        loop = a.get("loop")
        if loop is None and a["kind"] in ("ambience", "music"):
            loop = [0.0, m["duration"]]  # the mixer crossfades at the loop point
        rows.append(
            (
                a["id"], a["file"], a["kind"], json.dumps(a["tags"]), json.dumps(a["moods"]), a["description"],
                m["duration"], m["sample_rate"], m["channels"], m["lufs"], m["loudest"], m["peak_db"], m["onset"], m["peak_at"],
                loop[0] if loop else None, loop[1] if loop else None,
                a["licence"]["name"], a["licence"].get("url"), a.get("author"), a["source"].get("url"),
                hashlib.sha256(path.read_bytes()).hexdigest(), datetime.now(timezone.utc).isoformat(),
            )
        )
    tmp = INDEX.with_suffix(".sqlite.tmp")
    tmp.unlink(missing_ok=True)
    db = sqlite3.connect(tmp)
    db.executescript(SCHEMA)
    db.executemany(f"INSERT INTO assets VALUES ({','.join('?' * 22)})", rows)
    db.commit()
    db.close()
    tmp.replace(INDEX)
    return {"indexed": len(rows), "missing": missing}


def summary() -> None:
    db = sqlite3.connect(INDEX)
    print("\n  kind       files  licences")
    for kind, n in db.execute("SELECT kind, COUNT(*) FROM assets GROUP BY kind ORDER BY kind"):
        lic = ", ".join(f"{l} {c}" for l, c in db.execute("SELECT licence, COUNT(*) FROM assets WHERE kind=? GROUP BY licence ORDER BY licence", (kind,)))
        print(f"  {kind:<10} {n:>5}  {lic}")
    total = db.execute("SELECT COUNT(*), SUM(duration) FROM assets").fetchone()
    print(f"  total      {total[0]:>5}  ({total[1] / 60:.1f} min of audio)")


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="studio_audio.assets")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("seed")
    s.add_argument("--only", nargs="*")
    s.add_argument("--force", action="store_true")
    sub.add_parser("index")
    sub.add_parser("summary")
    args = p.parse_args(argv)
    if args.cmd == "seed":
        seed(set(args.only) if args.only else None, args.force)
        print("✓ seeded; now: pnpm assets index")
    elif args.cmd == "index":
        r = index()
        print(f"✓ {r['indexed']} assets indexed → {INDEX}")
        if r["missing"]:
            print(f"  ! {len(r['missing'])} listed but not on disk (run `pnpm assets seed`): {', '.join(r['missing'])}")
        summary()
    else:
        summary()


if __name__ == "__main__":
    main(sys.argv[1:])
