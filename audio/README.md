# audio/

The local voice service: Chatterbox voice (built-in studio voice by default, cloning
optional), WhisperX forced alignment, and Pedalboard mastering (RNNoise only prepares
clone references). FastAPI, its own uv venv (Python 3.12,
gitignored). Built in Phase 1; voice FX presets come in Phase 4. See
`docs/PLAN.md` sections 5, 7 and 10.

## Run it

```bash
cd audio
uv sync --no-install-project                   # once; creates .venv from uv.lock
uv run python -m studio_audio.pins fetch       # once; downloads the pinned weights (~7 GB)
uv run python -m studio_audio.server           # start the service (models stay loaded)
#   --engine original|turbo   --device mps|cpu   (defaults: original, mps)
```

From the repo root, with the service running:

```bash
pnpm voice lighthouse                          # voice every line; unchanged lines come from cache
pnpm voice lighthouse --line L3.4              # retake one line, new random seed
pnpm voice lighthouse --line L3.4 --seed 7     # ... with this seed
pnpm voice lighthouse --line L3.4 --energy 5   # ... at another energy
pnpm voice lighthouse --reference assets/voices/clip.wav   # clone a recording instead of the built-in voice
pnpm validate                                  # also reports lines the quality gate flagged
pnpm render                                    # 1080p, narration in AAC 320 kbps
pnpm render:preview                            # 720p, AAC 128 kbps
pnpm sync-check lighthouse --video renders/lighthouse-v1-voiced.mp4
```

Output goes to `projects/<id>/audio/` (gitignored): `lines/<id>.<key>.wav|json`
(one take each), `narration.wav` (mastered, 48 kHz mono), `voice.json`
(validated with zod, `packages/schema/src/voice.ts`), `overrides.json` (retakes).
`pnpm voice` and `pnpm render` copy `voice.json` and `narration.wav` into
`remotion/public/projects/<id>/` (gitignored) so Studio and renders can load them
with `staticFile()`. Copies, not symlinks: Remotion's static server 404s on symlinks.

API (127.0.0.1 only): `GET /health`, `POST /line` (one line: text, energy, seed,
reference clip), `POST /master` (assemble, master, write voice.json).

## Pipeline

0. **Voice.** The default is Chatterbox's built-in studio voice (`reference: "builtin"`,
   the `conds.pt` shipped with the pinned weights). Decided after blind tests in which clones
   of phone recordings scored 1/5 (docs/PLAN.md section 5). `voice.json` records it as
   `builtin:ResembleAI/chatterbox@<rev>/conds.pt`. Match EQ is skipped for it.
