"""Word timestamps by forced alignment against the KNOWN line text (WhisperX),
plus a gate that says whether the voice actually spoke those words.

Alignment alone cannot tell you the voice dropped a word: forced alignment must
put every word somewhere, so a skipped word borrows a few frames from its
neighbour. legacy/pipeline/align.py solved this by also reading the audio with
the same wav2vec2 model (greedy CTC decode, no language model) and comparing it
with the script. This module keeps that idea and the pieces that earned their
keep on real narration: near-miss and merged-word tolerance, and the
"long word heard as a scrap" check. It is a port, not a copy.

Alignment model: facebook/wav2vec2-base-960h (Apache-2.0), loaded from the
pinned snapshot in pins.py, on CPU in float32 (WhisperX has no MPS support).
"""

from __future__ import annotations

import logging
import re
from dataclasses import asdict, dataclass, field
from difflib import SequenceMatcher

import numpy as np
import torch

from . import config, pins

log = logging.getLogger("studio_audio.align")

# --- gate thresholds (calibrated on this voice, see audio/README.md) ---------
MAX_WER = 0.12  # effective WER above this fails a line
WEAK_SCORE = 0.30  # word alignment confidence below this is flagged (warn)
MIN_MS_PER_CHAR = 18.0  # words of 5+ chars shorter than this per char are suspicious
MIN_CHARS_FOR_DURATION_CHECK = 5
MAX_STRAY_TAIL = 0.50  # seconds of audio after the last word that no word explains
MAX_STRAY_HEAD = 0.50
WORDS_PER_SEC = (1.0, 6.0)  # outside this a line is too slow/fast to be right

_PUNCT = re.compile(r"[^A-Z' ]+")
_WS = re.compile(r"\s+")


def normalize(text: str) -> str:
    out = text.upper().replace("’", "'").replace("—", " ").replace("-", " ")
    return _WS.sub(" ", _PUNCT.sub(" ", out)).strip()


def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def _edit_ops(ref: list[str], hyp: list[str]) -> list[tuple[str, int, str, str]]:
    n, m = len(ref), len(hyp)
    d = np.zeros((n + 1, m + 1), dtype=np.int32)
    d[:, 0] = np.arange(n + 1)
    d[0, :] = np.arange(m + 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i, j] = min(d[i - 1, j] + 1, d[i, j - 1] + 1, d[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]))
    ops: list[tuple[str, int, str, str]] = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i, j] == d[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]):
            if ref[i - 1] != hyp[j - 1]:
                ops.append(("sub", i - 1, ref[i - 1], hyp[j - 1]))
            i, j = i - 1, j - 1
        elif i > 0 and d[i, j] == d[i - 1, j] + 1:
            ops.append(("del", i - 1, ref[i - 1], ""))
            i -= 1
        else:
            ops.append(("ins", i, "", hyp[j - 1]))
            j -= 1
    return list(reversed(ops))


def _join_splits(ref: list[str], hyp: list[str]) -> list[str]:
    """Rejoin words the recogniser split in two (EVERYONE -> EVERY ONE)."""
    vocab = set(ref)
    out, i = [], 0
    while i < len(hyp):
        if i + 1 < len(hyp):
            joined = hyp[i] + hyp[i + 1]
            unknown = hyp[i] not in vocab and hyp[i + 1] not in vocab
            if joined in vocab or (unknown and any(_similarity(joined, w) >= 0.75 for w in vocab if len(w) >= 5)):
                out.append(joined)
                i += 2
                continue
        out.append(hyp[i])
        i += 1
    return out


def spoken_check(reference: str, heard: str) -> tuple[float, list[str]]:
    """-> (effective WER, the edits that count). The recogniser spells names by
    ear, so near-miss substitutions don't count; a dropped word or a long word
    heard as a short scrap does."""
    ref, hyp = reference.split(), heard.split()
    if not ref:
        return (0.0 if not hyp else 1.0), []
    ops = _edit_ops(ref, _join_splits(ref, hyp))
    # Two script words run together and heard as one ("OIL LEFT" -> "HOILE") read
    # as one dropped word plus one substitution. It is a merge, not a drop, when
    # the pair joined is spelled like what was heard.
    heard_as = {i: h for op, i, _, h in ops if op == "sub"}
    forgiven: set[tuple[str, int]] = set()
    for op, i, r, _ in ops:
        if op != "del":
            continue
        after, before = heard_as.get(i + 1), heard_as.get(i - 1)
        if after and i + 1 < len(ref) and _similarity(r + ref[i + 1], after) >= 0.7:
            forgiven |= {("del", i), ("sub", i + 1)}
        elif before and _similarity(ref[i - 1] + r, before) >= 0.7:
            forgiven |= {("del", i), ("sub", i - 1)}
    counted = [
        f"heard {h!r} for {r!r}" if op == "sub" else f"missing {r!r}" if op == "del" else f"extra {h!r}"
        for op, i, r, h in ops
        if (op, i) not in forgiven and not (op == "sub" and _similarity(r, h) >= 0.6)
    ]
    # A long word that leaves only a scrap ("EVENINGS" -> "ETN") was cut, not misspelled.
    for op, _, r, h in ops:
        if op == "sub" and len(r) >= 5 and len(h) * 2 <= len(r) and _similarity(r, h) < 0.6:
            tag = f"heard {h!r} for {r!r}"
            if tag not in counted:
                counted.append(tag)
    return len(counted) / len(ref), counted


