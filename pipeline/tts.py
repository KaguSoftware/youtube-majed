"""Narration synthesis, behind an interface.

Kokoro-82M (Apache 2.0) is the Phase 1 voice. It stays behind `TTS` because
PLAN.md section 6 names narration quality as a cap on perceived quality, with
ElevenLabs as the paid escape hatch — that swap should be a config change, not
a rewrite.

**Synthesis is per beat, not one blob**, which is a deliberate choice with two
consequences that matter downstream:

1. *Alignment drift cannot accumulate across the film.* Failure mode 5 is the
   aligner drifting, worst near the end where nobody checks. Aligning six
   30-word beats against six known texts bounds the error inside each beat
   instead of letting it compound over 153 words.
2. *The WER gate localizes.* Failure mode 1 is TTS silently dropping a word.
   Per-beat ASR says *which* beat lost it, which is the difference between a
   usable error and "something is wrong somewhere in the audio".

The cost is that inter-beat silence is not spoken audio, so the shot planner
has to own it explicitly rather than discovering it as a gap.
"""

from __future__ import annotations

import wave
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import config

#: Abstract voice id -> backend voice. The script contract names a voice in
#: DESIGN.md terms (`narrator_male_low`); only this table knows it is Kokoro's
#: `am_michael`, which is what keeps the contract backend-agnostic.
VOICE_MAP = {
    "narrator_male_low": "am_michael",
    "narrator_male_british": "bm_george",
}

#: Silence inserted between beats. Long enough to read as a deliberate beat
#: break, short enough not to feel like a stall.
BEAT_GAP_SECONDS = 0.35

#: Kokoro emits roughly [-0.4, 0.4]. Normalizing up helps twice: the narration
#: is audible without the viewer reaching for the volume, and the CTC acoustic
#: model in align.py sees levels closer to the speech it was trained on.
PEAK_TARGET = 0.89


@dataclass
class BeatAudio:
    """One beat's narration, and where it sits in the concatenated track."""

    beat_id: str
    text: str
    samples: np.ndarray
    start: float
    end: float

    @property
    def duration(self) -> float:
        return self.end - self.start


@dataclass
class Narration:
    """The full track plus the per-beat index the aligner works from."""

    path: Path
    sample_rate: int
    beats: list[BeatAudio]
    duration: float
    voice: str


class TTS(ABC):
    """One narration backend."""

    name: str = "unnamed"
    sample_rate: int = config.TTS_SAMPLE_RATE

    @abstractmethod
    def load(self) -> None: ...

    @abstractmethod
    def say(self, text: str, voice: str) -> np.ndarray:
        """Synthesize one span. Must raise rather than return partial audio."""

    def preflight(self) -> tuple[bool, str]:
        return True, "ok"


