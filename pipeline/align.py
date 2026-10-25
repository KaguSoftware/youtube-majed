"""Word-level timestamps by CTC forced alignment, and the ASR gate.

Two jobs, one forward pass. The acoustic model's frame log-probabilities are
used twice: once Viterbi-decoded *against the known transcript* to get word
timings, and once greedy-decoded to get an independent reading of what the
audio actually says. The second is failure mode 1's gate.

### Why this is alignment, not transcription

We wrote the script, so we know the words. Whisper's own word timestamps are
internal estimates and are least stable exactly at word boundaries, which is
where shot cuts land (PLAN.md 1.5). Forced alignment solves the easier, better-
posed problem: given the text, find where each word is.

### Why not `ctc-forced-aligner` or torchaudio

- `ctc-forced-aligner` defaults to an MMS checkpoint, which is **CC-BY-NC-4.0**
  (verified via the HF API). PLAN.md 1.6 forbids it. The LibriSpeech wav2vec2
  models are apache-2.0, so the licence-clean path is to drive one directly.
- `torchaudio` has `functional.forced_align`, but torchaudio is frozen at 2.11
  against torch 2.14 here and its compiled ops are a version-coupling risk for
  a dependency we would use one function from.

So the Viterbi pass is implemented here, in numpy, in about fifty lines. It is
a well-understood algorithm, it has no build step, and owning it means per-word
confidence is available for the drift assertions failure mode 5 asks for.

### The trellis

Standard CTC alignment. The transcript is expanded to a token sequence with
blanks interleaved (`- c - a - t -`), and the best monotonic path through
(frames x tokens) is found where each step either stays on the current token or
advances by one — or by two, when skipping a blank between two *different*
tokens. Repeated characters may not skip the blank between them, which is what
keeps `ll` in `treeline` from collapsing to one `l`.
"""

from __future__ import annotations

import json
import re
import wave
from dataclasses import dataclass, asdict, field
from pathlib import Path

import numpy as np

from . import config

NEG_INF = -1e30

#: Below this alignment confidence a word is reported but not failed. Measured
#: baseline on correct Kokoro narration: no word in 153 scored under this.
WEAK_WORD_SCORE = 0.25

#: A word that occupies implausibly little audio *for its length*.
#:
#: The first version of this check tested for zero duration and never fired,
#: which the negative control in gatecheck.py exposed: forced alignment has to
#: put every word somewhere, so a word spliced out of the audio borrows a frame
#: or two from its neighbour rather than collapsing to exactly nothing.
#:
#: Length-normalizing makes it work. Measured on correct narration, 153 words:
#:   median                       45.0 ms/char
#:   floor, all words             20.0 ms/char  (articles: A, THE, IS, OF)
#:   floor, words of 5+ chars     31.5 ms/char  (THROUGH, 0.220s)
#: A spliced-out 11-character word lands near 2 ms/char. 15 ms/char sits in the
#: empty space between, with the length guard keeping legitimately elided
#: articles out of it — they are short because English elides them, not because
#: anything is missing.
MIN_MS_PER_CHAR = 15.0
MIN_CHARS_FOR_DURATION_CHECK = 5

#: Characters the LibriSpeech wav2vec2 vocabulary knows. Everything else has to
#: be normalized away before alignment or the trellis has no token for it.
_PUNCT = re.compile(r"[^A-Z' ]+")
_WS = re.compile(r"\s+")


@dataclass
class WordTiming:
    word: str
    start: float
    end: float
    score: float

    @property
    def duration(self) -> float:
        return self.end - self.start


@dataclass
class BeatAlignment:
    beat_id: str
    start: float
    end: float
    words: list[WordTiming]
    asr_text: str
    wer: float
    report: list[str] = field(default_factory=list)


