---
project: smoke
script_version: 1
target_duration: 20
voice: narrator_male_low
---

<!--
  SMOKE FIXTURE — the first two beats of the Phase 1 script, for
  `python -m pipeline.smoke`. Short enough to run nightly in about a minute,
  long enough for three shots, so a dissolve between two pictures of one beat
  and a cut between beats are both rendered. Its goldens are in
  fixtures/smoke.golden.json; change this file and they must be re-recorded.
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
