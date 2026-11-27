"""The production stage as one resumable function: inputs -> timeline + film.

Phase 1 had this inline in `run.py`. It moves here so the CLI slice and the
Phase 2 worker run the *same* code, in the same order:

    validate -> narrate -> align (+ gates, retaking the beats they name) -> plan -> images -> render

### Why resuming needs no special path

Every stage's output is content-addressed on disk — keyed by the hash of
everything that determines it — and every write is atomic (`config.partial`).
So a stage either finds its output already complete or produces it, and
re-running a half-finished job is just running it:

    narration   cache/audio/<hash(beat texts, voice, engine)>.wav  (seeded; tts.py)
    alignment   cache/align/<hash(wav bytes, aligner, gate settings)>.json
    images      cache/images/<hash(prompt, seed, refs, model settings)>.webp
    segments    cache/segments/<hash(image, move, duration, render)>.mp4

The checkpoint the worker writes to Postgres after each stage and each shot is
therefore a *record*, not the mechanism. It drives the progress view and it is
the evidence of what an attempt reused, but nothing reads it to decide what to
skip. A checkpoint that is stale, missing, or from another machine cannot make
the output wrong, because the decision is always made against the bytes.

One rule follows, and it is easy to break: **alignment reads the narration
back from the wav**, even on a cold run where the samples are still in memory.
Otherwise a cold run aligns float samples and a resumed run aligns the 16-bit
file, the two disagree by a rounding, and a resume could plan different shot
boundaries than the attempt it is resuming.
"""

from __future__ import annotations

import json
import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from . import align, assemble, captions, config, docs, images, pins, shots as shots_mod, tts
from .timeline import Timeline, file_sha, sha, upstream_hashes


class Gate(RuntimeError):
    """A deterministic stop: a validator, the narration gate (once its retakes
    are spent), an unrenderable timeline. Retrying would fail identically, so
    the worker fails the job instead of requeueing it."""

    def __init__(self, stage: str, errors: list[str]) -> None:
        self.stage = stage
        self.errors = errors
        super().__init__(f"{stage}: " + "; ".join(errors[:5]))


@dataclass
class Inputs:
    project: str
    topic: str
    research: docs.Research
    script: docs.Script
    style: config.Style
    target_shots: int = config.TARGET_SHOTS
    allow_fixture_sources: bool = False
    force: bool = False
    max_wer: float = config.MAX_WER
    #: Output frame size override, (width, height). None is the production
    #: 1080p. The weights-free queue test renders small to stay fast.
    render_size: tuple[int, int] | None = None
    #: The narrator and delivery chosen in the studio (tts.VOICES, tts.PACES).
    #: None: the script's `voice:` line, at the natural pace.
    voice: str | None = None
    pace: str | None = None


class Engines:
    """The three models, created on first use and kept by whoever owns this.

    The slice builds one per run; the worker keeps one for its lifetime, so the
    second job on a worker loads nothing. `unload_images=False` is what keeps
    klein resident between jobs.
    """

    def __init__(self, *, tts_engine=None, aligner=None, generator=None,
                 unload_images: bool = True) -> None:
        self._tts = tts_engine
        self._aligner = aligner
        self._generator = generator
        self.unload_images = unload_images

    @property
    def tts(self):
        if self._tts is None:
            self._tts = tts.KokoroTTS()
        return self._tts

    @property
    def aligner(self):
        if self._aligner is None:
            self._aligner = align.CtcAligner()
        return self._aligner

    @property
    def generator(self):
        if self._generator is None:
            self._generator = images.KleinGenerator()
        return self._generator


class Hooks:
    """Progress callbacks. No-ops here; the worker checkpoints and heartbeats.

    Any of these may raise to stop the run — that is how a worker that has
    lost its lease, or been asked to shut down, gets out between shots rather
    than finishing a job it no longer owns.
    """

    def stage(self, name: str) -> None: ...

    def done(self, key: str, value: dict) -> None: ...

    def shot(self, shot, stats: images.GenStats, done: int, total: int) -> None: ...


@dataclass
class Result:
    timeline: Timeline
    video: Path | None
    stats: images.GenStats | None = None
    notes: dict = field(default_factory=dict)


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = config.partial(path)
    tmp.write_text(json.dumps(data, indent=2) + "\n")
    os.replace(tmp, path)


def _copy(src: Path, dest: Path) -> None:
    tmp = config.partial(dest)
    shutil.copyfile(src, tmp)
    os.replace(tmp, dest)


# --------------------------------------------------------------------- stages