@dataclass
class Alignment:
    beats: list[BeatAlignment]
    model: str
    audio_duration: float
    overall_wer: float
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def words(self) -> list[WordTiming]:
        return [w for b in self.beats for w in b.words]

    def to_json(self) -> dict:
        return {
            "model": self.model,
            "audio_duration": round(self.audio_duration, 4),
            "overall_wer": round(self.overall_wer, 4),
            "errors": self.errors,
            "warnings": self.warnings,
            "beats": [
                {
                    "beat_id": b.beat_id,
                    "start": round(b.start, 4),
                    "end": round(b.end, 4),
                    "wer": round(b.wer, 4),
                    "asr_text": b.asr_text,
                    "report": b.report,
                    "words": [
                        {k: (round(v, 4) if isinstance(v, float) else v)
                         for k, v in asdict(w).items()}
                        for w in b.words
                    ],
                }
                for b in self.beats
            ],
        }


# ------------------------------------------------------------------ text prep


def normalize(text: str) -> str:
    """Fold text into the acoustic model's character vocabulary."""
    out = text.upper().replace("’", "'").replace("—", " ").replace("-", " ")
    out = _PUNCT.sub(" ", out)
    return _WS.sub(" ", out).strip()


def wer(reference: str, hypothesis: str) -> tuple[float, list[str]]:
    """Levenshtein word error rate, plus a human-readable edit list.

    The edit list is the point. A bare number says "something is off"; naming
    the substitution is what lets someone decide whether the TTS dropped a word
    or the acoustic model simply cannot spell `quern`.
    """
    ref, hyp = reference.split(), hypothesis.split()
    n, m = len(ref), len(hyp)
    if n == 0:
        return (0.0 if m == 0 else 1.0), []

    d = np.zeros((n + 1, m + 1), dtype=np.int32)
    d[:, 0] = np.arange(n + 1)
    d[0, :] = np.arange(m + 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost = 0 if ref[i - 1] == hyp[j - 1] else 1
            d[i, j] = min(d[i - 1, j] + 1, d[i, j - 1] + 1, d[i - 1, j - 1] + cost)

    edits: list[str] = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i, j] == d[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]):
            if ref[i - 1] != hyp[j - 1]:
                edits.append(f"sub {ref[i-1]}->{hyp[j-1]}")
            i, j = i - 1, j - 1
        elif i > 0 and d[i, j] == d[i - 1, j] + 1:
            edits.append(f"del {ref[i-1]}")
            i -= 1
        else:
            edits.append(f"ins {hyp[j-1]}")
            j -= 1
    return d[n, m] / n, list(reversed(edits))


# ---------------------------------------------------------------- the trellis


def _forced_align(log_probs: np.ndarray, tokens: np.ndarray, blank: int) -> np.ndarray:
    """-> per-frame token index into the blank-interleaved sequence.

    `log_probs` is (frames, vocab); `tokens` is the blank-interleaved target.
    Returns the Viterbi path as one token index per frame.
    """
    T, S = log_probs.shape[0], len(tokens)
    if T < S:
        raise RuntimeError(
            f"audio is too short to contain the transcript: {T} frames for "
            f"{S} CTC tokens. The narration and the text do not match."
        )

    emit = log_probs[:, tokens]                      # (T, S)
    score = np.full((T, S), NEG_INF, dtype=np.float64)
    back = np.zeros((T, S), dtype=np.int8)           # 0 stay, 1 step, 2 skip

    score[0, 0] = emit[0, 0]
    if S > 1:
        score[0, 1] = emit[0, 1]

    # A blank may be skipped only between two *different* real tokens;
    # otherwise `ll` would collapse into a single `l`.
    skippable = np.zeros(S, dtype=bool)
    if S > 2:
        idx = np.arange(2, S)
        skippable[2:] = (tokens[idx] != blank) & (tokens[idx - 2] != blank) & (tokens[idx] != tokens[idx - 2])

    for t in range(1, T):
        prev = score[t - 1]
        stay = prev
        step = np.full(S, NEG_INF)
        step[1:] = prev[:-1]
        skip = np.full(S, NEG_INF)
        skip[2:] = np.where(skippable[2:], prev[:-2], NEG_INF)

        stacked = np.vstack([stay, step, skip])
        choice = np.argmax(stacked, axis=0)
        score[t] = stacked[choice, np.arange(S)] + emit[t]
        back[t] = choice

    # End on the final token, or on the trailing blank before it.
    s = S - 1 if score[T - 1, S - 1] >= score[T - 1, S - 2] else S - 2
    path = np.zeros(T, dtype=np.int32)
    for t in range(T - 1, -1, -1):
        path[t] = s
        s -= int(back[t, s])
    return path


