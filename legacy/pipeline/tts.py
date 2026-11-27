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

import os
import wave
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import config, pins

@dataclass(frozen=True)
class Voice:
    """A narrator the studio offers. `kokoro` is the backend's voice and
    `lang` the G2P it is spoken through: British voices read British
    pronunciation (misaki `b`), not American spellings in a British voice."""

    kokoro: str
    lang: str = "a"


#: Abstract voice id -> backend voice. The script contract and the studio name
#: a voice in DESIGN.md terms (`narrator_male_low`); only this table knows it is
#: Kokoro's `am_michael`, which is what keeps the contract backend-agnostic.
#: The two original ids keep their meaning, so every narration cached under
#: them is still the narration its key names. The rest are Kokoro's English
#: voices graded C or better in its VOICES.md at the pinned revision; the D
#: and F voices were trained on minutes of audio and drop words. Order and ids
#: match web/lib/voices.ts (selftest checks).
VOICES: dict[str, Voice] = {
    "narrator_male_low": Voice("am_michael"),
    "narrator_male_us_fenrir": Voice("am_fenrir"),
    "narrator_male_us_puck": Voice("am_puck"),
    "narrator_male_british": Voice("bm_george", "b"),
    "narrator_male_british_fable": Voice("bm_fable", "b"),
    "narrator_female_us_heart": Voice("af_heart"),
    "narrator_female_us_bella": Voice("af_bella"),
    "narrator_female_us_nicole": Voice("af_nicole"),
    "narrator_female_us_aoede": Voice("af_aoede"),
    "narrator_female_us_kore": Voice("af_kore"),
    "narrator_female_us_sarah": Voice("af_sarah"),
    "narrator_female_us_nova": Voice("af_nova"),
    "narrator_female_us_alloy": Voice("af_alloy"),
    "narrator_female_british_emma": Voice("bf_emma", "b"),
    "narrator_female_british_isabella": Voice("bf_isabella", "b"),
}
VOICE_MAP = {vid: v.kokoro for vid, v in VOICES.items()}
DEFAULT_VOICE = "narrator_male_low"


@dataclass(frozen=True)
class Pace:
    """How the narration is delivered. Kokoro has no control for emotion, so
    a delivery is its speaking rate and the pause between beats: a measured
    read lets a grave line land, a brisk one carries a lively film."""

    speed: float
    gap: float


#: Silence inserted between beats. Long enough to read as a deliberate beat
#: break, short enough not to feel like a stall.
BEAT_GAP_SECONDS = 0.35

#: Pace id -> delivery. `natural` is the narration every film had before
#: paces, and keeps its cache keys. Order and ids match web/lib/voices.ts.
PACES: dict[str, Pace] = {
    "measured": Pace(speed=0.9, gap=0.6),
    "natural": Pace(speed=1.0, gap=BEAT_GAP_SECONDS),
    "brisk": Pace(speed=1.1, gap=0.25),
}
DEFAULT_PACE = "natural"

#: Kokoro emits roughly [-0.4, 0.4]. Normalizing up helps twice: the narration
#: is audible without the viewer reaching for the volume, and the CTC acoustic
#: model in align.py sees levels closer to the speech it was trained on.
PEAK_TARGET = 0.89

#: Each retake speaks this much slower than the last, down to RETAKE_MIN_SPEED.
#: The narration gate's failures on correct scripts are words run into their
#: neighbours — LETTING heard as "IN" — and a slightly slower read is what
#: gives a swallowed word its own syllables back. The seed changes too, so even
#: at the floor each take is a different performance.
RETAKE_SPEED_STEP = 0.05
RETAKE_MIN_SPEED = 0.85


def retake_speed(take: int) -> float:
    return max(RETAKE_MIN_SPEED, 1.0 - RETAKE_SPEED_STEP * take)


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
    #: The content-addressed original in the cache, when there is one. The
    #: timeline records its key, so an edit on any machine can fetch the
    #: exact narration its film was cut to.
    source: Path | None = None


class TTS(ABC):
    """One narration backend."""

    name: str = "unnamed"
    sample_rate: int = config.TTS_SAMPLE_RATE

    @abstractmethod
    def load(self) -> None: ...

    @abstractmethod
    def say(self, text: str, voice: str, take: int = 0, speed: float = 1.0) -> np.ndarray:
        """Synthesize one span. Must raise rather than return partial audio.

        `take` asks for a different performance of the same text: take 0 is
        the narration every cache was built with; a later take is what the
        narration gate asks for when it heard a word go missing. `speed` is
        the delivery's rate (PACES); a retake slows from it.
        """

    def preflight(self) -> tuple[bool, str]:
        return True, "ok"