@dataclass
class Word:
    text: str  # as written in the script, punctuation attached ("burning.")
    start: float  # seconds from the start of the line audio
    end: float
    score: float


@dataclass
class Aligned:
    words: list[Word]
    heard: str
    wer: float
    status: str = "ok"  # ok | warn | fail
    issues: list[str] = field(default_factory=list)

    def to_json(self) -> dict:
        d = asdict(self)
        d["words"] = [{"text": w.text, "start": round(w.start, 4), "end": round(w.end, 4), "score": round(w.score, 3)} for w in self.words]
        d["wer"] = round(self.wer, 3)
        return d


class Aligner:
    def __init__(self) -> None:
        self.device = "cpu"
        self.model = None
        self.meta: dict | None = None

    def load(self) -> "Aligner":
        import whisperx

        path = str(pins.snapshot("align"))
        # A local directory is not a torchaudio pipeline name, so WhisperX loads
        # it through transformers (Wav2Vec2ForCTC), float32 on CPU.
        self.model, self.meta = whisperx.load_align_model("en", self.device, model_name=path)
        self.model.eval()
        vocab = self.meta["dictionary"]
        self._id_to_char = {i: c for c, i in vocab.items()}
        self._blank = vocab.get("<pad>", 0)
        return self

    # ------------------------------------------------------------------ heard
    def _heard(self, audio16: np.ndarray) -> str:
        with torch.inference_mode():
            logits = self.model(torch.from_numpy(audio16).unsqueeze(0)).logits[0]
        ids = logits.argmax(-1).tolist()
        out, prev = [], None
        for i in ids:
            if i != prev and i != self._blank:
                out.append(self._id_to_char.get(i, ""))
            prev = i
        return normalize("".join(out).replace("|", " "))

    # ------------------------------------------------------------------ align
    def align(self, text: str, wav: np.ndarray, sr: int) -> Aligned:
        import whisperx

        audio16 = torch.from_numpy(np.ascontiguousarray(wav)).float()
        if sr != config.ALIGN_SR:
            import torchaudio

            audio16 = torchaudio.functional.resample(audio16, sr, config.ALIGN_SR)
        audio16 = audio16.numpy().astype(np.float32)
        duration = len(audio16) / config.ALIGN_SR

        issues: list[str] = []
        words: list[Word] = []
        try:
            result = whisperx.align(
                [{"text": text, "start": 0.0, "end": duration}], self.model, self.meta, audio16, self.device, return_char_alignments=False,
            )
            raw = [w for seg in result["segments"] for w in seg["words"]]
        except Exception as e:  # noqa: BLE001 - any failure here is a failed alignment
            return Aligned([], "", 1.0, "fail", [f"alignment failed: {e}"])

        script_words = text.split()
        if len(raw) != len(script_words):
            issues.append(f"alignment returned {len(raw)} words for {len(script_words)} script words")
        prev_end = 0.0
        for w in raw:
            if "start" not in w or "end" not in w:
                issues.append(f"no timing for {w['word']!r}")
                w = {**w, "start": prev_end, "end": prev_end, "score": 0.0}
            words.append(Word(w["word"], float(w["start"]), float(w["end"]), float(w.get("score", 0.0))))
            prev_end = float(w["end"])

        heard = self._heard(audio16)
        wer, edits = spoken_check(normalize(text), heard)
        status = "ok"
        if wer > MAX_WER:
            status = "fail"
            issues.append(f"voice does not match the script (WER {wer:.2f}): " + "; ".join(edits[:4]))
        elif edits:
            issues.append("possible misread: " + "; ".join(edits[:3]))
            status = "warn"

        for w in words:
            n = len(re.sub(r"[^A-Za-z']", "", w.text))
            ms_per_char = (w.end - w.start) * 1000 / max(n, 1)
            if w.score < WEAK_SCORE:
                issues.append(f"low confidence on {w.text!r} ({w.score:.2f})")
                status = status if status == "fail" else "warn"
            if n >= MIN_CHARS_FOR_DURATION_CHECK and ms_per_char < MIN_MS_PER_CHAR:
                issues.append(f"{w.text!r} is only {w.end - w.start:.2f}s long: probably clipped or dropped")
                status = "fail"

        if words:
            head, tail = words[0].start, duration - words[-1].end
            if tail > MAX_STRAY_TAIL:
                issues.append(f"{tail:.2f}s of audio after the last word (stray sound or trailing babble)")
                status = "fail"
            if head > MAX_STRAY_HEAD:
                issues.append(f"{head:.2f}s of audio before the first word")
                status = "fail"
            wps = len(words) / max(words[-1].end - words[0].start, 1e-3)
            if not (WORDS_PER_SEC[0] <= wps <= WORDS_PER_SEC[1]):
                issues.append(f"pace of {wps:.1f} words/s is outside {WORDS_PER_SEC}")
                status = "fail"
        else:
            status = "fail"
            issues.append("no words aligned")
        return Aligned(words, heard, wer, status, issues)
