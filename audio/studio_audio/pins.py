"""Model pins: every weight file the audio service loads comes from a fixed
Hugging Face commit, and `pins.lock.json` records the size and SHA-256 of each
file at that commit (taken from the Hub's own metadata).

    uv run python -m studio_audio.pins fetch          # download the pinned snapshots
    uv run python -m studio_audio.pins check [--deep]  # do the local files match the lock?
    uv run python -m studio_audio.pins lock            # rewrite pins.lock.json from the Hub

Why: an unpinned `from_pretrained` takes `main`, so a model can change under
the pipeline without anything failing; the voice just sounds different. The
idea comes from legacy/pipeline/pins.py. The Python packages are pinned by
`uv.lock`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from dataclasses import dataclass
from pathlib import Path

from huggingface_hub import HfApi, snapshot_download

LOCK = Path(__file__).resolve().parent.parent / "pins.lock.json"


@dataclass(frozen=True)
class Model:
    key: str
    repo: str
    revision: str
    licence: str
    patterns: tuple[str, ...]  # the files the loader actually reads


MODELS: dict[str, Model] = {
    # Plan section 5's pick. Ignores exaggeration / cfg_weight (see README).
    "turbo": Model(
        "turbo", "ResembleAI/chatterbox-turbo", "749d1c1a46eb10492095d68fbcf55691ccf137cd", "MIT",
        ("*.safetensors", "*.json", "*.txt", "conds.pt"),
    ),
    # Original English Chatterbox: honours exaggeration and cfg_weight.
    "original": Model(
        "original", "ResembleAI/chatterbox", "5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18", "MIT",
        ("ve.safetensors", "t3_cfg.safetensors", "s3gen.safetensors", "tokenizer.json", "conds.pt"),
    ),
    # wav2vec2 CTC model WhisperX uses for English forced alignment, fetched
    # from the Hub instead of torchaudio's unversioned download URL.
    "align": Model(
        "align", "facebook/wav2vec2-base-960h", "22aad52d435eb6dbaf354bdad9b0da84ce7d6156", "Apache-2.0",
        ("config.json", "model.safetensors", "preprocessor_config.json", "special_tokens_map.json", "tokenizer_config.json", "vocab.json"),
    ),
}


def snapshot(key: str) -> Path:
    """Local path of a pinned snapshot, downloading it on first use."""
    m = MODELS[key]
    return Path(snapshot_download(repo_id=m.repo, revision=m.revision, allow_patterns=list(m.patterns)))


def _remote_files(m: Model) -> dict[str, dict]:
    from fnmatch import fnmatch

    info = HfApi().model_info(m.repo, revision=m.revision, files_metadata=True)
    out = {}
    for s in info.siblings or []:
        if any(fnmatch(s.rfilename, p) for p in m.patterns):
            out[s.rfilename] = {"size": s.size, "sha256": (s.lfs.sha256 if s.lfs else None)}
    return out


def lock() -> None:
    data = {k: {"repo": m.repo, "revision": m.revision, "licence": m.licence, "files": _remote_files(m)} for k, m in MODELS.items()}
    LOCK.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
    print(f"wrote {LOCK}")


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def check(deep: bool = False, keys: list[str] | None = None) -> list[str]:
    """-> problems (empty list = every pinned file is present and matches the lock)."""
    locked = json.loads(LOCK.read_text())
    problems: list[str] = []
    for key in keys or list(MODELS):
        m = MODELS[key]
        entry = locked.get(key)
        if not entry or entry["revision"] != m.revision:
            problems.append(f"{key}: pins.lock.json is out of date for revision {m.revision[:8]}; run `python -m studio_audio.pins lock`")
            continue
        root = snapshot(key)
        for name, meta in entry["files"].items():
            p = root / name
            if not p.exists():
                problems.append(f"{key}/{name}: missing")
            elif meta["size"] is not None and p.resolve().stat().st_size != meta["size"]:
                problems.append(f"{key}/{name}: size {p.resolve().stat().st_size} != locked {meta['size']}")
            elif deep and meta["sha256"] and _sha256(p) != meta["sha256"]:
                problems.append(f"{key}/{name}: sha256 differs from the lock")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["fetch", "check", "lock"])
    ap.add_argument("--deep", action="store_true")
    ap.add_argument("--only", nargs="*", choices=list(MODELS))
    a = ap.parse_args()
    if a.cmd == "fetch":
        for k in a.only or MODELS:
            print(k, "→", snapshot(k))
    elif a.cmd == "lock":
        lock()
    else:
        problems = check(a.deep, a.only)
        for p in problems:
            print("✗", p)
        print("✓ pinned files match the lock" if not problems else f"{len(problems)} problem(s)")
        return 1 if problems else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