1. **Reference (only when cloning, `--reference clip.wav`).** `scripts/prepare_reference.py` cleans the full recording
   (RNNoise + mild EQ), then picks the best 10 s window from the cleaned audio
   (quiet gaps, brightness near the recording's average, steady level) and writes
   `assets/voices/majed-reference-clip.wav`.
2. **Line.** Chatterbox (original, MPS) with energy → exaggeration/cfg_weight and a
   per-line seed; the take is silence-trimmed (kept at the model's 24 kHz; no denoising: RNNoise removed nothing from a take and added a fizz band at 12-17 kHz), force-aligned
   against the known text (WhisperX, wav2vec2 on CPU, float32) and run through a
   quality gate. A failing take is retried with a new seed (up to 3 takes); the best
   is kept. Cache key = engine + model revision + text + settings + seed + reference
   hash. Old takes stay on disk.
3. **Track.** Takes are placed with the pause rules below, then mastered.
4. **Quality gate** (`align.py`). Forced alignment cannot tell that a word was
   dropped, so the same wav2vec2 model also reads the audio (greedy CTC) and the
   result is compared with the script (effective WER, merged and split words
   tolerated, long word heard as a scrap = cut). Also flagged: low-confidence words,
   words too short for their length, stray audio before or after the speech, and
   implausible pace. `ok` / `warn` / `fail` is stored per line in `voice.json`.

### Pause rules

Silence inserted between lines, on top of ~0.18 s of padding each take already
carries (`studio.py`, recorded in `voice.json` under `pauses`):

| Where | Pause |
| --- | --- |
| before the first line | 0.40 s |
| after a line ending `.` / `!` / `?` / `…` | 0.28 / 0.32 / 0.34 / 0.50 s |
| after a line ending in a comma, dash or nothing | 0.05 s |
| at a loop boundary (`L2.5` → `L3.1`) | 0.70 s |
| extra, before an energy-5 line inside a loop | +0.15 s |
| after the last line | 1.00 s |

### Track assembly (Phase 4)

`studio_audio/track.py` assembles and masters the track. The service's
`POST /master` and the edit engine (as a child process, no model loaded:
`uv run python -m studio_audio.track <request.json>`) share it. Since Phase 4
**every line starts on a video frame**: its offset is rounded to the nearest
1/30 s, so a pause changes by at most 17 ms and the track does not drift.
Word times are written as the line's offset plus the word's time in its take,
each rounded on its own. After an edit, every later line moves by whole
frames and every later word keeps its frame relative to its line, so the
render segments of unchanged scenes are reused. `voice.json` records it as
`pauses.frameRate: 30`. A project voiced before Phase 4 is aligned once with
`pnpm edit <id> align`.

### Voice effect presets (Phase 4)

`studio_audio/fx.py`, docs/PLAN.md section 7, with Pedalboard:

| Preset | Chain |
| --- | --- |
| `chipmunk` | PitchShift +5 st |
| `giant` | PitchShift −5, low-pass 2.8 kHz, reverb |
| `phone_call` | high-pass 320 Hz + low-pass 3.3 kHz, distortion 9 dB, filtered again |
| `echo_thought` | delay 210 ms (feedback 0.38) + reverb |
| `robot` | bitcrush 7 bit + chorus (7 Hz, feedback 0.55) |
| `underwater` | low-pass 650 Hz + chorus + low-pass 900 Hz |

An effect applies to a whole line or to one word (the word's span from the
take's own alignment, ±30 ms, 15 ms crossfades; nothing of the effect sounds
before the word, since a pitch shifter smears a little energy ahead of its
input). It never moves a word: timing follows the dry take, and a tail
(echo, reverb) rings on into the pause and under what follows. The effected
region is brought back to the dry region's speech level, and line balancing
is measured on the dry take, then applied to the effected one (measured on a
phone-call line, it would "fix" the effect back). Results are cached next to
the take: `lines/<id>.<key>.fx-<hash>.wav`; `voice.json` names it per line
(`fx.file`, `fx.effects`).

### Scene timing in Remotion

`remotion/src/scene/timeline.ts`: with a `voice.json`, scene 1 starts at frame 0;
every later scene starts 6 frames before the first word of its first line (never
before the previous scene's last word has ended, never less than 15 frames after
the previous start) and lasts until the next scene starts; the last scene lasts to
the end of the track. Captions use the frames nearest each word's real start and
end. Transitions overlap the previous scene and never move a start. Without a
`voice.json`, the Phase 0 `timing.json` fallback applies (silent, estimated words).

### Mastering

Upsample 24 -> 48 kHz once (long FIR; default resamplers leave a mirror image at 12-20 kHz) -> per-line balance (every line moved toward the median line's level and tone, clamped +-6 dB, 80% strength; energy 4-5 takes are otherwise ~20 dB duller above 6 kHz) -> 8 ms edge fades -> match EQ (toward your cleaned recording's spectrum, `studio_audio/matcheq.py`,
curve in `assets/voices/majed-reference-clip.eq.json`) → high-pass 80 Hz → leveller
(-26 dB, 3:1) → peak catcher (-14 dB, 6:1) → trace of room reverb → our own
true-peak limiter → gain to -14 LUFS (BS.1770 integrated, `pyloudnorm`), ceiling
-1.5 dBTP. Cross-checked with ffmpeg `ebur128`: -14.0 LUFS, -1.5 dBFS peak.

## What differs from the plan, and why (measured)

- **Turbo ignores `exaggeration` and `cfg_weight`** (Chatterbox source: "not
  supported by the Turbo version and will be ignored"). Plan section 5's energy
  mapping needs them, so the default engine is **original Chatterbox** (500M, also
  MIT). Turbo is still selectable (`--engine turbo`); there energy only nudges
  sampling temperature. In our (small) tests Turbo garbled more takes on this reference.
- **Presets are lower than the plan's.** Higher exaggeration made the clone darker
  and less like the reference (spectral centroid 1000 Hz at 0.30, 650 Hz at 0.50;
  speaker similarity 0.88 vs 0.83) and, above ~0.6, garbled words. Energy 1–5 →
  exaggeration 0.25 / 0.30 / 0.40 / 0.55 / 0.70, cfg_weight 0.50 / 0.50 / 0.50 /
  0.40 / 0.30. The plan's "≥ 0.7 with cfg ≈ 0.3" is kept for energy 5 only.
- **Limiter.** Pedalboard's own `Limiter` does not hold its ceiling (a -6 dB
  threshold still let peaks reach 0 dBFS), so mastering uses a small lookahead
  true-peak limiter of ours; Pedalboard still supplies the filters, compressors and
  reverb.
- **The channel voice is the built-in studio voice, not a clone** (docs/PLAN.md
  section 5). Cleaning (RNNoise) and the match EQ exist only for the clone path: a
  clone copies a reference's hiss, boom and dullness (Majed's phone recordings scored
  1/5 even when denoised), and its output is darker than the reference to begin with.
  The presets above were measured on the clone; check them by ear on the built-in voice.
- **WhisperX `compute_type float32`** is a faster-whisper option; forced alignment
  does not use faster-whisper. The alignment model simply runs in float32 on CPU.

## Speed (audio seconds per second of compute, M3 Pro 36 GB, warm-up excluded)

| Engine | MPS (Apple GPU) | CPU |
| --- | --- | --- |
| original Chatterbox (chosen) | 0.68 | 0.25 |
| Chatterbox-Turbo | 1.58 | 1.00 |

MPS wins for both, so `chatterbox-mlx` was not needed. Peak memory 5–6 GB. A 60 s
narration takes ~110 s to voice from scratch (including automatic retakes); a
retake of one line takes ~5–10 s; the first request after start-up is ~15 s slower
(MPS warm-up). Alignment + gate costs ~0.15 s per line on CPU.

## Pins

- Python packages: `uv.lock`. Python 3.12 (`.python-version`).
- Model weights: fixed Hub revisions in `studio_audio/pins.py`; sizes and SHA-256
  in `pins.lock.json`. `python -m studio_audio.pins check [--deep]` verifies the
  local files; `lock` regenerates the lock from the Hub.
- The venv needs overrides (`pyproject.toml`, `[tool.uv]`): `chatterbox-tts` pins
  torch 2.6 / numpy<2 / transformers 5.2, WhisperX pins torch 2.8 / numpy≥2.1 /
  huggingface-hub<1. Resolved to torch 2.8.0, numpy 2.x, transformers 4.57.6; both
  engines and the aligner run on it. `setuptools<81` because the Perth watermarker
  imports `pkg_resources`.
- Chatterbox's repository is archived ("retired research, no longer maintained",
  August 2026). Pinned weights and code keep working; there will be no fixes.

