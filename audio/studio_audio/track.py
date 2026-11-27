"""Takes -> one mastered narration track and its voice.json, without loading a model.

    uv run python -m studio_audio.track <request.json>

The service's POST /master (studio.Studio.track) and the edit engine
(worker/src/edit.ts, which runs this as a child process like the mixer) share
this code, so an edit that only re-orders lines or adds a voice effect never
needs the GPU service.

Request (JSON):

    {"outDir": ".../audio",                      takes are read from outDir/lines/
     "lines": [{"id": "L1.1", "key": "aaa4...", "fx": [{"preset": "robot", "word": 3}]}],
     "engine": {"name", "revision", "device"},   recorded in voice.json as they are
     "reference": {"file", "sha256"},            the voice the takes were made with
     "narration": ".../narration.wav", "voice": ".../voice.json"}   where to write

Line starts land on a video frame (FRAME_RATE): each line's offset is rounded
to the nearest 1/30 s, i.e. a pause changes by at most 17 ms (the shortest is
0.05 s on top of the takes' own 0.18 s of padding), and the track's length
does not drift. A word's frame
is then its line's frame plus a fixed number of frames, so when an edit
changes one line, every later scene moves by whole frames and its rendered
segment is reused (remotion/src/scene/segments.ts).
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf

from . import config, fx, master, matcheq

FRAME_RATE = 30  # remotion/src/theme.ts FPS
ALIGNER = {"model": "facebook/wav2vec2-base-960h", "revision": "22aad52d435eb6dbaf354bdad9b0da84ce7d6156", "device": "cpu", "dtype": "float32"}

# --- pause rules -----------------------------------------------------------
# Silence inserted between two lines, ON TOP of the ~0.18 s of padding each line
# file already carries (0.06 s before, 0.12 s after). Chosen by the end of the
# previous line and where the loop boundary falls (ids look like "L3.4": loop
# L3, line 4). Longer at loop boundaries, because that is where the story
# resets its question.
LEAD_IN = 0.40  # silence before the first line
TAIL = 1.00  # after the last line (lets the room reverb decay, gives the outro a beat)
PAUSE_LOOP_BOUNDARY = 0.70
PAUSE_BY_ENDING = {"…": 0.50, "?": 0.34, "!": 0.32, ".": 0.28}
PAUSE_CONTINUES = 0.05  # line ends on a comma, dash or nothing: the sentence goes on
PAUSE_BEFORE_REVEAL = 0.15  # extra beat before an energy-5 line inside a loop


def fade_edges(w: np.ndarray, sr: int, ms: float = 8.0) -> np.ndarray:
    """Raised-cosine fade at both ends of a take: a take cut mid-breath ends on a step, which is a click."""
    n = min(int(sr * ms / 1000), len(w) // 2)
    if n < 2:
        return w
    ramp = (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, n))).astype(w.dtype)
    out = w.copy()
    out[:n] *= ramp
    out[-n:] *= ramp[::-1]
    return out


def loop_of(line_id: str) -> str:
    return line_id.split(".")[0]


def pause_after(prev: dict, nxt: dict) -> float:
    if loop_of(prev["id"]) != loop_of(nxt["id"]):
        return PAUSE_LOOP_BOUNDARY
    end = prev["text"].rstrip().rstrip("\"'”’)")[-1:]
    pause = PAUSE_BY_ENDING.get(end, PAUSE_CONTINUES)
    if nxt.get("energy") == 5:
        pause += PAUSE_BEFORE_REVEAL
    return pause


def _write_atomic(path: Path, write) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.partial{path.suffix}")
    write(tmp)
    tmp.replace(path)


def assemble(out_dir: Path, order: list[dict], *, engine: dict, reference: dict, aligner: dict, narration: Path, voice_path: Path, curve_path: Path | None = None, frame_rate: int = FRAME_RATE) -> dict:
    """order: [{id, key, fx?}] in narration order. Writes the mastered track and voice.json; returns voice.json."""
    sr = config.MASTER_SR
    lines_dir = out_dir / "lines"
    metas = [json.loads((lines_dir / f"{o['id']}.{o['key']}.json").read_text()) for o in order]
    dry, wet, fx_files = [], [], []
    for o, m in zip(order, metas):
        w, wsr = sf.read(out_dir / m["file"], dtype="float32")
        dry.append(matcheq.resample(w, wsr, sr))
        effects = o.get("fx") or []
        if effects:
            path, _ = fx.cached(lines_dir, o["id"], o["key"], effects, m)
            p, psr = sf.read(path, dtype="float32")
            wet.append(matcheq.resample(p, psr, sr))
            fx_files.append({"file": f"lines/{path.name}", "effects": [{"preset": e["preset"], **({"word": int(e["word"])} if e.get("word") is not None else {})} for e in effects]})
        else:
            wet.append(None)
            fx_files.append(None)
    lengths = [len(w) for w in dry]  # timing follows the dry takes: an effect's tail never pushes a line back
    voiced = [fade_edges(w, sr) for w in matcheq.balance_lines(dry, sr, processed=wet)]

    step = sr // frame_rate
    offsets: list[int] = []
    cursor = round(LEAD_IN * sr)
    for i, (m, n) in enumerate(zip(metas, lengths)):
        cursor = round(cursor / step) * step  # to the nearest frame
        offsets.append(cursor)
        cursor += n
        if i + 1 < len(metas):
            cursor += round(pause_after(m, metas[i + 1]) * sr)
    total = cursor + round(TAIL * sr)
    raw = np.zeros(total, dtype=np.float32)
    for off, w in zip(offsets, voiced):
        part = w[: total - off]
        raw[off : off + len(part)] += part

    mastered, loud = master.master(raw, sr, curve_path=curve_path)
    _write_atomic(narration, lambda p: sf.write(p, mastered, sr, subtype="PCM_24", format="WAV"))

    lines = []
    for m, off, n, f in zip(metas, offsets, lengths, fx_files):
        t0 = off / sr
        line = {
            "id": m["id"], "text": m["text"], "energy": m["energy"], "file": m["file"],
            "offset": round(t0, 5), "duration": round(n / sr, 5),
            "seed": m["seed"], "seedUsed": m["seedUsed"], "settings": m["settings"], "quality": m["quality"],
            "words": [{"text": x["text"], "start": round(t0 + x["start"], 4), "end": round(t0 + x["end"], 4), "score": x["score"]} for x in m["words"]],
        }
        if f:
            line["fx"] = f
        lines.append(line)
    voice = {
        "version": 1,
        "engine": engine,
        "reference": reference,
        "aligner": aligner,
        "pauses": {"leadIn": LEAD_IN, "tail": TAIL, "loopBoundary": PAUSE_LOOP_BOUNDARY, "byEnding": PAUSE_BY_ENDING,
                   "continues": PAUSE_CONTINUES, "beforeReveal": PAUSE_BEFORE_REVEAL, "frameRate": frame_rate},
        "track": {"file": "narration.wav", "sampleRate": sr, "duration": round(total / sr, 5), "loudness": loud.to_json()},
        "lines": lines,
    }
    _write_atomic(voice_path, lambda p: p.write_text(json.dumps(voice, indent=2)))
    return voice


def main() -> None:
    req = json.loads(Path(sys.argv[1]).read_text())
    t0 = time.time()
    ref = req["reference"]
    curve = None
    if not str(ref["file"]).startswith(config.BUILTIN):
        curve = config.eq_curve_for(config.REPO / ref["file"])
    out = Path(req["outDir"])
    lines_dir = out / "lines"
    before = {p.name for p in lines_dir.glob("*.fx-*.wav")}
    voice = assemble(out, req["lines"], engine=req["engine"], reference=ref, aligner=req.get("aligner") or ALIGNER,
                     narration=Path(req["narration"]), voice_path=Path(req["voice"]), curve_path=curve)
    made = sorted({p.name for p in lines_dir.glob("*.fx-*.wav")} - before)
    print(json.dumps({"ok": True, "seconds": round(time.time() - t0, 2), "duration": voice["track"]["duration"], "lufs": voice["track"]["loudness"]["integratedLufs"], "fxMade": made}))


if __name__ == "__main__":
    main()
