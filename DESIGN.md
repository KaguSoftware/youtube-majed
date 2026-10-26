# Pipeline Design — stages, contracts, validators

## Pipeline recap

```
idea → staging → scripting → style → production → editing → finalized → posted
```

Source of truth is a **timeline JSON** per project, versioned in Postgres. Every
renderer, agent and view is a pure function of it. Media lives in Blob storage.
Vercel is the control plane; a polling worker on a local/GPU machine does the work.

Audio is generated **before** images. Shot boundaries are derived from real
word-level timestamps, so sync is structural rather than something we fix later.

---

## State machine

Two document stages (`staging`, `scripting`) each own one artifact slot with an
internal `doc_status`, rather than being split into separate submit/review states.
Fewer states, same expressiveness.

| state | artifact slot | doc_status lifecycle | exits to |
|---|---|---|---|
| `idea` | topic, angle, target duration | — | `staging` |
| `staging` | `research.md` | `awaiting → invalid \| valid → approved` | `scripting` |
| `scripting` | `script.md` | `awaiting → invalid \| valid → approved` | `style` |
| `style` | style record + hero frame | `candidates → selected` | `production` |
| `production` | timeline + media | `running → done \| failed` | `editing` |
| `editing` | timeline versions | — | `finalized` |
| `finalized` | render + publish metadata | — | `posted` |
| `posted` | youtube video id | — | — |

**Slot filling is mode-agnostic.** The same endpoint accepts a human paste or a
worker running `claude -p`; nothing downstream can tell the difference.

```
POST /api/projects/:id/artifacts/research   { markdown }
POST /api/projects/:id/artifacts/script     { markdown }
```

**Demote** is a first-class transition. Any stage from `scripting` onward can go
back to `staging` or `scripting` with a reason. Forward-only machines always get
this retrofitted; cheaper to build it in.

---

## Stage: `scripting`

Research is facts. The script is what viewers actually hear — the highest-leverage
review point in the whole pipeline. It is also the input to shot planning, which is
why it must be **beat-structured** rather than raw prose: image prompts need visual
intent per segment, and having the model state that intent at script time is far
better than inferring it later from narration text.

A beat is roughly one to three shots. The actual split happens in production from
measured audio timestamps, not here.

### Contract — `script.md`

```markdown
---
project: barbarians-01
script_version: 2
target_duration: 180
voice: narrator_male_low
---

## Beats

### B01 — Cold open: the waking
narration: |
  Before the sun touches the treeline, he is already awake.
  The air inside the longhouse is thick with yesterday's smoke.
visual: pre-dawn interior, low embers, a figure rising from furs
mood: cold, blue, hushed
cites: [c1, c7]

### B02 — The hunt begins
narration: |
  ...
visual: ...
mood: ...
tone: true
```

`cites` are claim ids from `research.md`. This is where the grounding contract is
actually enforced: a beat either cites a claim or declares `tone: true` for pure
atmosphere that asserts no fact.

### Validator — `script.md`

- beat ids unique and matching `B\d\d`, in order
- every beat has `narration`, `visual`, `mood`
- every beat has non-empty `cites` **or** `tone: true`
- every cited id exists in the approved `research.md`
- estimated duration (word count ÷ 150 wpm) within ±25% of `target_duration`
- warn on any beat whose narration asserts a number, date or proper noun while
  carrying `tone: true` — cheap heuristic, catches the dangerous case

Failures render inline in the scripting UI with a **promote anyway** override.
The linter should be overrulable, but it should take a click.

---

## Stage: `style`

Insurance against the single most expensive mistake available: discovering you
hate the art direction after sixty images. Three candidates cost ~2 minutes;
a full production run costs ~40.

### Flow

1. User picks a **preset** from the style library
2. System generates **3 candidates of the same beat** — the most visually
   representative one, chosen at script approval — with three different seeds
3. User picks one, rerolls for three more seeds, or edits the prefix and regenerates
4. Selection locks `seed` + `hero_image`

