# Story Video Generator — Full System Plan

Personal system for Majed's YouTube channel. Last updated 2026-11-27.
Living version (with diagrams): https://claude.ai/artifact/C5GSB5usPi9rgC2baMkoKd

## 1. Overview

One sentence in, a finished, compressed video out: an 8+ minute YouTube story or a 60–90 s Reel, built through nine visible steps on a local website, with a human check at every step that matters.

Core idea: **Claude writes and directs, deterministic code animates.** Claude Code (on Majed's own subscription, via `claude -p`) writes the story, the beat plan and a compact scene JSON. A reusable animation library rendered by Remotion turns that JSON into video. Voice, sound and encoding all run locally, so the only metered resource is Claude usage.

**Goals**

- Viewers stay: every 30–90 s the story re-creates stakes and a question (Stakes → Big Question → Head Fake → Rehook loop).
- Premium sound: a clean narrator voice with per-line energy control. (Changed 2026-11-27: Chatterbox's built-in studio voice, not a clone; see section 5.)
- Editable at every layer: story text, tone per line, individual scenes, inserted gags and sound effects, without re-running the whole pipeline.
- Cheap to run: Claude only for writing and judgement; everything mechanical is local code.
- Light exports: a sharp 1080p 8-minute video in roughly 100–250 MB, not gigabytes.

**Constraints**

- Personal use for one YouTube channel only. No other users, nothing sold.
- Runs on Majed's MacBook Pro (M3 Pro, 36 GB unified memory). The machine must be on to render.
- Every video must look and sound distinct from the last one (YouTube "inauthentic content" rule, see Risks).

## 2. The pipeline (website steps)

The website is a stepper. Each step is its own page with a status (waiting, running, needs you, done). You can jump back to any finished step; later steps are marked out of date but keep what is still valid.

| # | Step | Who | What happens |
| --- | --- | --- | --- |
| 1 | Brief | You | Sentence, narrative type, format (YouTube or Reel), length |
| 2 | Story | Claude | Master loop options → loop map → narration |
| 3 | Review | Claude (2 agents) | Fact-check agent and retention critic, in parallel |
| 4 | Script editor | You | Edit lines, energy and tone; accept/reject suggestions; lock the script |
| 5 | Voice | Local | Channel voice (Chatterbox built-in studio voice) line by line, word timestamps |
| 6 | Storyboard | Claude | Scene JSON per group of lines, validated by code |
| 7 | Render | Local | Remotion draws the scenes; sound is mixed in |
| 8 | Video editor | You | Swap clips, insert gags and SFX, fix scenes |
| 9 | Export | Local | YouTube 16:9 and Reel 9:16, compressed |

Fix loops: a failed review sends only the flagged lines back to step 2; a scene fix in step 8 re-renders only that scene.

## 3. Story engine: the retention loop

Every story is a chain of loops: Stakes → Big Question → Head Fake → Rehook, where each rehook opens the next loop's stakes. An 8-minute video has one master loop and about 6–10 chapter loops; a Reel has one master loop and 2–3 micro loops.

| Beat | Job | Rule the engine enforces |
| --- | --- | --- |
| 1. Stakes | Make the viewer care | Tagged as one of: `character` (someone to root for), `at_risk` (something could be lost), `urgent` (a deadline). Doesn't have to be life or death, just something that matters. Stated in the first 15 s, restated every loop. |
| 2. Big question | Give the brain something to predict | One specific, juicy question ("what's the next card?"). Never a lazy yes/no. Answer withheld until the head fake. |
| 3. Head fake | Break the prediction | Set up expectation A, deliver B. Must be fair: every twist references an earlier plant beat. A twist with no plant is rejected. |
| 4. Rehook | Restart before attention drops | Close the current question and open a bigger one in the same breath. The viewer is never without an open question. |

**Loop levels**

- Master loop (whole video): main stakes, the title's promise as the big question, ending twist as the final head fake.
- Chapter loops (every 45–90 s): each is a full loop that raises the master stakes.
- Micro loops (every 10–20 s): line-level turns ("but then…", "except one thing was wrong").

**Generation (three Claude calls, each returning JSON via `--json-schema`)**

1. Premise → master loop: 3 options (logline, stakes type, big question, ending twist). User picks one.
2. Loop map: chapter loops with plants and payoffs linked by id.
3. Narration: each loop written line by line; every line has `energy` (1–5) and a `delivery` note.

```json
{
  "loops": [{
    "id": "L3", "level": "chapter",
    "stakes": {"type": "at_risk", "text": "The lighthouse lamp has 2 hours of oil left"},
    "question": "Who has been stealing the oil?",
    "headFake": {"expected": "the new assistant", "actual": "the keeper himself, sleepwalking", "plantIds": ["P2", "P5"]},
    "rehook": "And then he finds footprints that aren't his.",
    "lines": [{"id": "L3.4", "text": "He follows the trail.", "energy": 2, "delivery": "hushed, slow"}]
  }]
}
```

**Retention checker (code):** flags any stretch of more than ~20 s of narration with no open question, any loop with no stakes restated, any head fake with no plant, and (added at Gate 2) any master plant paid off before the last loop, since that gives the ending away. The story page shows a tension graph (one rise/drop per loop, gaps in red).

**Length budget:** the narrator's speaking rate × length. Changed 2026-11-27 (Gate 2): the built-in voice measured 165–174 wpm with pauses (scripts budgeted at 150 wpm came out ~15% short), so each brief now stores its rate, default **170 wpm** → 8 min ≈ 1,360 words; 75 s Reel ≈ 210 words. `pnpm voice` prints the measured rate so the default can be re-checked. The narration step gets a word budget per loop.

## 4. Review and script editing

**Automatic reviewers (parallel, each a separate `claude -p` session, JSON output)**

- Fact-check agent: extracts every factual claim, checks each with web search, marks confirmed / wrong (with correction + source) / unverifiable. Fiction gets an internal consistency check instead (names, timelines, world rules). Each consistency issue is major (blocks the lock) or minor (a suggestion), added at Gate 2.
- Retention critic: scores each loop on stakes, question, surprise and rehook (1–5), names the weakest 3 moments, proposes a rewrite for each.
- Findings appear as comments pinned to lines in the editor.

**Script editor**

- Each line shows text, energy (1–5), delivery note, reviewer comments.
- Energy/tone controls per line or selection (hype, hushed, dread, deadpan, awe, comic).
- Rewrite with direction: select lines + instruction ("make this the shocking reveal", "add a joke", "shorter"). Claude rewrites only those lines and keeps their ids.
- Accept/reject reviewer suggestions in one click; fact fixes keep their source.
- Re-run checks; tension graph and word budget update live.
- Lock the script. Locked lines are never rewritten by later steps.

## 5. Voice (decided: Chatterbox, local; built-in studio voice)

- Generated locally with **Chatterbox** (MIT licence, optional zero-shot clone from a 5–10 s reference clip, `exaggeration` and `cfg_weight` controls, inaudible watermark). Phase 1 finding: **Chatterbox-Turbo ignores `exaggeration` and `cfg_weight`** (its code says they "will be ignored"), so the engine is the original 500M Chatterbox, which has the energy controls this plan needs. Turbo (paralinguistic tags like `[laugh]`, `[chuckle]`, `[cough]`) stays selectable with `--engine turbo`, but there energy only nudges sampling temperature.
- Runs on the M3 Pro via PyTorch MPS (Apple GPU), with CPU fallback. Some Mac builds report MPS issues, so test both modes first. An MLX fork (`chatterbox-mlx`) is an alternative if speed is a problem.
- **Decision 2026-11-27: the channel voice is Chatterbox's built-in studio voice (`conds.pt`), not a clone.** Three blind listening rounds: clones of Majed's phone recordings (a 32 kbps memo; a 66 kbps recording with background noise ~17 dB down, raw and denoised) scored 1/5 on clean, premium and natural every time. The built-in voice won every round. Kokoro stock voices were clean but unnatural. Mastering changes made no audible difference: the clone quality comes from the reference. Cloning stays available (`pnpm voice <id> --reference clip.wav`), so a voice actor's studio-quality reference can still replace it later.
- Reference voice (for cloning, if used later): Majed's own voice, or a voice actor with written permission to clone. Record 1–2 min of clean WAV, pick the best 10 s. Optionally keep 2–3 reference clips of the same voice in different moods (calm, tense, excited) and pick per line.
- Energy mapping: energy 1–5 → exaggeration/cfg_weight presets. Chatterbox's defaults are 0.5 / 0.5, and reveals were planned at exaggeration ≥ 0.7 with cfg_weight ≈ 0.3 to stop rushing. Phase 1 measured that higher exaggeration makes a cloned voice darker and, above ~0.6, garbles words, so the shipped presets run 0.25 / 0.30 / 0.40 / 0.55 / 0.70 (cfg_weight 0.50 down to 0.30), with ≥ 0.7 for energy 5 only (`audio/studio_audio/config.py`). Measured on the clone; re-check by ear on the built-in voice.
- Lines are generated one at a time → "retake this line" (new seed or new energy) without redoing the rest.
- Timing: WhisperX forced alignment (wav2vec2) against the **known script text** → word-level timestamps. On macOS run on CPU with `compute_type float32` (WhisperX does not support MPS). Full transcription is not needed.
- Mastering (Pedalboard): high-pass → compressor → light room reverb → limiter → normalise to about −14 LUFS, measured as BS.1770 integrated loudness with the true peak held under −1.5 dBTP. Phase 1 findings: Pedalboard's own `Limiter` does not hold its ceiling, so the limiter is a small true-peak limiter of ours; lines are level- and tone-balanced against each other before mastering. Details in `audio/README.md`.

## 6. Animation

Rendered with **Remotion** (free licence for individuals, commercial use allowed). Claude Code builds a reusable library once, in interactive sessions. Each video only picks from it through scene JSON.

**Styles (one scene format)**

- Stick figure (2D, build first): SVG characters on a skeleton (head, torso, two-part arms and legs). Poses are keyframes of joint angles with easing, squash and stretch, secondary motion (head bob, arm swing). Faces are swappable expression sprites.
- Low poly (3D, Phase 5): low-poly glTF characters in `@remotion/three`, animated with Mixamo clips (royalty-free in videos; raw files must not be redistributed).

**Library targets before the first published video**

| Part | Minimum | Examples |
| --- | --- | --- |
| Actions | 60 | walk, run, sneak, fall, point, shrug, facepalm, panic, celebrate, argue |
| Expressions | 12 | neutral, shock, smirk, fear, anger, crying, deadpan |
| Backgrounds | 20 | house, street, office, forest, desert night, lab, spaceship |
| Props | 40 | phone, money, door, car, sign, cards, fire |
| Camera moves | 10 | slow push, whip pan, shake, zoom on face, dolly out |
| Transitions | 8 | cut, whoosh, smash cut, iris, glitch, page turn |
| Text/overlay styles | 6 | caption styles, map pins, title cards, counters |
| Colour grades | 6 | night, warm memory, horror green, noir, daylight, neon |

**Scene JSON (written by Claude, validated by code)**

```json
{ "id": "S41", "lineIds": ["L3.4", "L3.5"],
  "bg": "lighthouse_stairs", "grade": "night",
  "chars": [{"id": "keeper", "action": "sneak", "expr": "fear", "pos": "left"}],
  "props": [{"id": "lantern", "attach": "keeper.hand_r"}],
  "camera": "slow_push", "transitionIn": "cut",
  "sfx": [{"tag": "footsteps_wood", "at": "L3.4:0"}],
  "caption": "word_pop" }
```

- No timing in the JSON. Scenes start/end on the word timestamps of their `lineIds`. (Phase 0, before voice exists, uses a fixed duration per scene in a separate timing file.)
- Unknown ids map to the closest library item and are flagged; only broken scenes are regenerated.
- Variety guard: no repeat of the same background, action pair or camera move within ~30 s; avoid combinations used in the last 3 videos.
- Custom shots: up to 3 per video, Claude Code writes a one-off Remotion component. Rendered alone first; falls back to the closest library scene if it fails.

## 7. Sound design

Tagged local library + automatic mix rules. Claude only writes tags (`dog_bark`, `tension_riser`); code picks the file, places it on the word timestamp and mixes.

- SFX: Sonniss GDC bundles (royalty-free, commercial, no credit) + Freesound CC0 only. `licence` field on every file.
- Music: royalty-free beds by mood/tempo, with loop points and sting endings.
- Indexing script stores category, mood, length, loudness in SQLite.
- Mix rules: music ducks ~10–12 dB under voice; every head fake gets a riser then silence or a hit on the reveal word; transitions get whooshes; locations get ambience; final mix normalised and limited.

**Voice effect presets (Pedalboard)**

| Preset | Chain | Use |
| --- | --- | --- |
| Chipmunk | PitchShift +5 st | jokes, tiny voices |
| Giant | PitchShift −5, low-pass, reverb | villains, monsters |
| Phone call | high-pass + low-pass, light distortion | calls, radio, flashbacks |
| Echo thought | delay + reverb | inner voice |
| Robot | bitcrush + chorus | AI/robot characters |
| Underwater | low-pass + chorus | dreams, muffled scenes |

Presets apply to a whole line or a single word.

## 8. Video editor (after render)

Works on the project data (story, voice lines, scene JSON, sound tracks), not on the MP4. Any change re-renders only affected scenes, then stitches.

- Layout: Remotion Player preview on top; timeline with tracks for scenes, voice lines, SFX, music.
- Swap a clip (action, background, camera, expression) from library-only dropdowns with live preview.
- Regenerate a scene with a note → 2–3 versions to pick from.
- Insert a beat in plain words ("cut to a dog barking at him, he jumps") → Claude writes the scene + any new narration line → only that line is voiced → timing shifts automatically.
- Drop in SFX at a word; apply voice presets.
- Edit a line after the fact → only that line re-voiced; its scenes stretch.
- Trim, reorder, delete; captions and music re-flow.
- Flag scenes as misgenerated → fix list sent to Claude in one batch.
- Version history with compare and rollback.
- The Reel gets its own edit pass.

## 9. Export

H.264 with CRF (quality target), not fixed bitrate. Flat animation compresses far better than camera footage.

| Profile | Frame | Encoding | Length | Expected size |
| --- | --- | --- | --- | --- |
| YouTube long-form | 1920×1080, 30 fps | H.264 High, CRF 20, x264 preset slow, AAC 320 kbps, fast start | 8+ min | ~100–250 MB (estimate) |
| Reels / Shorts | 1080×1920, 30 fps | CRF 21, captions burned in | 60–90 s | ~15–40 MB |
| Quick preview | 1280×720, 30 fps | CRF 26, x264 preset veryfast | any | small |

- Every +6 CRF roughly halves file size. If a file is over the size cap, re-encode once at CRF +2.
- Vertical is a re-layout (9:16 composition, re-centred characters, captions in the safe zone), not a crop. A Reel is a separate 60–90 s cut around the strongest loop, or a short story with one master loop. YouTube treats vertical uploads up to 3 min as Shorts; Instagram doesn't recommend Reels over 3 min to new audiences.
- Each export also produces an `.srt`, a chapter list from the loop map, and 3 thumbnail frame suggestions from head-fake moments.

## 10. Architecture

Everything runs on the Mac; only writing goes to Claude.

- **Next.js web app** (TypeScript, Tailwind): stepper pages, script editor, video editor, Remotion Player preview.
- **SQLite + project folders**: projects, jobs, versions; story, scene JSON and audio per video; asset index. (Phase 2: the job queue is in `projects/studio.sqlite` and resumes after a restart; the Claude usage log is `projects/<id>/usage.jsonl`, append-only, one file per project.)
- **Job worker (Node)**: takes one job at a time from the queue; logs Claude usage per step.
- **Claude Code CLI**: `claude -p "<step prompt>" --model sonnet --output-format json --json-schema engine/schemas/<step>.json`, run inside `engine/`. Result in `structured_output`, validated again, saved to the project folder.
- **Python audio service** (FastAPI): Chatterbox-Turbo, WhisperX alignment, Pedalboard.
- **Remotion renderer**: animation library, 16:9 and 9:16 compositions, FFmpeg H.264 export.
- Supabase optional, only for queueing from a phone.

**Folder layout**

```
studio/  (repo root)
  app/              Next.js UI: stepper, script editor, video editor
  worker/           job queue, Claude calls, usage log
  engine/           Claude Code working folder
    CLAUDE.md       loop rules, JSON formats, library catalogue
    .claude/skills/ write-story, fact-check, critic, plan-scenes, custom-shot
    schemas/        one JSON Schema per step
  remotion/         animation library + 16:9 and 9:16 compositions
  audio/            FastAPI service: Chatterbox, WhisperX, Pedalboard
  assets/           sfx/, music/, voices/, index.sqlite
  projects/<id>/    brief, story, script, audio/, scenes, renders/, versions/
  docs/PLAN.md      this file
  legacy/           old system, read-only reference until Phase 3
```

## 11. Build phases

Each gate is a go/no-go check before the next phase.

| Phase | Build | Gate |
| --- | --- | --- |
| 0. Proof of look | Remotion project, stick-figure rig, 15 actions, 5 backgrounds; render a 60 s video from hand-written scene JSON | Would you post this look? |
| 1. Voice and timing | Channel voice (Chatterbox built-in studio voice); Chatterbox + WhisperX service; scenes and captions snap to word timestamps | A 60 s video in perfect sync |
| 2. Story engine and review | `claude -p` steps with JSON schemas, loop checker, tension graph; fact-check agent, retention critic, script editor | A script you'd happily read aloud |
| 3. Full 8-minute pipeline | Storyboard step, library to 60+ actions, SFX/music mixing, export profiles, stepper UI end to end (reuse old pages from `legacy/`) | First full video uploaded; usage and render time measured |
| 4. Video editor and Reels | Timeline, swap/regenerate scenes, insert beats, voice FX, partial re-render, version history, 9:16 re-layout and Reel cut | Any fix lands in minutes |
| 5. Low poly and custom shots | Low-poly characters with Mixamo in `@remotion/three`; Claude-written custom shots with fallbacks; cross-video variety guard | — |

Phase 3 note: the old voice picker (`legacy/web/components/voice-picker.tsx`, listed in `legacy/INVENTORY.md` as "reference clips of the signature voice") should choose between the built-in voice and any cloned reference clips, with the built-in voice as the default. `legacy/` is read-only, so the correction lives here.

## 12. Risks

| Risk | What the system does |
| --- | --- |
| YouTube "inauthentic content" (mass-produced/template videos lose monetisation channel-wide) | Human approval at story, script, final cut; variety guard; custom shots; clear series identity. The built-in Chatterbox voice is not unique to this channel, which weakens the voice part of this; a voice actor's cloned reference would restore it |
| Claude usage limits (5-hour windows; `claude -p` accounting may change) | Claude only for writing/judgement (~8–15 calls per video); usage logged per step; scene planning can switch to a local model |
| Wrong facts in true stories | Fact-check agent with sources + human sign-off before voice |
| Voice rights | The default built-in voice ships with Chatterbox's MIT-licensed weights. Cloning is only for own voice or a voice actor with written permission |
| Asset licences | Remotion free licence; Mixamo royalty-free in videos; SFX from licensed sources only; `licence` field on every asset |
| Render time / machine load | Single job queue; partial re-renders; measure first 3 videos |
| Custom shots crashing | Rendered alone first; automatic fallback |