def validate(inputs: Inputs, *, log=print) -> dict:
    research, script = inputs.research, inputs.script
    log(f"  research.md: {len(research.claims)} claims")
    log(f"  script.md: {len(script.beats)} beats, {len(script.narration.split())} words, "
        f"target {script.target_duration:.0f}s")
    reports = {
        "research.md": docs.validate_research(
            research, allow_fixture_sources=inputs.allow_fixture_sources),
        "script.md": docs.validate_script(script, research),
    }
    errors: list[str] = []
    for name, report in reports.items():
        log(f"  {name}:")
        log(report.render())
        errors += [f"{name}: {e}" for e in report.errors]
    if errors:
        if not inputs.force:
            raise Gate("validate", errors)
        log("  force: promoting past the errors above")

    for ref in (inputs.style.hero_full, inputs.style.hero_crop):
        if not ref.exists():
            raise Gate("validate", [f"missing style reference {ref}"])
    log(f"  style {inputs.style.style_id} ({inputs.style.preset}), seed {inputs.style.seed}, "
        f"reference {inputs.style.hero_crop.name}")
    return {name: {"errors": r.errors, "warnings": r.warnings} for name, r in reports.items()}


def narrate(inputs: Inputs, paths: config.Paths, engines: Engines, *,
            takes: dict[str, int] | None = None, memo: dict | None = None,
            log=print) -> tts.Narration:
    """`takes` re-speaks the beats it names (see `narrate_and_gate`)."""
    voice_id = inputs.voice or inputs.script.meta.get("voice", tts.DEFAULT_VOICE)
    pace = inputs.pace if inputs.pace in tts.PACES else tts.DEFAULT_PACE
    engine = engines.tts
    takes = {b: t for b, t in (takes or {}).items() if t}
    voice = tts.VOICES.get(voice_id)
    key = sha(
        "narr-v2", engine.name, engine.sample_rate, voice_id, tts.VOICE_MAP.get(voice_id),
        tts.BEAT_GAP_SECONDS, tts.PEAK_TARGET,
        [(b.beat_id, b.narration) for b in inputs.script.beats],
        # Only when there are any, so every first-take narration keeps its key.
        *([sorted(takes.items()), tts.RETAKE_SPEED_STEP, tts.RETAKE_MIN_SPEED] if takes else []),
        # Likewise only off the defaults: an American voice at the natural
        # pace is every narration made before voices and paces were chosen.
        *([("pace", pace, tts.PACES[pace].speed, tts.PACES[pace].gap)] if pace != tts.DEFAULT_PACE else []),
        *([("lang", voice.lang)] if voice and voice.lang != "a" else []),
    )
    wav = paths.cache / "audio" / f"{key}.wav"
    index_path = wav.with_suffix(".json")

    # Both or neither: the index is what says the wav is complete. On another
    # machine these must be the original bytes, not a re-synthesis — Kokoro is
    # seeded, but not promised bit-identical across torch builds, and a
    # different wav aligns to different shot boundaries.
    if paths.mirror.ensure(wav) and paths.mirror.ensure(index_path):
        log(f"  cached {wav.name}")
    else:
        made = tts.synthesize(inputs.script.beats, wav, engine=engine, voice_id=voice_id, pace=pace,
                              takes=takes, memo=memo, log=log)
        # The index goes last: a wav without its index is not a cache hit.
        sr = made.sample_rate
        _write_json(index_path, {
            "sample_rate": sr, "voice": made.voice, "duration": made.duration,
            **({"takes": takes} if takes else {}),
            "beats": [
                {"beat_id": b.beat_id, "text": b.text,
                 "start": int(round(b.start * sr)), "end": int(round(b.end * sr))}
                for b in made.beats
            ],
        })
    # Cache hits too: see media.py, "Publishing heals". Index last.
    paths.mirror.publish(wav, "audio")
    paths.mirror.publish(index_path, "audio")

    # Read back from disk on every path — see the module docstring.
    samples, sr = align.read_wav(wav)
    index = json.loads(index_path.read_text())
    if sr != index["sample_rate"]:
        raise RuntimeError(f"{wav.name}: wav is {sr} Hz but its index says {index['sample_rate']}")
    _copy(wav, paths.audio)
    return tts.Narration(
        path=paths.audio,
        sample_rate=sr,
        beats=[
            tts.BeatAudio(beat_id=b["beat_id"], text=b["text"],
                          samples=samples[b["start"]:b["end"]],
                          start=b["start"] / sr, end=b["end"] / sr)
            for b in index["beats"]
        ],
        duration=len(samples) / sr,
        voice=index["voice"],
        source=wav,
    )