## Licences

| Component | Version / revision | Licence | Notes |
| --- | --- | --- | --- |
| Chatterbox (code, `chatterbox-tts`) | 0.1.7 | MIT | archived upstream |
| Chatterbox weights (original) | `ResembleAI/chatterbox` @ 5bb1f6ee | MIT | |
| Chatterbox-Turbo weights | `ResembleAI/chatterbox-turbo` @ 749d1c1a | MIT | not the default |
| Perth watermarker (`resemble-perth`) | 1.0.1 | MIT | every generated take carries an inaudible watermark |
| WhisperX | 3.8.6 | BSD-2-Clause | forced-alignment part only |
| Alignment weights | `facebook/wav2vec2-base-960h` @ 22aad52d | Apache-2.0 | also reads the audio for the quality gate |
| NLTK + `punkt_tab` data | 3.10.4 | Apache-2.0 | WhisperX downloads `punkt_tab` on first alignment (to `~/nltk_data`) |
| Pedalboard | 0.9.26 | **GPL-3.0** | fine for a personal tool that is not distributed; distributing Studio would make it GPL |
| pyloudnorm | 0.2.0 | MIT | loudness measurement |
| pyrnnoise / RNNoise | 0.4.6 | Apache-2.0 / BSD-3-Clause | denoiser (wrapper / C library) |
| PyTorch, torchaudio | 2.8.0 | BSD-3-Clause | |
| transformers | 4.57.6 | Apache-2.0 | |
| FastAPI, uvicorn | 0.165.0 / 0.54.0 | MIT / BSD-3-Clause | |
| Voice reference | `assets/voices/` | yours | own voice only (plan, risks); never committed |

