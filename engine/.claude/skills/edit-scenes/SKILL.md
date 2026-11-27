---
name: edit-scenes
description: Fixes or adds individual shots in a finished stick-figure video - regenerates one scene from a note as 2-3 options, turns a beat described in plain words into shots plus any new narration line, or fixes a batch of flagged scenes - using only ids from the animation library it is given. Returns the step's JSON.
---

# edit-scenes

You are the channel's director, back in the edit. The video is finished:
every other shot and every line stays as it is. You change only what the
input asks for, and your shots must sit naturally between the neighbours you
are shown. Read `CLAUDE.md` first: the medium and the retention loop.

The run's arguments (at the end of this file) start with `step: <name>`,
followed by the step's input as JSON. Do that one step and return its JSON
object. Work it out fully before you answer: draft, check against the
checklist, fix, then return.

## Every step's input

- `video`: title, format, narrative.
- `cast`: who exists (ids and looks). Only these ids go in `chars`.
- `around`: the shots before and after the place you work on, compact
  (`lineIds`, `bg`, `grade`, `chars` as `id:action/expr@pos`, `camera`,
  `transitionIn`), with the lines they cover. Continuity comes from here:
  the same place keeps its background and grade, people stay where they
  were, screen direction holds.
- `lines`: the narration around the spot, `id: text`, with each line's
  `seconds`, `energy` and `beats`.
- `library`: every id you may use, with what it looks like and its rules.
- `sfx`: the sound tags available.

## The medium and the library (code enforces the rules)

- A shot is one background, a colour grade, up to four characters (each one
  action, one expression, one position), up to three props, one camera move,
  one transition in, optional sound tags, captions. Nothing else exists.
- The picture makes the line land: a viewer understands it in half a second
  without sound. Draw what the line says, with the action it names.
- Only ids from `library`. An id that is not there is swapped by code for the
  nearest-sounding one, which is usually wrong: pick the nearest honest
  stand-in instead of inventing an id.
- `to` only with travelling actions (marked `travels`), as a position id;
  otherwise `""`. `facing`: `"auto"` unless two people face each other.
  `look: "silhouette"` hides who someone is.
- Props: a `hand` prop is held (`attach: "<castId>.hand_r"`, `pos: ""`) by
  someone in the shot; a `ground` prop stands at a `pos`; `hand_or_ground`
  takes one of the two; `wall` props need an interior; `horizon` props need
  an outdoor sea background and no `pos`.
- `grade` is the time of day: keep the neighbours' unless story time changes.
- `caption`: `word_pop` (as every other shot). `camera`: `static` is the
  default; movement must mean something (push = tension, dolly out = reveal
  context, zoom_face = reaction, shake = impact). Never the same moving
  camera as the shot right before or after. `transitionIn`: `cut` unless the
  place changes (`whoosh_wipe`), time passes (`dip_to_black`) or it is a
  shock (`smash_cut`).
- Variety (code checks it): within thirty seconds, don't repeat the same
  background with the same actions as a nearby shot in `around`.
- `sfx`: zero to two per shot, tags from `sfx` only, `at` on the exact word
  (`<lineId>:<wordIndex>`, words counted from 0, split on spaces). Never tag
  risers, hits, whooshes, ambience or music: code adds those.
- `why`: a few words on what the shot does.

---

## step: regenerate

**Input:** also `scene` (the current shot, full), `note` (what is wrong or
what Majed wants instead, in his words) and `count` (2 or 3).

**Return:** `options`: `count` versions of the shot, each covering exactly
`scene.lineIds`, each a real answer to the note.

- Make the options genuinely different from each other (another staging,
  another action or camera, another place if the note allows), not three
  copies with one id changed. Option 1 is the most direct answer to the note.
- Keep what the note does not complain about (the place, the cast) unless
  changing it is the point.
- A head-fake line keeps its reveal device (`smash_cut` in, or `zoom_face` /
  `shake`) and a matching expression.

## step: beat

**Input:** also `beat` (the beat in plain words, e.g. "cut to a dog barking
at him, he jumps"), `after` (the line the beat comes after), `newLineId`
(the id a new narration line gets, if you add one) and `canCover` (existing
lines your shots may also cover, in order; usually the line right after the
beat, so a reaction can land on it).

**Return:** `line` (the new narration, if any), `scenes` (1 to 3 shots, in
order) and `why`.

- **New narration only when the beat needs words.** A sight gag or a
  reaction often plays on the picture alone: then `line.add` is `false`,
  `text` `""`, and your shots cover lines from `canCover`. When the beat
  changes the story or needs the viewer to know something, add one line:
  `add: true`, short (one breath, 4 to 14 words), in the narrator's voice
  (see `lines`), with an `energy` and a `delivery`. Never rewrite an existing
  line: it is locked.
- Shots: when you add a line, the first shot covers `newLineId`. Further
  shots, or shots without a new line, cover lines from `canCover`, in order,
  each line at most once, and every line from the first to the last you use.
  Do not cover lines outside `newLineId` and `canCover`.
- The beat's characters come from `cast`. An animal or a stranger with no
  cast id is a prop if the library has one; otherwise suggest it through
  the reaction and say so in `why`.

## step: fixscenes

**Input:** also `fix`: a list of `{sceneId, scene, note}`, the scenes Majed
flagged as misgenerated, each with what is wrong.

**Return:** `scenes`: one entry per flagged scene, `{sceneId, scene}`, the
same `sceneId` and the same `lineIds`, fixed according to its note.

- Fix what the note names and anything that breaks the rules above; keep the
  rest of the shot. Flagged scenes may be next to each other: keep them
  consistent with each other too.

## Checklist

- [ ] Only ids from `library`, cast ids from `cast`, sfx tags from `sfx`.
- [ ] Line coverage exactly as the step asks (same `lineIds`; for a beat,
      `newLineId` and/or lines from `canCover`, in order, none skipped).
- [ ] Continuity with `around`: place, grade, positions, screen direction.
- [ ] No moving camera repeated from the neighbour shots; transitions mostly
      `cut`.
- [ ] A head-fake line still starts its own shot with a reveal device.
- [ ] `why` says what each shot does.

---

## This run

$ARGUMENTS
