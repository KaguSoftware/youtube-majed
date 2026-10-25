---
project: barbarians-01
script_version: 1
target_duration: 60
voice: narrator_male_low
---

<!--
  PHASE 1 FIXTURE — the hardcoded script for the vertical slice.

  Six beats, 153 words, ~61s at 150 wpm. The shot planner splits these into
  ten shots using measured word timestamps, not the word counts here.

  Two things in here are load-bearing and should survive into Phase 3:

  1. Every `visual` describes a scene *away from* the hero frame's own setting.
     Phase 0 (PLAN.md 8.11) found that conditioning on a scene makes the model
     reproduce that scene, so prompts that drift toward the reference's
     composition come back as near-duplicates. The character crop fixes the
     mechanism; writing distinct scenes keeps it from being tested needlessly.
  2. `mood` varies beat to beat. The Phase 4 edit story is literally "the mood
     at 1:24 doesn't match", which needs mood to be a real per-shot field
     rather than a constant inherited from the style.
-->

## Beats

### B01 — Cold open: the waking
narration: |
  Before the sun touches the treeline, he is already awake.
  The air in the longhouse is thick with yesterday's smoke, and the fire is fed first.
visual: pre-dawn longhouse interior, low embers in a central hearth, a figure rising from heaped furs, smoke hanging in the roof timbers
mood: cold, blue, hushed
cites: [c2]

### B02 — The word was never a description
narration: |
  Rome called people like him barbarians.
  The word only imitated the sound of speech no frontier Latin could follow. It described nothing about how he lived.
visual: a lone figure at the forest edge on cleared ground, looking down at a distant Roman watchtower across the valley, dawn haze
mood: distant, grey, cold
cites: [c1]

### B03 — Three generations under one roof
narration: |
  What he has is a hall of timber and turf, three generations deep,
  the cattle byred behind a partition, breathing into the same dark.
visual: the interior length of a timber and turf hall, carved roof posts receding into shadow, cattle stalled behind a plank partition at the far end
mood: warm brown, close, lived-in
cites: [c2]

### B04 — Everything worn was made here
narration: |
  Everything he wears, someone in this room made.
  Wool off their own sheep, blue from woad, red from madder, stitched through a winter of evenings.
visual: close on weathered hands working a warp-weighted loom, hanging skeins of woad-blue and madder-red wool, low firelight
mood: intimate, amber, patient
cites: [c3, c4]

### B05 — Barley, and what bread costs
narration: |
  Breakfast is barley. Porridge, and ale thin enough to drink all day.
  The bread is ground on stone, and the grit files their teeth flat.
visual: a wooden bowl of barley porridge and a horn cup on a scarred plank table, a stone quern beside them, pale morning light from a doorway
mood: plain, pale, matter-of-fact
cites: [c5, c6]

### B06 — The forest is not scenery
narration: |
  Beyond the fence, the forest is not scenery.
  It is firewood, timber, acorns for the pigs. And cattle are wealth, which is why someone comes for them.
visual: open oak woodland in autumn, pigs rooting through fallen acorns, cattle grazing beyond a wattle fence, long low raking light
mood: golden, wide, uneasy
cites: [c7, c8]