def _words_from_path(
    path: np.ndarray,
    tokens: np.ndarray,
    frame_scores: np.ndarray,
    words: list[str],
    word_of_token: list[int],
    seconds_per_frame: float,
    offset: float,
) -> list[WordTiming]:
    """Collapse a frame path into one span per word."""
    spans: dict[int, list[int]] = {}
    for t, s in enumerate(path):
        w = word_of_token[s]
        if w >= 0:                       # skip blanks and inter-word spaces
            spans.setdefault(w, []).append(t)

    out: list[WordTiming] = []
    for wi, word in enumerate(words):
        frames = spans.get(wi)
        if not frames:
            # A word the path never dwelt on. Not fatal — a very short function
            # word can be swallowed — but it must be visible, so it gets a
            # zero-confidence placeholder rather than being dropped.
            prev_end = out[-1].end if out else offset
            out.append(WordTiming(word=word, start=prev_end, end=prev_end, score=0.0))
            continue
        lo, hi = min(frames), max(frames)
        out.append(
            WordTiming(
                word=word,
                start=offset + lo * seconds_per_frame,
                end=offset + (hi + 1) * seconds_per_frame,
                score=float(np.exp(np.mean(frame_scores[frames]))),
            )
        )
    return out


# ------------------------------------------------------------------- aligner


class CtcAligner:
    """wav2vec2 CTC, used for both alignment and the ASR cross-check."""

    def __init__(self, model_name: str = config.ALIGN_MODEL) -> None:
        self.model_name = model_name
        self._model = None
        self._labels: list[str] = []
        self._blank = 0

    def load(self) -> None:
        import torch
        from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

        self._processor = Wav2Vec2Processor.from_pretrained(self.model_name)
        self._model = Wav2Vec2ForCTC.from_pretrained(self.model_name).eval()
        self._torch = torch

        vocab = self._processor.tokenizer.get_vocab()
        self._labels = [tok for tok, _ in sorted(vocab.items(), key=lambda kv: kv[1])]
        self._index = {tok: i for i, tok in enumerate(self._labels)}
        self._blank = self._index.get("<pad>", 0)
        self._delim = self._index.get("|", self._index.get(" ", None))
        if self._delim is None:
            raise RuntimeError(f"{self.model_name} has no word-delimiter token")

    def log_probs(self, samples: np.ndarray, sample_rate: int) -> tuple[np.ndarray, float]:
        """-> (frames x vocab log-probs, seconds per frame)."""
        if self._model is None:
            raise RuntimeError("log_probs() before load()")
        torch = self._torch

        audio = _resample(samples, sample_rate, config.ALIGN_SAMPLE_RATE)
        inputs = self._processor(
            audio, sampling_rate=config.ALIGN_SAMPLE_RATE, return_tensors="pt"
        )
        with torch.inference_mode():
            logits = self._model(inputs.input_values).logits[0]
        lp = torch.log_softmax(logits, dim=-1).numpy().astype(np.float64)
        seconds_per_frame = len(audio) / config.ALIGN_SAMPLE_RATE / lp.shape[0]
        return lp, seconds_per_frame

    def greedy_text(self, log_probs: np.ndarray) -> str:
        """CTC greedy decode — what the audio says, independent of the script."""
        ids = log_probs.argmax(axis=-1)
        out: list[str] = []
        prev = -1
        for i in ids:
            if i != prev and i != self._blank:
                out.append(self._labels[i])
            prev = i
        return _WS.sub(" ", "".join(out).replace("|", " ")).strip()

    def align(
        self, samples: np.ndarray, sample_rate: int, text: str, offset: float = 0.0
    ) -> tuple[list[WordTiming], str]:
        lp, spf = self.log_probs(samples, sample_rate)

        words = normalize(text).split()
        if not words:
            raise RuntimeError("nothing to align: transcript normalized to empty")

        # Build the blank-interleaved token sequence and remember, for every
        # position in it, which word it belongs to (-1 for blanks/spaces).
        tokens: list[int] = [self._blank]
        word_of_token: list[int] = [-1]
        for wi, word in enumerate(words):
            for ch in word:
                if ch not in self._index:
                    raise RuntimeError(f"character {ch!r} in {word!r} is outside the model vocabulary")
                tokens.append(self._index[ch])
                word_of_token.append(wi)
                tokens.append(self._blank)
                word_of_token.append(-1)
            if wi < len(words) - 1:
                tokens.append(self._delim)
                word_of_token.append(-1)
                tokens.append(self._blank)
                word_of_token.append(-1)

        tok = np.asarray(tokens, dtype=np.int64)
        path = _forced_align(lp, tok, self._blank)
        frame_scores = lp[np.arange(len(path)), tok[path]]
        timings = _words_from_path(
            path, tok, frame_scores, words, word_of_token, spf, offset
        )
        return timings, self.greedy_text(lp)