class KokoroTTS(TTS):
    name = "kokoro-82m"

    def __init__(self, repo_id: str = "hexgrad/Kokoro-82M") -> None:
        self.repo_id = repo_id
        self._pipeline = None

    def preflight(self) -> tuple[bool, str]:
        try:
            import kokoro  # noqa: F401
        except ImportError as exc:
            return False, f"kokoro not importable: {exc}"
        try:
            import spacy

            spacy.load("en_core_web_sm", enable=["tok2vec", "tagger"])
        except Exception as exc:
            # preshed 3.0.14 breaks spaCy model loading with
            # "OverflowError: Python int too large to convert to C ssize_t"
            # while iterating tokenizer special-case keys. 3.0.9 is fine.
            # Kokoro's English G2P needs the POS tagger, so this is fatal.
            return False, (
                f"spaCy model load failed ({exc}); if this is an OverflowError, "
                "pin preshed==3.0.9 — see PLAN.md 8.12"
            )
        return True, "ok"

    def load(self) -> None:
        ok, msg = self.preflight()
        if not ok:
            raise RuntimeError(msg)

        from kokoro import KPipeline
        from misaki import espeak

        # Guard at the source of failure mode 1. Without the espeak fallback,
        # misaki *silently skips* out-of-dictionary words (`unk=''`), which for
        # a script full of `byred`, `woad`, `quern` means narration that is
        # quietly missing words — the exact failure the WER gate exists to
        # catch, except here it is cheap to prevent instead of detect.
        try:
            espeak.EspeakFallback(british=False)
        except Exception as exc:
            raise RuntimeError(
                f"espeak fallback unavailable ({exc}); out-of-dictionary words "
                "would be dropped from the narration silently. Install "
                "espeakng-loader or espeak-ng."
            ) from exc

        self._pipeline = KPipeline(lang_code="a", repo_id=self.repo_id)

    def say(self, text: str, voice: str) -> np.ndarray:
        if self._pipeline is None:
            raise RuntimeError("say() before load()")
        chunks: list[np.ndarray] = []
        for result in self._pipeline(text, voice=voice, speed=1.0):
            if result.audio is None:
                raise RuntimeError(
                    f"kokoro returned no audio for chunk {result.graphemes[:60]!r}"
                )
            audio = result.audio
            chunks.append(audio.numpy() if hasattr(audio, "numpy") else np.asarray(audio))
        if not chunks:
            raise RuntimeError(f"kokoro produced nothing for {text[:60]!r}")
        return np.concatenate(chunks).astype(np.float32)


def _write_wav(path: Path, samples: np.ndarray, sample_rate: int) -> None:
    """16-bit mono PCM. ffmpeg and the aligner both read it without a shim."""
    clipped = np.clip(samples, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype("<i2")
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm.tobytes())


def synthesize(
    beats,
    dest: Path,
    *,
    engine: TTS | None = None,
    voice_id: str = "narrator_male_low",
    gap: float = BEAT_GAP_SECONDS,
    log=print,
) -> Narration:
    """Speak every beat, concatenate with gaps, write one wav.

    Returns the per-beat index. The returned `start`/`end` are the authority on
    where each beat's words can possibly lie; nothing downstream should infer
    beat boundaries from the audio itself.
    """
    engine = engine or KokoroTTS()
    voice = VOICE_MAP.get(voice_id, voice_id)
    if voice_id not in VOICE_MAP:
        log(f"  warn   voice {voice_id!r} not in VOICE_MAP, passing through to {engine.name}")

    engine.load()
    sr = engine.sample_rate
    silence = np.zeros(int(round(gap * sr)), dtype=np.float32)

    pieces: list[np.ndarray] = []
    index: list[BeatAudio] = []
    cursor = 0  # in samples, so boundaries are exact rather than rounded twice

    for i, beat in enumerate(beats):
        samples = engine.say(beat.narration, voice)
        start = cursor / sr
        end = (cursor + len(samples)) / sr
        index.append(
            BeatAudio(
                beat_id=beat.beat_id,
                text=beat.narration,
                samples=samples,
                start=start,
                end=end,
            )
        )
        log(f"  {beat.beat_id}  {end - start:5.2f}s  {len(beat.words):3d} words  "
            f"({len(beat.words) / (end - start) * 60:.0f} wpm)")
        pieces.append(samples)
        cursor += len(samples)
        if i < len(beats) - 1:
            pieces.append(silence)
            cursor += len(silence)

    track = np.concatenate(pieces)

    # Normalize the whole track by one factor so relative beat loudness — part
    # of the performance — survives, then rescale each beat's cached samples by
    # the same factor so what the aligner sees is what was written to disk.
    peak = float(np.abs(track).max())
    if peak > 0:
        scale = PEAK_TARGET / peak
        track = track * scale
        for ba in index:
            ba.samples = ba.samples * scale

    _write_wav(dest, track, sr)
    duration = len(track) / sr
    log(f"  wrote {dest.name}  {duration:.2f}s  voice={voice}  peak={peak:.2f}->{PEAK_TARGET}")
    return Narration(path=dest, sample_rate=sr, beats=index, duration=duration, voice=voice)