Hold the subject constant across candidates. You are choosing between *looks*,
so varying the beat as well as the seed makes the comparison meaningless.

The locked hero must be stored **twice**: the full frame the user approved, and
a **tight character crop** of it (face, costume, no background). Shot generation
conditions on the *crop*, never the full frame.

This is not a detail. Measured in Phase 0: conditioning on a full-scene hero
makes the model reproduce that scene, so shots near the hero's setting come back
as near-duplicates and the prompt is ignored. Cropping to the character fixes it
completely, and is ~20% faster because reference cost scales with reference
area. There is no strength parameter to fall back on — reference conditioning is
all-or-nothing (PLAN.md section 8.11).

```json
"style": {
  "hero_full":  "blob://.../hero_c2.png",
  "hero_crop":  "blob://.../hero_c2_crop.png",
  "crop_box":   [0.22, 0.0, 0.70, 1.0]
}
```

The crop box is user-adjustable in the style stage, because an automatic crop
will sometimes clip a costume detail that matters.

The locked `hero_crop` becomes the reference for all shots in production. That, plus a fixed seed and one style LoRA, is how sixty separate
generations end up depicting the same world.

### Contract — style record

`styles.preset_json`, as `config.Style.to_record()` writes it:

```json
{
  "preset": "dark-oil-painting",
  "prompt_prefix": "dark oil painting, heavy impasto, chiaroscuro, muted earth palette, cinematic documentary still,",
  "seed": 88412,
  "hero_full": "images/3f9c0a1d2e4b5c6d.png",
  "hero_crop": "refs/8a7b6c5d4e3f2a1b.png",
  "crop_box": [0.22, 0.0, 0.70, 1.0]
}
```

`hero_full` and `hero_crop` are media keys (pipeline/media.py), or repo paths
for the Phase 1 library style. The model is fixed by the locked configuration
(FLUX.2 klein 4B, HANDOFF.md section 3), not chosen per style.

What the record deliberately does **not** have, because the locked model has
no such lever (HANDOFF.md section 5): no negative prompt (FLUX.2 has no
negative branch), no guidance or strength (distilled klein requires guidance
1.0; reference influence is architectural), no LoRA weight, no IP-Adapter
weight. The style UI must not offer any of them. An earlier draft of this
contract listed all four, from before the Phase 0 benchmark.

### Styles are reusable entities, not per-project throwaways

A business running a series wants one locked look across many videos. Keep
`styles` in its own table and let a project reference one. A project may override
`seed` and `hero_image` locally while inheriting the preset, so each video gets
its own hero frame without drifting from the house style.

---

## Staleness: the rule that keeps gates honest

Each artifact stores the hash of its upstream input.

```
research.md  → hash(topic, angle)
script.md    → hash(research.md)
style        → hash(script.md hero beat)
timeline     → hash(script.md, style)
```

When an upstream artifact changes, downstream artifacts are marked **stale** and
the UI shows a banner. Never silently delete them and never silently use them —
a rewritten research doc with an un-reviewed old script attached is exactly how a
wrong claim reaches a published video.

---

## Schema sketch

```sql
projects      (id, topic, angle, target_duration, state, style_id, created_at)
artifacts     (id, project_id, kind, version, markdown_raw, parsed_json,
               doc_status, upstream_hash, validator_report, approved_at)
styles        (id, name, preset_json, is_library)
style_runs    (id, project_id, candidates_json, selected_seed, hero_blob)
timelines     (id, project_id, version, timeline_json, created_at)
jobs          (id, project_id, kind, state, progress, claimed_by,
               heartbeat_at, error)
prompt_log    (id, project_id, kind, prompt_text, response_raw, hash, created_at)
```

`artifacts` keeps `markdown_raw` alongside `parsed_json`, and `prompt_log` keeps
every prompt with its raw response. When a video draws a correction, you need to
trace a claim back to the exact text that produced it.