def _resample(samples: np.ndarray, src: int, dst: int) -> np.ndarray:
    """Linear resample. Adequate here: 24k -> 16k on clean synthetic speech.

    Deliberately not a dependency. If narration ever comes from real recordings
    with sharp content near Nyquist, replace this with a windowed-sinc rather
    than hoping linear interpolation is fine.
    """
    if src == dst:
        return samples.astype(np.float32)
    n = int(round(len(samples) * dst / src))
    x = np.linspace(0.0, len(samples) - 1, n)
    return np.interp(x, np.arange(len(samples)), samples).astype(np.float32)


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as w:
        if w.getsampwidth() != 2 or w.getnchannels() != 1:
            raise RuntimeError(f"{path.name}: expected 16-bit mono PCM")
        sr = w.getframerate()
        raw = w.readframes(w.getnframes())
    return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0, sr


# --------------------------------------------------------------- the QA gates


def _check_monotonic(words: list[WordTiming], beat_id: str) -> tuple[list[str], list[str]]:
    """-> (fatal, advisory). Failure mode 5's assertions, plus failure mode 1's.

    Drift is worst near the end of a long run, which is exactly where nobody is
    watching closely, so it has to be asserted rather than eyeballed.

    The zero-length check is the sharp detector for failure mode 1 and is worth
    separating from the WER gate. Forced alignment has to place *every* script
    word somewhere in the audio; a word the TTS never spoke has nowhere to go
    and collapses to no duration at all. That is a direct observation of the
    dropped word, where WER only infers it — and WER infers it badly, because
    one dropped word in a 26-word beat moves the rate by under four points,
    which is inside the noise the acoustic model generates on its own.
    """
    fatal: list[str] = []
    advisory: list[str] = []

    for a, b in zip(words, words[1:]):
        if b.start < a.start - 1e-6:
            fatal.append(f"{beat_id}: {b.word!r} starts before {a.word!r} — alignment is not monotonic")
        if b.start < a.end - 1e-3:
            fatal.append(f"{beat_id}: {a.word!r} and {b.word!r} overlap")

    starved = [
        w.word for w in words
        if w.duration <= 0
        or (len(w.word) >= MIN_CHARS_FOR_DURATION_CHECK
            and w.duration / len(w.word) * 1000 < MIN_MS_PER_CHAR)
    ]
    if starved:
        fatal.append(
            f"{beat_id}: {len(starved)} word(s) occupy too little audio for their "
            f"length {starved[:5]} — the narration is missing words the script contains"
        )
    weak = [w.word for w in words if 0 < w.score < WEAK_WORD_SCORE]
    if weak:
        advisory.append(f"{beat_id}: low-confidence words {weak[:5]} (<{WEAK_WORD_SCORE})")
    return fatal, advisory