def align_and_gate(inputs: Inputs, narration: tts.Narration, paths: config.Paths,
                   engines: Engines, *, log=print) -> align.Alignment:
    aligner = engines.aligner
    key = sha(
        # v4: beats must lie in order inside the narration (failure mode 5).
        # v3: the WER backstop discounts the recogniser's own spelling and
        #     splits (align.effective_wer); merges are recognised by sound.
        # v2: the gate tells ASR word merges from dropped words (align.deletions).
        # The cached alignment carries the gate's verdict, so a change to the
        # gate must change the key or a re-run reloads the old verdict.
        "align-v4", file_sha(narration.path), aligner.model_name, inputs.max_wer,
        config.MAX_DELETIONS_PER_BEAT, align.MIN_MS_PER_CHAR, align.MIN_CHARS_FOR_DURATION_CHECK,
    )
    cached = paths.cache / "align" / f"{key}.json"
    if paths.mirror.ensure(cached):
        alignment = align.Alignment.from_json(json.loads(cached.read_text()))
        log(f"  cached {cached.name}")
    else:
        alignment = align.align_narration(narration, aligner=aligner, max_wer=inputs.max_wer, log=log)
        _write_json(cached, alignment.to_json())
    paths.mirror.publish(cached, "alignment")
    _copy(cached, paths.alignment)

    log(f"  overall WER {alignment.overall_wer:.1%} (gate {inputs.max_wer:.0%}), "
        f"{len(alignment.words)} words timed")
    if alignment.errors:
        for e in alignment.errors:
            log(f"  ERROR  {e}")
        if not inputs.force:
            # Failure mode 1 is non-negotiable in PLAN.md section 5: audio that
            # does not match the script makes every downstream timestamp wrong
            # while the video still looks fine.
            raise Gate("narration", alignment.errors)
        log("  force: continuing despite the narration gate")
    return alignment


def narrate_and_gate(inputs: Inputs, paths: config.Paths, engines: Engines, hooks: Hooks,
                     stage, *, log=print) -> tuple[tts.Narration, align.Alignment]:
    """Narrate, gate, and re-speak only the beats the gate names.

    Narration is seeded, so a failed gate is not bad luck that rendering again
    clears: the same script replays the same audio into the same verdict. What
    changes the verdict is a different performance of the beats it names, so
    those — and only those — get another take (slower, reseeded; tts.py), up to
    config.NARRATION_RETAKES times. Every take is content-addressed like the
    first, so a job that resumes walks the same takes out of the cache.
    """
    takes: dict[str, int] = {}
    memo: dict = {}
    for retake in range(config.NARRATION_RETAKES + 1):
        again = f", retake {retake}" if retake else ""
        stage("narrate", f"narrate ({engines.tts.name}){again}")
        narration = narrate(inputs, paths, engines, takes=takes, memo=memo, log=log)
        hooks.done("narration", {"wav_sha": file_sha(narration.path),
                                 "duration": round(narration.duration, 4), "voice": narration.voice,
                                 **({"takes": dict(takes)} if takes else {})})

        stage("align", f"align + ASR gate ({engines.aligner.model_name}){again}")
        try:
            return narration, align_and_gate(inputs, narration, paths, engines, log=log)
        except Gate as gate:
            beats = align.retake_beats(gate.errors, [b.beat_id for b in narration.beats])
            if beats is None or retake == config.NARRATION_RETAKES:
                if retake:
                    raise Gate(gate.stage, [f"still failing after {retake} retake(s) of "
                                            f"{', '.join(sorted(takes))}"] + gate.errors) from gate
                raise
            for b in beats:
                takes[b] = takes.get(b, 0) + 1
            log(f"  retake {', '.join(beats)}: the gate heard words missing, speaking "
                f"{'it' if len(beats) == 1 else 'them'} again")
    raise AssertionError("unreachable")


