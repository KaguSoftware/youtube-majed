"""Everything a film depends on, pinned: packages, tools and model weights.

    python -m pipeline.pins check [--deep]   # does this machine match the pins?
    python -m pipeline.pins fetch            # download the pinned weights
    python -m pipeline.pins archive DEST     # copy them somewhere safe
    python -m pipeline.pins lock             # rewrite pins.lock.json from this machine

Failure mode 10 (PLAN.md section 5) is a dependency that changes under the
pipeline and changes its output without failing: the video still renders,
only differently. Failure mode 13 is a model that is pulled or relicensed, so
past films cannot be reproduced. Both come down to knowing exactly which bytes
made a film and refusing to run on any others.

Three things are pinned, each where its own tooling expects it:

- **Python packages**: `requirements.lock` at the repo root, `uv pip freeze`
  of the venv the tests passed in. `deploy/install-worker.sh` syncs the
  worker's venv from it, so the worker runs exactly what was tested.
- **Model weights**: `MODELS` below names each model's repository, the commit
  it loads from and its licence; `pins.lock.json` holds the SHA-256 and size
  of every file the loader reads. Unpinned, a cached snapshot is used as it
  is and a fresh download takes `main`, so two machines could run different
  weights under one name (mflux's own `ModelRevisions` says the same, and pins
  the base klein repo but not the 4-bit checkpoint this pipeline loads).
- **Tools**: the Python and ffmpeg versions, in `pins.lock.json`. ffmpeg comes
  from Homebrew and moves with `brew upgrade`, outside every lockfile.

### The licence register is keyed by checkpoint hash

A licence is cleared for bytes, not for a name: a repository can replace its
weights under the same name. So a model is loaded only after its files hash
to what `pins.lock.json` recorded when its licence was reviewed (`check`
quickly at start-up, by size and blob name; `check --deep` re-hashes).

### Content addresses survive a pin, and change when it moves

Every cache key names the model that made it (`images.image_hash`,
`production.narrate`, `align_and_gate`). `Model.identity` is that name. It is
the plain name the caches were built with as long as the model sits at the
revision it was keyed at, so pinning invalidated nothing; move `revision` and
the identity becomes `name@<revision>`, and every image, narration and
alignment the old weights made is regenerated rather than reused.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
REQUIREMENTS_LOCK = REPO / "requirements.lock"
PINS_LOCK = Path(__file__).resolve().parent / "pins.lock.json"

#: PLAN.md 1.6. A licence outside this set needs a review before it is added.
CLEARED_LICENCES = {"apache-2.0"}


@dataclass(frozen=True)
class Model:
    role: str
    repo: str
    revision: str
    licence: str
    #: The files the loader reads, relative to the snapshot. Found by tracing a
    #: real offline load of each model, not by listing the repository: the
    #: aligner's repo also carries a `pytorch_model.bin` that is never read.
    files: tuple[str, ...]
    #: The name this model's cache keys were made with, and the revision they
    #: were made at (see the module docstring).
    keyed_as: str
    keyed_at: str

    @property
    def identity(self) -> str:
        if self.revision == self.keyed_at:
            return self.keyed_as
        return f"{self.keyed_as}@{self.revision[:12]}"

    def snapshot(self, cache: Path | None = None) -> Path:
        return hub_cache(cache) / f"models--{self.repo.replace('/', '--')}" / "snapshots" / self.revision

    def path(self, file: str, cache: Path | None = None) -> Path:
        return self.snapshot(cache) / file


MODELS: dict[str, Model] = {
    # FLUX.2 [klein] 4B, pre-quantized to 4 bits for mflux (PLAN.md 8.1).
    # Everything mflux reads comes from this one snapshot; the base repo it
    # names (`flux2-klein-4b`) is an architecture alias and is never opened.
    "image": Model(
        role="image", repo="mlx-community/flux2-klein-4b-4bit",
        revision="860e87183ceb29e39627c0612ebd66d8ea66e68c", licence="apache-2.0",
        files=(
            "text_encoder/0.safetensors", "text_encoder/1.safetensors",
            "text_encoder/model.safetensors.index.json",
            "tokenizer/chat_template.jinja", "tokenizer/tokenizer.json",
            "tokenizer/tokenizer_config.json",
            "transformer/0.safetensors", "transformer/1.safetensors",
            "transformer/model.safetensors.index.json",
            "vae/0.safetensors", "vae/model.safetensors.index.json",
        ),
        keyed_as="mlx-community/flux2-klein-4b-4bit",
        keyed_at="860e87183ceb29e39627c0612ebd66d8ea66e68c",
    ),
    # Kokoro-82M and the two voices tts.VOICE_MAP names.
    "tts": Model(
        role="tts", repo="hexgrad/Kokoro-82M",
        revision="f3ff3571791e39611d31c381e3a41a3af07b4987", licence="apache-2.0",
        files=("config.json", "kokoro-v1_0.pth", "voices/am_michael.pt", "voices/bm_george.pt"),
        keyed_as="kokoro-82m", keyed_at="f3ff3571791e39611d31c381e3a41a3af07b4987",
    ),
    # wav2vec2 for forced alignment and the ASR cross-check (PLAN.md 9.7: not
    # MMS, which is CC-BY-NC). transformers prefers the safetensors copy.
    "align": Model(
        role="align", repo="facebook/wav2vec2-base-960h",
        revision="22aad52d435eb6dbaf354bdad9b0da84ce7d6156", licence="apache-2.0",
        files=("config.json", "model.safetensors", "preprocessor_config.json",
               "special_tokens_map.json", "tokenizer_config.json", "vocab.json"),
        keyed_as="facebook/wav2vec2-base-960h",
        keyed_at="22aad52d435eb6dbaf354bdad9b0da84ce7d6156",
    ),
}


def hub_cache(cache: Path | None = None) -> Path:
    """The Hugging Face hub cache, honouring `HF_HUB_CACHE` and `HF_HOME` the
    way the loaders do, so an archive can stand in for it (see `archive`)."""
    if cache is not None:
        return Path(cache)
    if os.environ.get("HF_HUB_CACHE"):
        return Path(os.environ["HF_HUB_CACHE"]).expanduser()
    home = os.environ.get("HF_HOME") or os.path.join(
        os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache"), "huggingface")
    return Path(home).expanduser() / "hub"


def assert_cleared(model: Model) -> None:
    """The licence half of the register. The hash half is `verify_model`."""
    if model.licence not in CLEARED_LICENCES:
        raise RuntimeError(f"{model.repo} is licensed {model.licence!r}, which is not cleared "
                           f"({sorted(CLEARED_LICENCES)}); see PLAN.md section 1.6")
    if model.role == "image":
        # The image model also passes the Phase 0 gate, which knows the
        # non-commercial klein and FLUX variants by name.
        from bench.backends.mflux_klein import assert_licence_ok
        assert_licence_ok(model.repo)


# ------------------------------------------------------------------ hashing

def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 22), b""):
            h.update(block)
    return h.hexdigest()


def blob_name(p: Path) -> str:
    """The name of the blob a snapshot entry links to: the file's SHA-256 for
    weights, its git SHA-1 for small files. Read from the snapshot's own link
    only: newer hub versions dedupe blobs into a shared store named by another
    hash, so following every link lands on a name that is not the SHA-256."""
    return Path(os.readlink(p)).name if p.is_symlink() else p.name


def read_lock(path: Path = PINS_LOCK) -> dict:
    return json.loads(path.read_text())


def verify_model(model: Model, lock: dict, *, deep: bool = False,
                 cache: Path | None = None) -> list[str]:
    """-> problems; empty when every file the loader reads is the locked file.

    Quick mode checks presence, size, and for weight files the name of the
    blob the snapshot points at, which the hub names by its SHA-256. That
    catches a different checkpoint (the name is a hash) without reading 5 GB.
    Deep mode re-hashes every byte, which also catches a corrupt disk.
    """
    entry = lock.get("models", {}).get(model.role)
    if entry is None:
        return [f"{model.role}: not in {PINS_LOCK.name}; run `python -m pipeline.pins lock`"]
    if entry.get("repo") != model.repo or entry.get("revision") != model.revision:
        return [f"{model.role}: pinned to {model.repo}@{model.revision[:12]} but the lock records "
                f"{entry.get('repo')}@{str(entry.get('revision'))[:12]}; re-lock after review"]
    problems: list[str] = []
    for name in model.files:
        want = entry["files"].get(name)
        p = model.path(name, cache)
        if want is None:
            problems.append(f"{model.role}: {name} is read but not locked")
            continue
        if not p.is_file():
            problems.append(f"{model.role}: {name} missing at {model.revision[:12]} "
                            "(run `python -m pipeline.pins fetch`)")
            continue
        size = p.stat().st_size
        if size != want["size"]:
            problems.append(f"{model.role}: {name} is {size} bytes, locked {want['size']}")
            continue
        if deep:
            got = file_sha256(p)
            if got != want["sha256"]:
                problems.append(f"{model.role}: {name} hashes {got[:12]}, locked {want['sha256'][:12]}")
        else:
            blob = blob_name(p)
            if re.fullmatch(r"[0-9a-f]{64}", blob) and blob != want["sha256"]:
                problems.append(f"{model.role}: {name} is blob {blob[:12]}, locked {want['sha256'][:12]}")
    return problems


def lock_entry(model: Model, cache: Path | None = None) -> dict:
    files = {}
    for name in model.files:
        p = model.path(name, cache)
        if not p.is_file():
            raise SystemExit(f"{model.repo}: {name} is not at {p}; fetch it first")
        files[name] = {"sha256": file_sha256(p), "size": p.stat().st_size}
    return {"repo": model.repo, "revision": model.revision, "licence": model.licence, "files": files}


def lock_models(cache: Path | None = None) -> dict:
    """Hash the pinned files as they are on this machine. Run only after a
    review: what this writes is what every later check holds the weights to."""
    out = {}
    for model in MODELS.values():
        assert_cleared(model)
        out[model.role] = lock_entry(model, cache)
    return out


# ----------------------------------------------------------------- packages

def read_requirements(path: Path = REQUIREMENTS_LOCK) -> dict[str, str]:
    """`uv pip freeze` output -> {normalized name: version}."""
    out: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        m = re.fullmatch(r"([A-Za-z0-9_.\-]+)(?:\[[^\]]*\])?==([^\s;]+)", line)
        # A package installed from a URL (the spaCy model Kokoro's G2P needs)
        # is frozen as `name @ url`; its version is in the wheel's file name.
        url = re.fullmatch(r"([A-Za-z0-9_.\-]+)\s*@\s*\S*?-(\d[^-/]*)-py\S*\.whl", line)
        if m:
            out[_norm(m.group(1))] = m.group(2)
        elif url:
            out[_norm(url.group(1))] = url.group(2)
    return out


def _norm(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def installed() -> dict[str, str]:
    from importlib import metadata
    return {_norm(d.metadata["Name"]): d.version for d in metadata.distributions()
            if d.metadata["Name"]}


def verify_packages(locked: dict[str, str], have: dict[str, str]) -> tuple[list[str], list[str]]:
    """-> (problems, notes). A locked package at another version, or missing,
    is a problem; one installed beyond the lock is only a note, since nothing
    in the pipeline imports what it was not tested with."""
    problems = [f"{n}: locked {v}, installed {have[n]}" if n in have else f"{n}: locked {v}, not installed"
                for n, v in sorted(locked.items()) if have.get(n) != v]
    notes = [f"{n} {have[n]} is installed but not locked" for n in sorted(set(have) - set(locked))]
    return problems, notes


# -------------------------------------------------------------------- tools

def ffmpeg_version() -> str | None:
    try:
        out = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True).stdout
    except FileNotFoundError:
        return None
    m = re.match(r"ffmpeg version (\S+)", out)
    return m.group(1) if m else None


def python_version() -> str:
    return ".".join(map(str, sys.version_info[:3]))


def verify_tools(lock: dict) -> tuple[list[str], list[str]]:
    """-> (problems, notes). Another Python minor version is a problem. A
    different ffmpeg is a note: it is a system tool that moves with Homebrew,
    and whether the move matters is what the smoke test's render checks
    decide (`python -m pipeline.smoke`)."""
    problems, notes = [], []
    tools = lock.get("tools", {})
    want_py, have_py = tools.get("python"), python_version()
    if want_py and want_py != have_py:
        (problems if want_py.split(".")[:2] != have_py.split(".")[:2] else notes).append(
            f"python {have_py}, locked {want_py}")
    want_ff, have_ff = tools.get("ffmpeg"), ffmpeg_version()
    if have_ff is None:
        problems.append("ffmpeg is not installed")
    elif want_ff and want_ff != have_ff:
        notes.append(f"ffmpeg {have_ff}, locked {want_ff}; the smoke test says whether it matters")
    return problems, notes


# -------------------------------------------------------------------- check

@dataclass
class Report:
    problems: list[str]
    notes: list[str]

    @property
    def ok(self) -> bool:
        return not self.problems

    def render(self) -> str:
        lines = [f"  FAIL  {p}" for p in self.problems] + [f"  note  {n}" for n in self.notes]
        return "\n".join(lines) if lines else "  ok"


def check(*, models: bool = True, deep: bool = False, cache: Path | None = None,
          roles: tuple[str, ...] | None = None) -> Report:
    """What `worker` runs before claiming anything, and `smoke` runs first."""
    problems, notes = [], []
    if REQUIREMENTS_LOCK.is_file():
        p, n = verify_packages(read_requirements(), installed())
        problems += p
        notes += n
    else:
        problems.append(f"{REQUIREMENTS_LOCK.name} is missing")
    lock = read_lock() if PINS_LOCK.is_file() else {}
    if not lock:
        problems.append(f"{PINS_LOCK.name} is missing")
    p, n = verify_tools(lock)
    problems += p
    notes += n
    if models and lock:
        for role, model in MODELS.items():
            if roles is None or role in roles:
                try:
                    assert_cleared(model)
                except RuntimeError as exc:
                    problems.append(str(exc))
                problems += verify_model(model, lock, deep=deep, cache=cache)
    return Report(problems, notes)


def models_record() -> dict:
    """What a timeline records about the weights that made it: enough to say
    which bytes, and to find them in an archive (failure mode 13)."""
    lock = read_lock().get("models", {}) if PINS_LOCK.is_file() else {}
    out = {}
    for role, m in MODELS.items():
        files = lock.get(role, {}).get("files", {})
        digest = hashlib.sha256(json.dumps({k: v["sha256"] for k, v in sorted(files.items())},
                                           sort_keys=True).encode()).hexdigest()[:16] if files else None
        out[role] = {"name": m.repo, "revision": m.revision, "weights": digest, "licence": m.licence}
    return out


# ---------------------------------------------------------- fetch / archive

def fetch() -> None:
    from huggingface_hub import snapshot_download
    for m in MODELS.values():
        assert_cleared(m)
        print(f"  {m.repo}@{m.revision[:12]}")
        snapshot_download(repo_id=m.repo, revision=m.revision, allow_patterns=list(m.files))


def archive(dest: Path, *, cache: Path | None = None, models=None, lock: dict | None = None,
            log=print) -> Report:
    """Copy the pinned files into `dest` laid out as a hub cache, then verify
    the copy byte for byte.

    The layout is the point: with `HF_HUB_CACHE=<dest>` every loader reads
    the archive as it reads the real cache, with no code path of its own, so
    a model deleted upstream is a one-variable restore. Blobs are copied once
    and the snapshot links to them, as the hub does.
    """
    dest = Path(dest).expanduser()
    models = list(models or MODELS.values())
    for m in models:
        repo_dir = dest / f"models--{m.repo.replace('/', '--')}"
        (repo_dir / "blobs").mkdir(parents=True, exist_ok=True)
        (repo_dir / "refs").mkdir(exist_ok=True)
        (repo_dir / "refs" / "main").write_text(m.revision)
        copied = 0
        for name in m.files:
            src = m.path(name, cache)
            if not src.is_file():
                raise SystemExit(f"{m.repo}: {name} is not at {src}; fetch it first")
            real = src.resolve()
            blob = repo_dir / "blobs" / blob_name(src)
            if not blob.is_file() or blob.stat().st_size != real.stat().st_size:
                tmp = blob.with_name(f".{blob.name}.partial")
                shutil.copyfile(real, tmp)
                os.replace(tmp, blob)
                copied += real.stat().st_size
            link = m.snapshot(dest) / name
            link.parent.mkdir(parents=True, exist_ok=True)
            if link.is_symlink() or link.exists():
                link.unlink()
            link.symlink_to(os.path.relpath(blob, link.parent))
        log(f"  {m.repo}@{m.revision[:12]}: {len(m.files)} files, {copied / 1e9:.2f} GB copied")
    lock = lock or read_lock()
    problems = [p for m in models for p in verify_model(m, lock, deep=True, cache=dest)]
    return Report(problems, [])


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m pipeline.pins")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check", help="does this machine match the pins")
    c.add_argument("--deep", action="store_true", help="re-hash every weight file (~12 s)")
    c.add_argument("--no-models", action="store_true", help="packages and tools only")
    sub.add_parser("fetch", help="download the pinned model revisions")
    a = sub.add_parser("archive", help="copy the pinned weights into DEST as a hub cache")
    a.add_argument("dest", type=Path)
    sub.add_parser("lock", help="re-hash the pinned weights and record this machine's tools")
    args = ap.parse_args(argv)

    if args.cmd == "check":
        r = check(models=not args.no_models, deep=args.deep)
        print(r.render())
        return 0 if r.ok else 1
    if args.cmd == "fetch":
        fetch()
        r = check(deep=True)
        print(r.render())
        return 0 if r.ok else 1
    if args.cmd == "archive":
        r = archive(args.dest)
        print(r.render() if r.problems else f"  verified; restore with HF_HUB_CACHE={args.dest}")
        return 0 if r.ok else 1
    if args.cmd == "lock":
        doc = {"tools": {"python": python_version(), "ffmpeg": ffmpeg_version()},
               "models": lock_models()}
        PINS_LOCK.write_text(json.dumps(doc, indent=2) + "\n")
        print(f"  wrote {PINS_LOCK.relative_to(REPO)}")
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