def align_narration(
    narration,
    *,
    aligner: CtcAligner | None = None,
    max_wer: float = config.MAX_WER,
    max_deletions: int = config.MAX_DELETIONS_PER_BEAT,
    log=print,
) -> Alignment:
    """Align every beat against its own known text, then run the gates.

    Each beat is aligned independently and its timings shifted by the beat's
    offset in the track, so the aligner never has to reason about the inter-beat
    silence and error in one beat cannot propagate into the next.
    """
    aligner = aligner or CtcAligner()
    aligner.load()

    beats: list[BeatAlignment] = []
    errors: list[str] = []
    warnings: list[str] = []
    ref_all: list[str] = []
    hyp_all: list[str] = []

    for ba in narration.beats:
        timings, asr = aligner.align(
            ba.samples, narration.sample_rate, ba.text, offset=ba.start
        )
        ref = normalize(ba.text)
        rate, edits = wer(ref, asr)
        ref_all.append(ref)
        hyp_all.append(asr)

        fatal, advisory = _check_monotonic(timings, ba.beat_id)
        report = fatal + advisory

        # Deletions specifically, not the overall rate. The acoustic model's
        # own errors on this material are substitutions and splits — `WOAD` ->
        # `WODE`, `TREELINE` -> `TREE LINE` — which inflate WER while meaning
        # nothing. A word the ASR cannot find at all is the shape a dropped
        # word makes. Measured baseline: zero deletions across all six beats.
        deletions = [e for e in edits if e.startswith("del ")]
        if deletions:
            report.append(f"{ba.beat_id}: ASR heard no trace of {[d[4:] for d in deletions][:5]}")
        if edits:
            report.append(f"{ba.beat_id}: ASR edits {edits[:6]}")
        errors.extend(fatal)

        # Words must stay inside the beat they were spoken in, or a shot
        # boundary derived from them would land in the wrong beat.
        for w in timings:
            if w.start < ba.start - 1e-3 or w.end > ba.end + 1e-3:
                errors.append(
                    f"{ba.beat_id}: {w.word!r} at {w.start:.2f}-{w.end:.2f}s falls "
                    f"outside the beat ({ba.start:.2f}-{ba.end:.2f}s)"
                )
                break

        beats.append(
            BeatAlignment(
                beat_id=ba.beat_id, start=ba.start, end=ba.end, words=timings,
                asr_text=asr, wer=rate, report=report,
            )
        )
        flag = "FAIL" if (rate > max_wer or fatal or len(deletions) > max_deletions) else "ok  "
        log(f"  {ba.beat_id}  WER {rate:5.1%} {flag}  {len(timings):3d} words  "
            f"{ba.start:6.2f}-{ba.end:6.2f}s")
        for line in report:
            log(f"         {line}")
        if rate > max_wer:
            errors.append(
                f"{ba.beat_id}: WER {rate:.1%} exceeds {max_wer:.0%}. "
                f"script={ref!r} heard={asr!r}"
            )
        if len(deletions) > max_deletions:
            errors.append(
                f"{ba.beat_id}: {len(deletions)} word(s) absent from the narration "
                f"{[d[4:] for d in deletions][:5]} (limit {max_deletions})"
            )
        elif edits:
            warnings.append(f"{ba.beat_id}: {len(edits)} ASR edit(s) under threshold")
        warnings.extend(advisory)

    overall, _ = wer(" ".join(ref_all), " ".join(hyp_all))
    return Alignment(
        beats=beats,
        model=aligner.model_name,
        audio_duration=narration.duration,
        overall_wer=overall,
        errors=errors,
        warnings=warnings,
    )


def write_alignment(alignment: Alignment, path: Path) -> None:
    path.write_text(json.dumps(alignment.to_json(), indent=2) + "\n")