def plan(inputs: Inputs, narration: tts.Narration, alignment: align.Alignment,
         paths: config.Paths, engines: Engines, *, log=print) -> Timeline:
    style = inputs.style
    shot_list = shots_mod.plan(
        inputs.script.beats, alignment, style,
        target_shots=inputs.target_shots, audio_duration=narration.duration,
        period=inputs.script.meta.get("period"), protagonist=docs.protagonist(inputs.script), log=log,
    )
    width, height = inputs.render_size or (config.OUT_WIDTH, config.OUT_HEIGHT)
    weights = pins.models_record()
    for role, used in (("image", engines.generator.model_name), ("tts", engines.tts.name),
                       ("align", engines.aligner.model_name)):
        if used != pins.MODELS[role].identity:
            weights[role] = {"name": used}     # a stand-in (fakes.py), not the pinned weights
    timeline = Timeline(
        project=inputs.project,
        topic=inputs.topic,
        target_duration=inputs.script.target_duration,
        duration=narration.duration,
        audio={
            "path": paths.audio.name,
            "key": paths.mirror.key(narration.source) if narration.source else None,
            "sample_rate": narration.sample_rate,
            "duration": round(narration.duration, 4),
            "voice": narration.voice,
            "engine": engines.tts.name,
            "overall_wer": round(alignment.overall_wer, 4),
        },
        style={
            "style_id": style.style_id,
            "preset": style.preset,
            "prompt_prefix": style.prompt_prefix,
            "seed": style.seed,
            "hero_full": str(style.hero_full.name),
            "hero_crop": str(style.hero_crop.name),
            "crop_box": list(style.crop_box),
            # What every prompt was built with besides the shot's own words,
            # so an edit rebuilds a prompt exactly as the planner did.
            "period": inputs.script.meta.get("period"),
            "protagonist": list(docs.protagonist(inputs.script) or []) or None,
        },
        render={"width": width, "height": height, "fps": config.FPS, "xfade": config.XFADE_SECONDS,
                **({"captions": captions.STYLE} if config.CAPTIONS else {})},
        # Which bytes made this film: repository, commit and a digest of the
        # locked file hashes, so it can be found again in an archive
        # (failure mode 13, pipeline/pins.py).
        models={
            "image": {
                **weights["image"], "base": config.IMAGE_BASE_MODEL,
                "steps": config.GEN_STEPS, "guidance": config.GEN_GUIDANCE,
                "width": config.GEN_WIDTH, "height": config.GEN_HEIGHT,
            },
            "tts": weights["tts"],
            "align": weights["align"],
        },
        upstream=upstream_hashes(inputs.script.raw, inputs.research.raw, style),
        shots=shot_list,
    )

    timeline.write(paths.timeline)          # write() re-validates as it serializes
    for w in timeline.validation["warnings"]:
        if not w.endswith("no image yet"):
            log(f"  warn   {w}")
    log(f"  wrote {paths.timeline}")
    if timeline.validation["errors"]:
        # Not overridable: an unrenderable timeline cannot be promoted anyway.
        raise Gate("plan", timeline.validation["errors"])
    return timeline


def generate(inputs: Inputs, timeline: Timeline, paths: config.Paths, engines: Engines,
             hooks: Hooks, *, log=print) -> images.GenStats:
    total = len(timeline.shots)
    done = 0

    def on_shot(shot, stats):
        nonlocal done
        done += 1
        hooks.shot(shot, stats, done, total)

    stats = images.generate_shots(
        timeline.shots, inputs.style, paths, generator=engines.generator,
        on_shot=on_shot, unload=engines.unload_images, log=log,
    )
    log(f"  {stats.summary()}")
    timeline.write(paths.timeline)
    if stats.flagged:
        log(f"  warn   QA flagged {stats.flagged} after {images.MAX_ATTEMPTS} attempts")
    return stats


#: Contact-sheet frame size: the generation aspect (832x480) at a width that
#: stays sharp in the web app's filmstrips on a 2x display.
SHEET_THUMB = (320, 184)
SHEET_COLS = 10