class KokoroTTS(TTS):
    def __init__(self) -> None:
        self.pin = pins.MODELS["tts"]
        #: What content addresses name this engine by (pins.Model.identity).
        self.name = self.pin.identity
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
        if self._pipeline is not None:
            return  # warm: a worker keeps one voice across jobs
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
            espeak.EspeakFallback(british=True)
        except Exception as exc:
            raise RuntimeError(
                f"espeak fallback unavailable ({exc}); out-of-dictionary words "
                "would be dropped from the narration silently. Install "
                "espeakng-loader or espeak-ng."
            ) from exc

        # Kokoro takes no revision: left to itself it downloads `main`. So it
        # is handed the pinned files, and the voices are loaded up front under
        # their own names, which it looks up before it would download one.
        import torch
        from kokoro import KModel

        pins.assert_cleared(self.pin)
        snap = self.pin.path
        model = KModel(repo_id=self.pin.repo, config=str(snap("config.json")),
                       model=str(snap("kokoro-v1_0.pth"))).eval()
        # One G2P per accent over the one model; each voice lives in its own.
        self._pipelines = {lang: KPipeline(lang_code=lang, repo_id=self.pin.repo, model=model)
                           for lang in sorted({v.lang for v in VOICES.values()})}
        for v in VOICES.values():
            self._pipelines[v.lang].voices[v.kokoro] = torch.load(snap(f"voices/{v.kokoro}.pt"),
                                                                   weights_only=True)
        self._pipeline = self._pipelines["a"]
        self._lang = {v.kokoro: v.lang for v in VOICES.values()}

    def say(self, text: str, voice: str, take: int = 0, speed: float = 1.0) -> np.ndarray:
        """Deterministic: the same text, voice, take and speed give the same samples.

        Kokoro's vocoder draws from torch's global RNG, so unseeded it is not —
        two cold syntheses of this script measured a peak sample difference of
        0.30 and word timings up to 20 ms apart. Seeding from the text makes
        narration a pure function of the script, which is what lets a pruned
        cache be rebuilt into the same film. `fork_rng` keeps the seed from
        leaking into anything else in a long-lived worker.

        Take 0 keeps the original seed and speed, so every narration cached
        before retakes existed is still the narration its key names.
        """
        if self._pipeline is None:
            raise RuntimeError("say() before load()")
        import hashlib

        import torch

        salt = f"{voice}\0{text}" + (f"\0take{take}" if take else "")
        seed = int.from_bytes(hashlib.sha256(salt.encode()).digest()[:8], "little")
        chunks: list[np.ndarray] = []
        with torch.random.fork_rng(devices=[]):
            torch.manual_seed(seed)
            pipeline = self._pipelines[self._lang.get(voice, "a")]
            results = list(pipeline(text, voice=voice, speed=speed * retake_speed(take)))
        for result in results:
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
    tmp = config.partial(path)
    with wave.open(str(tmp), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm.tobytes())
    os.replace(tmp, path)


def synthesize(
    beats,
    dest: Path,
    *,
    engine: TTS | None = None,
    voice_id: str = DEFAULT_VOICE,
    pace: str = DEFAULT_PACE,
    takes: dict[str, int] | None = None,
    memo: dict | None = None,
    log=print,
) -> Narration:
    """Speak every beat, concatenate with gaps, write one wav.

    Returns the per-beat index. The returned `start`/`end` are the authority on
    where each beat's words can possibly lie; nothing downstream should infer
    beat boundaries from the audio itself.

    `takes` names the take to speak for a beat (absent: take 0). `memo` keeps
    raw samples across calls, so a retake of two beats re-speaks two beats,
    not the film.
    """
    takes = takes or {}
    memo = {} if memo is None else memo
    engine = engine or KokoroTTS()
    voice = VOICE_MAP.get(voice_id, voice_id)
    if voice_id not in VOICE_MAP:
        log(f"  warn   voice {voice_id!r} not in VOICE_MAP, passing through to {engine.name}")
    delivery = PACES.get(pace) or PACES[DEFAULT_PACE]
    speed, gap = delivery.speed, delivery.gap

    engine.load()
    sr = engine.sample_rate
    silence = np.zeros(int(round(gap * sr)), dtype=np.float32)

    pieces: list[np.ndarray] = []
    index: list[BeatAudio] = []
    cursor = 0  # in samples, so boundaries are exact rather than rounded twice

    for i, beat in enumerate(beats):
        take = takes.get(beat.beat_id, 0)
        said = (engine.name, voice, beat.narration, take, speed)
        if said not in memo:
            memo[said] = engine.say(beat.narration, voice, take=take, speed=speed)
        samples = memo[said]
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
            f"({len(beat.words) / (end - start) * 60:.0f} wpm)" + (f"  take {take}" if take else ""))
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
    log(f"  wrote {dest.name}  {duration:.2f}s  voice={voice}  pace={pace}  peak={peak:.2f}->{PEAK_TARGET}")
    return Narration(path=dest, sample_rate=sr, beats=index, duration=duration, voice=voice)


# ------------------------------------------------------------------ samples

#: What every voice says in the studio's picker: two sentences, long enough
#: for Kokoro to settle (it is weak under ~20 tokens), in the films' register.
SAMPLE_TEXT = ("In the winter of four hundred and six, the Rhine froze solid. "
               "And the tribes who had waited for years on the far bank simply walked across.")


def write_samples(dest: Path, *, engine: TTS | None = None, log=print) -> list[Path]:
    """One mp3 per voice at the natural pace, for web/public/voices. The
    studio previews a pace by playing these faster or slower with the pitch
    kept, which is what Kokoro's `speed` does too."""
    import subprocess

    engine = engine or KokoroTTS()
    engine.load()
    dest.mkdir(parents=True, exist_ok=True)
    made = []
    for vid, voice in VOICES.items():
        samples = engine.say(SAMPLE_TEXT, voice.kokoro)
        peak = float(np.abs(samples).max()) or 1.0
        wav = dest / f".{vid}.wav"
        _write_wav(wav, samples * (PEAK_TARGET / peak), engine.sample_rate)
        mp3 = dest / f"{vid}.mp3"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-ac", "1",
                        "-b:a", "64k", str(mp3)], check=True)
        wav.unlink()
        log(f"  {vid:34s} {voice.kokoro:12s} {len(samples) / engine.sample_rate:4.1f}s")
        made.append(mp3)
    return made


if __name__ == "__main__":
    import sys

    if len(sys.argv) != 3 or sys.argv[1] != "samples":
        sys.exit("python -m pipeline.tts samples DEST   # one mp3 per voice, for the studio's picker")
    write_samples(Path(sys.argv[2]))
