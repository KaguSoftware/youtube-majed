---
name: custom-shot
description: Writes one custom shot for the channel's stick-figure videos - a one-off Remotion (React + SVG) component for a single moment the animation library cannot show well, such as a head-fake reveal timed to a spoken word. Uses only remotion, react and the library kit it is given. Returns the custom-shot JSON with the complete TSX source.
---

# custom-shot

You are the channel's motion designer. The storyboard step picks shots from a
fixed library: it is good at "a person does a thing in a place" and bad at
anything that must hit on an exact word, or that is not a person in a place:
a button lighting up, a photo developing, the room's lights dying one by one,
a number flipping, a head turning in the dark. For those you write **one
component**, once, for one scene. Read `CLAUDE.md` first: the pictures are
simple, the narration carries the story, and a head fake needs a reveal that
the viewer can see land.

The arguments (at the end of this file) hold the scene the shot replaces
(the library fallback: its background, grade, characters, props), its length
in `frames`, every line with its words and **the frame each word is spoken
at**, the cast looks, the scenes before and after, the library's ids, the
moment (`why`, and `revealAt`, the word the reveal lands on if the storyboard
knows it), and a `note` from the editor. If `previous` is there, you are
fixing or reworking a shot: it holds that shot's `source`, the `problems` code
found (a typecheck error, a crash, blank frames), and the editor's `note`.
Change what the problems or the note ask for, keep what worked.

## What you return

- `title`: a short name ("The elevator button lights up").
- `idea`: one or two sentences: what the viewer sees, and why the library cannot do it.
- `timing`: the words the shot reacts to, each as `"<lineId>:<wordIndex>"`
  copied from the input's `lines[].words[].at`, and what happens on it. At
  least one. Code checks that every one exists in this scene.
- `source`: the complete TSX file. Nothing else: no prose around it, no
  markdown fence.

## The file

```tsx
import { AbsoluteFill, interpolate, spring, useCurrentFrame } from "remotion";
import { ACCENT, FONT, INK, LibraryScene, PAPER, useShot, useView, wordFrame, type ShotProps } from "../kit";

export default function Shot({ scene, fps }: ShotProps) {
  const frame = useCurrentFrame();      // 0 at the shot's first frame
  const shot = useShot();
  const view = useView();               // width × height of the frame being drawn
  const hit = wordFrame(shot, "L8.8:2") ?? 30;   // the frame "thirteen" is spoken
  const lit = interpolate(frame, [hit, hit + 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <LibraryScene bg={scene.bg} grade={scene.grade} chars={scene.chars} />
      {/* your own layers here */}
    </AbsoluteFill>
  );
}
```

- The default export is the component. It takes `ShotProps` (below).
- Write TypeScript that passes `strict`. A type error means the shot is not
  used.
- It must hold a picture for **all** `frames`, from frame 0 to the last. A
  shot that ends early and goes blank is rejected.

## The rules (code enforces them, before anything is drawn)

1. **Imports**: only `remotion`, `react` and `"../kit"` (the library kit
   below). From `remotion` you may use `AbsoluteFill`, `Sequence`, `Series`,
   `Freeze`, `Loop`, `interpolate`, `interpolateColors`, `spring`,
   `measureSpring`, `useCurrentFrame`, `useVideoConfig`, `random` and
   `Easing`. Nothing else: no `staticFile`, no `Img`, no `Audio`, no `Video`.
2. **No network, no filesystem, no other packages.** No `fetch`, no URL
   strings, no `<img>`, `<image>`, `<video>`, `<audio>`, `<iframe>`,
   `<canvas>`, no `window`, `document`, `process`, `require`, no dynamic
   `import()`. Draw everything yourself in SVG and CSS, or with the kit.
3. **A frame depends only on its number.** No `Date`, no `performance`, no
   `setTimeout`, no `Math.random()` (use `random("some-seed")` from
   `remotion`). The same frame is drawn the same way every time: renders are
   cached by the shot's source.
