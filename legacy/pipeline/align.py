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

from . import config, pins

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

    @classmethod
    def from_json(cls, d: dict) -> "Alignment":
        """Inverse of `to_json`. A resumed job reads its alignment back rather
        than re-running the aligner, so the shot plan it rebuilds is the one
        the first attempt planned — not one that differs by a rounding.
        """
        return cls(
            beats=[
                BeatAlignment(
                    beat_id=b["beat_id"], start=b["start"], end=b["end"],
                    words=[WordTiming(**w) for w in b["words"]],
                    asr_text=b["asr_text"], wer=b["wer"], report=list(b["report"]),
                )
                for b in d["beats"]
            ],
            model=d["model"],
            audio_duration=d["audio_duration"],
            overall_wer=d["overall_wer"],
            errors=list(d["errors"]),
            warnings=list(d["warnings"]),
        )


# ------------------------------------------------------------------ text prep


def normalize(text: str) -> str:
    """Fold text into the acoustic model's character vocabulary."""
    out = text.upper().replace("’", "'").replace("—", " ").replace("-", " ")
    out = _PUNCT.sub(" ", out)
    return _WS.sub(" ", out).strip()


def _edit_ops(ref: list[str], hyp: list[str]) -> list[tuple[str, int, str, str]]:
    """Levenshtein backtrace as (op, ref index, ref word, hyp word), in order."""
    n, m = len(ref), len(hyp)
    d = np.zeros((n + 1, m + 1), dtype=np.int32)
    d[:, 0] = np.arange(n + 1)
    d[0, :] = np.arange(m + 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost = 0 if ref[i - 1] == hyp[j - 1] else 1
            d[i, j] = min(d[i - 1, j] + 1, d[i, j - 1] + 1, d[i - 1, j - 1] + cost)
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


def wer(reference: str, hypothesis: str) -> tuple[float, list[str]]:
    """Levenshtein word error rate, plus a human-readable edit list.

    The edit list is the point. A bare number says "something is off"; naming
    the substitution is what lets someone decide whether the TTS dropped a word
    or the acoustic model simply cannot spell `quern`.
    """
    ref, hyp = reference.split(), hypothesis.split()
    if not ref:
        return (0.0 if not hyp else 1.0), []
    ops = _edit_ops(ref, hyp)
    edits = [f"sub {r}->{h}" if op == "sub" else f"del {r}" if op == "del" else f"ins {h}"
             for op, _, r, h in ops]
    cost = sum(1 for _ in ops)
    return cost / len(ref), edits


def _similarity(a: str, b: str) -> float:
    from difflib import SequenceMatcher

    return SequenceMatcher(None, a, b).ratio()


def _looks_like(a: str, b: str, at_least: float = 0.6) -> bool:
    return _similarity(a, b) >= at_least


#: A substitution spelled this much like the script's word is the recogniser
#: spelling a word it heard, not the narration missing it: NAHUA -> NAPHEWA,
#: COYOTE -> COYODE, JOINED -> JOIND. wav2vec2-base-960h is trained on English
#: audiobooks and spells any name it has not seen by ear.
NEAR_MISS = 0.6
#: Two heard words that join into the script's word: EVERYONE -> EVERY ONE,
#: TENOCHTITLAN -> TENACHTET LAN. Stricter than a near miss, because joining
#: is a second liberty taken on top of the spelling.
SPLIT_JOIN = 0.75


#: Words at least this long can leave a recognisable scrap when dropped.
FRAGMENT_MIN_LEN = 5


def _join_splits(ref: list[str], hyp: list[str]) -> list[str]:
    """Rejoin heard words the recogniser split from one script word."""
    vocab = set(ref)
    out: list[str] = []
    i = 0
    while i < len(hyp):
        if i + 1 < len(hyp):
            joined = hyp[i] + hyp[i + 1]
            # Only pieces that are not script words themselves get joined
            # (unless the join is exactly a script word), so two real words
            # heard correctly are never fused.
            pieces_unknown = hyp[i] not in vocab and hyp[i + 1] not in vocab
            if joined in vocab or (pieces_unknown and any(
                    _looks_like(joined, w, SPLIT_JOIN) for w in vocab if len(w) >= 5)):
                out.append(joined)
                i += 2
                continue
        out.append(hyp[i])
        i += 1
    return out


def effective_wer(reference: str, hypothesis: str) -> tuple[float, list[str]]:
    """The WER backstop with the recogniser's own spelling taken out.

    Measured on the second real script (the Aztecs): three beats failed an 18%
    WER ceiling on correct audio, every error a Nahuatl name spelled by ear or
    a compound split in two (a split counts twice: one substitution, one
    insertion). WER exists to catch mangled spans; a word spelled like the one
    in the script was spoken. Splits are rejoined, near-miss substitutions are
    not counted, and what remains is the rate. -> (rate, the edits that count).
    """
    ref, hyp = reference.split(), hypothesis.split()
    if not ref:
        return (0.0 if not hyp else 1.0), []
    ops = _edit_ops(ref, _join_splits(ref, hyp))
    counted = [
        f"sub {r}->{h}" if op == "sub" else f"del {r}" if op == "del" else f"ins {h}"
        for op, _, r, h in ops
        if not (op == "sub" and _similarity(r, h) >= NEAR_MISS)
    ]
    return len(counted) / len(ref), counted


def deletions(reference: str, hypothesis: str) -> tuple[list[str], list[str]]:
    """-> (words genuinely absent, words the ASR merged into a neighbour).

    Greedy CTC decoding without a language model sometimes misses the gap
    between two words and hears one: "SOUTH SHIELDS" -> SOUTHSHIELDS. The
    alignment then reads as a deleted SOUTH plus a substituted SHIELDS, the
    exact shape of a dropped word. Measured on the first real Phase 3 script:
    three beats failed the gate this way (SOUTH SHIELDS, NICK HODGSON, EXTRA
    MODIUS), every word present in the audio. A deletion is a merge when the
    word at the next or previous script position was heard as this word
    joined to it; anything else is still a deletion and still fails the gate.
    """
    ref, hyp = reference.split(), hypothesis.split()
    ops = _edit_ops(ref, hyp)
    heard_as = {i: h for op, i, _, h in ops if op == "sub"}
    absent, merged = [], []
    for op, i, word, _ in ops:
        if op != "del":
            continue
        after, before = heard_as.get(i + 1), heard_as.get(i - 1)
        # Joined by spelling (SOUTH SHIELDS -> SOUTHSHIELDS) or by sound
        # (CAN SEAL -> CONCEAL, from the Aztec script): the pair, run
        # together, is spelled like what was heard.
        if after and _looks_like(word + ref[i + 1], after, 0.7):
            merged.append(f"{word}+{ref[i + 1]}")
        elif before and _looks_like(ref[i - 1] + word, before, 0.7):
            merged.append(f"{ref[i - 1]}+{word}")
        else:
            absent.append(word)
    # A word cut out of the audio often leaves a fragment, not silence: the
    # gate's negative control splices EVENINGS out and the recogniser hears
    # "ETN". A long word heard as a short scrap that is not spelled like it is
    # the shape a dropped word leaves; a misspelling keeps most of the word.
    # Checked on the joined hypothesis, so a split (MODII -> MODI I) is not a
    # scrap.
    for op, _, word, heard in _edit_ops(ref, _join_splits(ref, hyp)):
        if (op == "sub" and len(word) >= FRAGMENT_MIN_LEN and len(heard) * 2 <= len(word)
                and _similarity(word, heard) < NEAR_MISS):
            absent.append(f"{word} (heard only {heard!r})")
    return absent, merged


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

    def __init__(self) -> None:
        self.pin = pins.MODELS["align"]
        #: What content addresses and the alignment record name this model by.
        self.model_name = self.pin.identity
        self._model = None
        self._labels: list[str] = []
        self._blank = 0

    def load(self) -> None:
        if self._model is not None:
            return  # warm: a worker keeps one aligner across jobs
        import torch
        from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

        pins.assert_cleared(self.pin)
        repo, rev = self.pin.repo, self.pin.revision
        self._processor = Wav2Vec2Processor.from_pretrained(repo, revision=rev)
        self._model = Wav2Vec2ForCTC.from_pretrained(repo, revision=rev, use_safetensors=True).eval()
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
        raw_rate, edits = wer(ref, asr)
        rate, counted = effective_wer(ref, asr)
        ref_all.append(ref)
        hyp_all.append(asr)

        fatal, advisory = _check_monotonic(timings, ba.beat_id)
        report = fatal + advisory

        # Deletions specifically, not the overall rate. The acoustic model's
        # own errors on this material are substitutions and splits — `WOAD` ->
        # `WODE`, `TREELINE` -> `TREE LINE` — which inflate WER while meaning
        # nothing. A word the ASR cannot find at all is the shape a dropped
        # word makes. Measured baseline: zero deletions across all six beats.
        absent, merged = deletions(ref, asr)
        deletions_ = [f"del {w}" for w in absent]
        if absent:
            report.append(f"{ba.beat_id}: ASR heard no trace of {absent[:5]}")
        if merged:
            report.append(f"{ba.beat_id}: ASR ran words together (heard, not dropped): {merged[:5]}")
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
        flag = "FAIL" if (rate > max_wer or fatal or len(deletions_) > max_deletions) else "ok  "
        log(f"  {ba.beat_id}  WER {rate:5.1%} (raw {raw_rate:5.1%}) {flag}  {len(timings):3d} words  "
            f"{ba.start:6.2f}-{ba.end:6.2f}s")
        for line in report:
            log(f"         {line}")
        if rate > max_wer:
            errors.append(
                f"{ba.beat_id}: WER {rate:.1%} exceeds {max_wer:.0%} after spelling "
                f"near-misses and splits, counting {counted[:6]}. script={ref!r} heard={asr!r}"
            )
        if len(deletions_) > max_deletions:
            errors.append(
                f"{ba.beat_id}: {len(deletions_)} word(s) absent from the narration "
                f"{absent[:5]} (limit {max_deletions})"
            )
        elif edits:
            warnings.append(f"{ba.beat_id}: {len(edits)} ASR edit(s) under threshold")
        warnings.extend(advisory)

    # Failure mode 5's "total within tolerance of audio length". Each beat is
    # aligned on its own slice, so drift cannot accumulate across beats; what
    # remains is a beat index that no longer describes its wav (a re-synthesis
    # written under an old index). Then every timing is shifted by a wrong
    # offset, and only the beats themselves can say so.
    for a, b in zip(narration.beats, narration.beats[1:]):
        if b.start < a.end - 1e-3:
            errors.append(f"{b.beat_id} starts at {b.start:.3f}s, before {a.beat_id} ends ({a.end:.3f}s)")
    if narration.beats and narration.beats[-1].end > narration.duration + 1e-3:
        errors.append(f"the last beat ends at {narration.beats[-1].end:.3f}s, after the narration "
                      f"itself ({narration.duration:.3f}s)")

    overall, _ = wer(" ".join(ref_all), " ".join(hyp_all))
    return Alignment(
        beats=beats,
        model=aligner.model_name,
        audio_duration=narration.duration,
        overall_wer=overall,
        errors=errors,
        warnings=warnings,
    )


def retake_beats(errors: list[str], beat_ids) -> list[str] | None:
    """-> the beats a retake could fix, or None if one could not fix them all.

    Every per-beat gate message starts `<beat id>: ` — a dropped or starved
    word, the WER backstop, a word outside its beat. Those are about how one
    beat was spoken, and re-speaking it is a fair test. Anything else (beats
    out of order, a track shorter than its index) says the narration file
    itself is wrong, and re-speaking a beat would only hide that.
    """
    known = set(beat_ids)
    named: list[str] = []
    for e in errors:
        beat, sep, _ = e.partition(": ")
        if not sep or beat not in known:
            return None
        if beat not in named:
            named.append(beat)
    return named or None


def write_alignment(alignment: Alignment, path: Path) -> None:
    path.write_text(json.dumps(alignment.to_json(), indent=2) + "\n")