def contact_sheet(timeline: Timeline, paths: config.Paths) -> tuple[Path, dict]:
    """Every shot's still, in order, in one small WebP.

    The web app's filmstrips and thumbnails read frames out of this with CSS
    rather than fetching each full still: one upload per film instead of one
    per shot, and a few hundred KB per page instead of megabytes. Both matter
    on the free tier (2,000 uploads and 10 GB of transfer a month).
    """
    from PIL import Image

    w, h = SHEET_THUMB
    shots = [s for s in timeline.shots if s.image is not None]
    cols = min(SHEET_COLS, max(1, len(shots)))
    rows = max(1, -(-len(shots) // cols))
    sheet = Image.new("RGB", (cols * w, rows * h), (20, 19, 18))
    for i, shot in enumerate(shots):
        # Through the mirror: an edit on a machine that did not paint the film
        # has only the stills it repainted on disk.
        paths.mirror.ensure(paths.root / shot.image.path)
        with Image.open(paths.root / shot.image.path) as im:
            frame = im.convert("RGB").resize((w, h), Image.LANCZOS)
        sheet.paste(frame, ((i % cols) * w, (i // cols) * h))
    tmp = paths.run / ".sheet.partial.webp"
    sheet.save(tmp, "WEBP", quality=72, method=6)
    dest = paths.cache / "sheets" / f"{file_sha(tmp)}.webp"
    dest.parent.mkdir(parents=True, exist_ok=True)
    os.replace(tmp, dest)
    return dest, {"cols": cols, "rows": rows, "thumb": [w, h],
                  "shots": [s.shot_id for s in shots]}


def publish_render(timeline: Timeline, rendered: assemble.Rendered, paths: config.Paths, *,
                   log=print) -> None:
    """Put what the browser plays into the store and on the timeline.

    `media.hls` lists the chunks in film order with their frame counts, which
    is everything the web app needs to write the playlists. Upload first,
    pointer second: the timeline that names these keys is written after."""
    from concurrent.futures import ThreadPoolExecutor

    fps = timeline.render["fps"]
    # The contact sheet is built while the chunks upload: an edit waits on both.
    with ThreadPoolExecutor(1) as ex:
        sheet_job = ex.submit(contact_sheet, timeline, paths)
        keys = paths.mirror.publish_many([path for _, path in rendered.chunks], "chunk")
        sheet, layout = sheet_job.result()
    chunks = [{"key": key, "frames": chunk.frames} for (chunk, _), key in zip(rendered.chunks, keys)]
    narration = paths.mirror.publish(rendered.narration, "audio")
    paths.mirror.publish(rendered.narration_index, "audio")
    paths.mirror.ensure(rendered.narration_index)
    slices = json.loads(rendered.narration_index.read_text())
    timeline.media["hls"] = {
        "fps": fps, "base": assemble.TS_BASE, "codecs": assemble.HLS_CODECS,
        "width": timeline.render["width"], "height": timeline.render["height"],
        "narration": narration, "narration_slices": slices,
        "duration": round(timeline.duration, 4), "chunks": chunks,
    }
    timeline.media["sheet"] = {"key": paths.mirror.publish(sheet, "sheet"), **layout}
    # A version's mp4 is made on request (an export), not with every render:
    # the store is 1 GB, and the chunks already are the film.
    timeline.media.pop("film", None)
    if paths.mirror.enabled:
        log(f"  published the chunks ({len(rendered.encoded)} new), the narration stream and the contact sheet")


def render(timeline: Timeline, paths: config.Paths, *, log=print) -> Path:
    rendered = assemble.build(timeline, paths, log=log)
    publish_render(timeline, rendered, paths, log=log)
    timeline.write(paths.timeline)
    return rendered.video


# ----------------------------------------------------------------------- run


def run(inputs: Inputs, paths: config.Paths, *, engines: Engines | None = None,
        hooks: Hooks | None = None, stop_after: str | None = None, log=print,
        stage_log=None) -> Result:
    """The whole production stage. `stop_after="plan"` stops before the GPU."""
    engines = engines or Engines()
    hooks = hooks or Hooks()

    def stage(key: str, title: str | None = None) -> None:
        hooks.stage(key)
        title = title or key
        (stage_log or (lambda t: log(f"== {t} " + "=" * max(0, 58 - len(t)))))(title)

    stage("validate")
    reports = validate(inputs, log=log)
    hooks.done("validate", reports)

    narration, alignment = narrate_and_gate(inputs, paths, engines, hooks, stage, log=log)
    hooks.done("alignment", {"overall_wer": round(alignment.overall_wer, 4),
                             "words": len(alignment.words), "warnings": alignment.warnings})

    stage("plan", "plan shots")
    timeline = plan(inputs, narration, alignment, paths, engines, log=log)
    hooks.done("plan", {"shots": len(timeline.shots), "duration": round(timeline.duration, 4),
                        "upstream": timeline.upstream})
    if stop_after == "plan":
        return Result(timeline=timeline, video=None)

    stage("images", f"generate images ({images.eta(len(timeline.shots))})")
    stats = generate(inputs, timeline, paths, engines, hooks, log=log)
    hooks.done("images_summary", {"generated": stats.generated, "cached": stats.cached,
                                  "rerolled": stats.rerolled, "flagged": stats.flagged})

    stage("render")
    video = render(timeline, paths, log=log)
    hooks.done("render", {"video": str(video.relative_to(paths.root)),
                          "duration": round(timeline.duration, 4)})
    return Result(timeline=timeline, video=video, stats=stats)