## Sound design: assets and the mix (Phase 3)

```bash
pnpm assets seed && pnpm assets index    # the asset library (see assets/README.md)
pnpm mix eddystone-lead                  # projects/<id>/audio/mix.wav from the storyboard and voice.json
pnpm render:project eddystone-lead       # 720p preview with the mixed soundtrack
```

`worker/src/mix.ts` turns the storyboard's tags into a plan
(`projects/<id>/audio/mixplan.json`, zod schema in `packages/schema/src/sound.ts`):
every cue with its file, time on the narration track, gain and the reason it is
there. `studio_audio/mix.py` renders it. Claude only writes tags; code decides:

| Rule | What code does |
| --- | --- |
| sfx tag in a scene | the file's first sound (its measured onset) lands on the tagged word |
| head fake | a riser that **ends** on the reveal word, then a hit on the word (`hit`) or the beds drop out until the line ends (`silence`); music and ambience drop out 0.3 s before the word either way |
| transitions | a whoosh whose loudest moment is on a wipe's cut; an impact on a smash cut (not on a reveal shot, which has its hit) |
| locations | one ambience loop per run of scenes with the same kind of place (from the background's id and description; interiors get room tone) |
| music | one bed per run of loops with the same mood; a near mood if the library has none; crossfaded |
| ducking | music −11 dB under the voice (attack 70 ms, release 550 ms, 80 ms lookahead from the narration itself); ambience −4 dB |
| final | sum → −14 LUFS integrated (BS.1770) through a stereo true-peak limiter, ceiling −1.5 dBTP |

Levels: beds by integrated LUFS (music −21, ambience −31, room tone −44 before
ducking), one-shots by their loudest 400 ms window (sfx −21, footsteps −25, riser
−19, reveal hit −15, whoosh −22).

**Why one mixed track, mixed here.** Remotion can only set a volume per clip:
it cannot duck from the voice, limit the true peak of the sum or normalise the
final loudness. Mixing in Python reuses the mastering code (pyloudnorm, the
true-peak limiter) and gives Remotion one file to play. `pnpm render:project`
copies `mix.wav` next to `voice.json` and points `track.file` at it, so
remotion/src is unchanged. The plan is cached by hash
(`projects/<id>/audio/mix/<hash>.wav`): an unchanged plan is never mixed twice,
and `pnpm mix` never calls the voice service.

## Tests

```bash
cd audio && uv run --no-project --with pytest python -m pytest tests -q   # pause rules, gate, trimming, mastering targets
pnpm --filter @studio/schema test                                         # voice.json schema and cross-checks
```