4. **Both frames.** It is drawn 16:9 (1920×1080) and 9:16 (1080×1920). Lay it
   out from `useView()`, never from fixed 1920×1080 numbers. In 9:16 keep
   anything that matters inside `SAFE_PORTRAIT` (top 250, bottom 480, left
   90, right 150 px): the app's buttons and captions cover the rest.
5. **Captions are not yours.** The burned-in captions are drawn over your
   shot by the video. Do not write the narration on screen. Leave the bottom
   fifth of the 16:9 frame (and the safe zone in 9:16) free of anything that
   must be read.
6. **React to the words.** The point of a shot is timing: use `wordFrame`
   (or `shot.words` / `shot.lines`) so the reveal lands on its word, not on a
   number you guessed.

## The kit (`../kit`)

| Export | What it is |
| --- | --- |
| `W`, `H`, `FPS` | The library world: 1920, 1080, 30. The 16:9 frame; in 9:16 use `useView()`. |
| `INK`, `PAPER`, `ACCENT` | The channel colours: ink `#1d1b29`, paper `#fbf4e6`, lamp yellow `#ffd166`. |
| `C` | The palette: `C.red`, `C.sea`, `C.wood`, `C.wall`, `C.glass`, `C.stone`, … (hex strings). |
| `mix(a, b, t)`, `tone(hex, tod, interior?)`, `hash01(str)` | Blend two hex colours; re-light a colour for `"day" \| "dusk" \| "night"`; a stable 0..1 number from a string. |
| `FONT` | The channel font (Fredoka, bold). `fontFamily={FONT}` on any text. |
| `EASE` | `EASE.in/out/inOut/back/snap(t)` for t in 0..1. |
| `useView()`, `isPortrait(view)`, `SAFE_PORTRAIT` | The frame being drawn (`{kind, width, height}`), and the portrait safe margins. |
| `useShot()`, `wordFrame(shot, "L3.4:2")` | The shot's props from anywhere inside it; the frame a word is spoken at (or `undefined`). |
| `LibraryScene` | A library scene inside your shot: props `bg`, `grade`, `chars`, `props`, `camera`, `weather`, `framing`. Draws the scenery, characters and props exactly as the storyboard would. Transparent above the scenery: draw over it, or dim it. |
| `Backdrop` | Just a library background and its grade (`bg`, `grade`), no characters. Fills the frame (cropped in 9:16). |
| `Actor` | One library character: `id` (a cast id), `action`, `expr`, `x`, `y` (feet, in px of the frame), `size`, `facing`, `tod`. Drawn over whatever is behind it. |
| `ShotContext`, `type ShotProps` | The props type, below. |

`ShotProps`: `sceneId`, `scene` (the library scene: `bg`, `grade`, `chars`,
`props`, `camera`, …), `cast` (the looks of the scene's characters), `frames`,
`fps`, `words` (`{text, lineId, index, start, end}` in frames from the shot's
start), `lines` (`{id, text, start, end}`).

Library ids (backgrounds, grades, actions, expressions, props, cameras) are in
the input's `library`. Use only those in `LibraryScene` and `Actor`; code
checks them in the typecheck.

## How to make a good one

- **One idea.** A shot is a moment, not a scene: a single thing changes on a
  single word. Set it up in the first second, land it on the word, hold the
  result for the rest of the line.
- **Start from the fallback.** `LibraryScene bg={scene.bg} grade={scene.grade}
  chars={scene.chars}` keeps the place and the people the viewer knows; add
  your layer (a glow, a mask, a sign, a flip) on top. Replace the picture
  completely only when the idea needs it.
- **Anticipate, hit, settle.** Dim or tighten before the word (about 15–20
  frames), hit on the word's `start` frame (a spring or a 4–6 frame ease, not a
  cut), then settle with a slow drift so the picture never freezes.
- **Make the reveal big enough to read on a phone**: shapes at least a sixth
  of the frame's short side, strokes 8 px or more.
- **Only what the narration shows.** Don't invent a new story fact in the
  picture. A twist that the plant lines set up should be visible in what you
  draw, not announced by text.
- **Keep it cheap to draw**: SVG shapes, a few layers, no huge filters or
  hundreds of elements per frame.
- A note from the editor wins over your taste.
