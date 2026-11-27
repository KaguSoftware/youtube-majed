# remotion/

The animation library and the renderer (Remotion 4, free licence for
individuals). Claude writes scene JSON; this turns it into video. See
`docs/PLAN.md` sections 6 and 9.

```bash
pnpm studio                              # Remotion Studio: samples, library galleries (Actions, Props, Grades, Cast, Backgrounds)
pnpm validate                            # validate the sample scene files
pnpm render                              # the lighthouse sample, 1080p
pnpm render:preview                      # the lighthouse sample, 720p
pnpm render:project <id> [--profile preview|final] [--concurrency N] [--frames 0-299] [--json]
                         [--stills 120,900 --stills-dir <dir> [--no-video]]
```

`render:project` renders a storyboarded project from `projects/<id>/`
(`storyboard/scenes.json`, `script.json`, `audio/voice.json`, the mix from
`pnpm mix`). It uses Remotion's Node API (bundle, `selectComposition`,
`renderMedia`) so progress and timings are real numbers; with `--json` stdout
carries only JSON lines, which is how the worker's render and export jobs
read it. Profiles are defined once in `packages/schema/src/export.ts`:
`final` is the YouTube profile (1920×1080, 30 fps, H.264 High, CRF 20, preset
slow, AAC 320 kbps), `preview` the quick one (1280×720, CRF 26, veryfast).
`--stills` renders JPEG frames without captions, for thumbnails.

The library catalogue (`packages/schema/src/catalogue.ts`) is the only list of
ids scene JSON may use; TypeScript enforces that `src/library/` implements
each one. Adding an item means adding it there and implementing it here.

## Partial re-render (Phase 4)

```bash
pnpm render:segments <id> [--profile preview|final|lossless] [--out file.mp4] [--frames a-b] [--plan] [--json]
pnpm compare-renders <id> [--profile preview|final|lossless] [--frames a-b] [--baseline]
```

The video is drawn in **segments, one per scene**, each a frame range of the
full `Project` composition, cached in
`projects/<id>/renders/segments/<profile>/<key>.mp4`. The key
(`src/scene/segments.ts`) hashes everything that can put a pixel in that
range: every Sequence overlapping it (the scene, and the previous one while
its tail runs under this scene's transition), each with its whole scene
object (the id seeds idle motion), the cast looks it uses, its length and the
next transition (outros: dip, iris, wipe push); the caption chunks and
overlays overlapping it; all positions relative to the segment's first frame.
Plus a hash of the render code (`remotion/src`, the entry, fonts, the schema,
the Remotion version) and the encode profile. Sound effects are not drawn,
so they are not in it.

Every animation reads Sequence-relative frames and captions and overlays
read `frame - start`, so a scene that only moved by whole frames has the same
key. Frame-aligned tracks make that the normal case after an edit
(audio/README.md, "Track assembly").

Missing segments are drawn through one browser; consecutive missing ones in
one `renderMedia` call with an IDR keyframe forced on each segment start
(`-force_key_frames`, `-forced-idr`), then cut apart without re-encoding
(each call costs ~0.8 s of tab start-up, measured). The segments are joined
with the concat demuxer (stream copy) and the mix is muxed in once. The
encoded soundtrack is cached by mix plan, bitrate and frame range, and is
encoded while the segments are drawn. Both use Remotion's own ffmpeg, so the
AAC is the same encoder as a full render's (`-cutoff 18000`, as Remotion).

Measured on elevator-13 (6:15, 99 scenes, 11,277 frames), from cold: preview
96 s (a full one-call render: 105 s), 1080p final 143 s (full: 165 s), 69.0 MB.
After an edit, a swap redraws 1 segment, a line edit 2 (the scene and the one
before it, whose end moved), with everything after moved and reused.

**The proof** (`scripts/compare-renders.ts`): the stitched file against the
whole composition drawn in one call with the same encode, per-frame PSNR and
SSIM, the frames around every segment boundary on their own, the two
soundtracks against each other, and every line's take against each file's
audio (`audio/scripts/verify_track.py`). `--profile lossless` (x264 qp 0)
takes the encoder out: frames must be identical. `--baseline` renders a second
full render, because Chrome's rasteriser is not bit-exact from run to run on a
few frames. Results on an edited elevator-13 (version 16, after six edits;
most segments drawn before the edits): lossless 11,220 of 11,251 frames
identical, all 490 boundary frames identical, the rest at ≥ 80.0 dB, the
same as two full renders against each other (23 frames, ≥ 80.0 dB); preview
PSNR min 40.5 dB, median 45.6, SSIM min 0.981; final PSNR min 46.3 dB, median
52.1, SSIM min 0.992 (encoder noise: segments start on their own keyframes);
sound lag 0 ms, every line's take at ≤ 0.021 ms in both files.

## Vertical, 9:16 (Phase 4)

```bash
pnpm render:segments <id> --profile reel      # 1080×1920, CRF 21, captions burned in (the "ProjectVertical" composition)
pnpm render:project <id> --profile reel
tsx scripts/stills.ts SceneryVertical --per-scene --scale 0.3 --out <dir> --sheet sheet.jpg --cols 12   # contact sheets
```

The same project data renders into a 16:9 frame (`Project`) or a 9:16 frame
(`ProjectVertical`, `src/scene/view.ts`); there is no second scene file. A
tall frame is a **re-layout, not a crop** (`src/scene/portrait.ts`):

- **Spacing.** Characters, and the props that stand at a position, are pulled
  toward the middle of the stage (never closer than 280 px, a crowd as far as
  it takes to fit), so a duo written 900 px apart shares the frame. Order and
  facing are kept; a prop's own width (a bed, a car, a desk) counts.
- **Framing.** The zoom fits the group: a lone character fills the frame, a
  duo shares it, a crowd gets a wider shot. Medium shots are favoured (a
  scene written wide is framed at its tallest comfortable size; `medium` is
  waist-up, large). The fit leaves room for the camera move's own zoom, so a
  push or a pan does not crop the group. Scenes with an overlay at the top
  frame the figures lower and smaller (`OVERLAY_HEADROOM`).
- **Camera.** The scene rests in its base view; the move *away* from it is what
  depth weights (`layerTransform`), so a background's horizon and parallax
  layers stay aligned at rest. A group that travels is followed.
- **Text.** Captions and overlays sit inside `SAFE_PORTRAIT` (top 250, bottom
  480, left 90, right 150 px of 1080×1920: the Shorts and Instagram interfaces
  cover the top, the right-hand buttons and the post's own caption). Captions
  are cut into shorter chunks (`CHUNK_PORTRAIT`) and wrap to two lines.
- **Backgrounds** are drawn once, in the 1920×1080 world plus its bleed, and
  framed from there; no background needed a second drawing. A window can show
  at most the bleed (260 px), so the zoom never goes below 1.2.

The `Library-9x16` folder in Studio holds the galleries (Scenery: every
background by day and night, Layouts, Cameras, Text: captions and overlays,
Transitions, Weather, Travel, Neon) with the safe zone drawn over each frame
(`SafeGuides`), and `Samples-9x16` the samples. Segments of the 9:16 render are
cached under `renders/segments/reel/`, beside the 16:9 ones.

## Custom shots (Phase 5, Part B)

```bash
tsx scripts/check-shot.ts <project> --scene S93 --source shot.tsx --stills-sub S93/test   # normally run by the worker (pnpm shots)
```

A scene may be drawn by a one-off component instead of its library scene (docs/PLAN.md section 6; the worker side, the
checks and the manifest are in `worker/README.md`). Nothing about it is in the scene JSON.

- **Kit** (`src/custom/kit.ts`): the only library module a shot imports, besides `remotion` and `react`: the theme, easing,
  `useView`, `LibraryScene` (a library scene inside the shot), `Backdrop`, `Actor`, `useShot`, `wordFrame`.
- **Props** (`ShotProps`): the library scene it stands in for, the cast, the scene's frames, and every word and line
  with frames relative to the scene's first frame, so a shot lands on a word. `useCurrentFrame()` is that same clock.
- **In a video**: `StoryVideo` takes `customShots` (scene id → component) and draws it where `SceneView` would be, inside
  the same transition and caption layers. `scripts/project-entry.tsx` reads `public/projects/<id>/custom.json` and looks
  the components up in `src/custom/registry.ts` (webpack `require.context` over `src/custom/.staged/`, which a render
  fills with exactly the project's live shots; gitignored, and invisible to the render code hash and the typecheck).
- **Segments**: a scene with a shot is keyed by the hash of its source plus what it is given (frames, word and line
  frames, the library scene, cast looks), so only that segment (and the next while its tail runs under a transition)
  is drawn again when a shot is added, changed, reverted or falls back.
- **Not in the editor's player**: the Player draws the library scene; the stills (`projects/<id>/custom/stills/`) and the
  next render show the shot.

## Concurrency (measured on the M3 Pro, 36 GB, 6 performance + 6 efficiency cores)

300 frames of elevator-13 (frames 4500 to 4799) at the 1080p profile:

| `--concurrency` | frames/s | peak Remotion RSS |
| --- | --- | --- |
| 4 | 40.4 | 3.0 GB |
| 6 | 43.8 | 3.9 GB |
| **8** | **44.4** | 4.3 GB |
| 10 | 42.1 | 4.6 GB |
| 12 | 42.8 | 5.3 GB |

The scenes are flat vector art, so a frame is cheap and the gain flattens at
about 6 parallel frames; the five settings sit within 10% of each other. 8 is
the default (`STUDIO_RENDER_CONCURRENCY` or `--concurrency` overrides): fastest,
and four cores stay free for the rest of the Mac. More does not help.

Measured whole-video runs (elevator-13, 6:15, 11,255 frames), see the Gate 3
report for the full table: the 720p preview renders in about 105 s (110
frames/s, the draw is faster than the encode), the 1080p export in about
165 s (70 frames/s, x264 `slow` is the limit once the frames are cheap).

## Notes

- Voiced scenes start 6 frames before their first word; timing comes from
  `voice.json`, never from the scene JSON (`src/scene/timeline.ts`). On a
  frame-aligned track (`pauses.frameRate`), a word's frame is its line's frame
  plus its own offset in the line, each rounded on its own.
- Transition lengths live in `src/scene/transitions.ts` (React-free, read by the segment planner).
- `StoryVideo` takes `captions={false}` for stills. The `Project` composition
  resolves its props per input props, so a caption-free still needs its own
  `selectComposition` call (`scripts/render-project.ts`).
- The app imports `src/gallery/Preview.tsx` for the Cast page's live preview, and
  plays the rendered MP4 in a `@remotion/player` on the Editor step.

## Low poly (Phase 5)

```bash
pnpm render --style low_poly                                   # the lighthouse sample in 3D, 1080p
pnpm render:segments <id> --style low_poly [--profile reel]     # any project in 3D, segment-cached
pnpm render:project <id> --style low_poly | compare-renders <id> --style low_poly
pnpm assets3d check | convert                                   # 3D sources (Mixamo clips) and their licences
```

**One scene format, two art styles.** A scene file may say `"artStyle": "low_poly"` (default `stick`), and
a scene may override it (`packages/schema/src/style.ts`). `--style` overrides the whole project at render
time without touching its files. A low-poly scene that uses an action, background, prop or weather with no
3D version yet (catalogue `LOW_POLY`) is drawn as stick instead, and the scripts report it
(`low poly: 18 of 18 scenes in 3D`, a `style` JSON event for the worker). A render never fails for a
missing 3D item. Expressions, cameras, transitions, grades, captions, overlays, framings, both frames and
every cast look work in 3D.

**How it is drawn** (`src/three/`, `@remotion/three`, Three.js 0.187):

- *Staging and camera are the stick style's.* `SceneView3D` calls the same `placeAll` (positions, travel
  matched to the legs, seats, beds, cars, the 9:16 re-layout) and the same camera moves; `camera3d.tsx`
  turns a 2D zoom-around-a-point into a real camera that shows exactly what the 2D frame shows at the
  stage. A push or pan therefore has true parallax, and a scene keeps its staging between styles.
- *Figures* (`Figure3D.tsx`, `rig3d.ts`) are faceted shapes on a skeleton with Mixamo's bone names. The
  motion is the stick action's keyframes: each 2D joint angle becomes a rotation in the figure's
  sagittal plane, so timing, loops and travel are unchanged. `actions3d.ts` adds what a side view cannot
  say (hands meeting in front of the face, folded arms, arms out, how far the figure turns to the
  camera), and back-arm elbows that bend "backward" in 2D become a forward bend turned inward. Faces are
  the 2D face sprites, beards and face features painted onto a canvas texture (`face.ts`), so all 17
  expressions carry over. Cast looks (`looks3d.tsx`): accent → shirt and hat bands, line → trousers and
  shoes, fill → skin; all 12 hats, 8 hair styles, the full beard and 5 outfits as shapes; builds and
  height from the same body maths; neon glows; silhouettes are black.
- *Ink lines.* As in 2D, characters and props have an ink outline and sets do not (`Ink` in `kit.tsx`, a
  back-face hull of constant width), which keeps figures readable on any set.
- *Sets* (`sets/`): office, city, house_interior, lighthouse_exterior, lighthouse_stairs, street,
  hospital, built from cached flat-shaded primitives. *Props* (`props3d/`): 24, held and placed, with
  the 2D seat and surface heights. *Light* (`lighting.tsx`): a sun or moon with shadows, a sky/ground
  fill and fog per time of day, grade-specific light (memory, horror, noir, neon), practical lamps,
  windows, screens, fire and lanterns that are real lights at dusk and night, and a soft camera-side
  fill. The grade's wash, vignette and filter still go on top (`GradeOverlay`).

**Rendering.** Remotion recommends the `angle` GL backend for Three.js on a desktop; the scripts pass it
as soon as one scene is drawn in 3D (stick-only projects keep Chrome's default). Measured on the M3 Pro,
900 frames of elevator-13-reel at the 1080p profile:

| style | concurrency | frames/s |
| --- | --- | --- |
| stick | 8 | 51.5 |
| low poly | 3 | 38.1 |
| low poly | 4 | 45.1 |
| **low poly** | **5** | **47.4** |
| low poly | 6 | 45.8 |

5 is the default for projects with 3D scenes (`defaultConcurrency` in `scripts/art-style.ts`): the GPU
is shared by every tab, and x264 `slow` is the limit for both styles. Whole videos: the lighthouse
sample (55 s, 1080p) renders in 34 s in low poly (15.6 MB) against 33 s in stick (12.0 MB);
elevator-13-reel (9:16, 1,936 frames) in 37.5 s (11.3 MB) against 30.1 s (9.3 MB).

**Segments.** A segment's key holds the style each of its scenes is drawn in, so the two styles never
share a cached file, and partial re-render works as in 2D: on elevator-13-reel in low poly, a second run
reuses all 18 segments (0.3 s), and swapping one scene's camera redraws only that segment.
`compare-renders --style low_poly` (preview): PSNR min 40.5 dB, median 45.6, SSIM min 0.984 (the same
encoder floor as stick), sound lag 0 ms.

**Galleries.** Studio folders `Library-3D` and `Library-3D-9x16`: Sets3D (every set by day, dusk and
night), Actions3D, Cast3D (hats, hair, beards, builds, outfits, face features, neon, silhouette),
Cameras3D, Props3D. `tsx scripts/stills.ts Sets3D --per-scene --sheet sheet.jpg` makes contact sheets.

### Mixamo (optional): mocap clips on the same skeleton

The plan named Mixamo clips. The figures are built so that Mixamo clips can drive them: bone names and
hierarchy follow Mixamo's, and `pnpm assets3d convert` turns the FBX files into GLB clips and indexes
them with their licence. What is not built yet is the retargeting that plays a GLB clip on `rig3d.ts`
instead of the keyframes; it needs real clips to tune against. The licence: royalty-free in videos, but
the raw files may not be redistributed. So they live in `assets/3d/` (gitignored), with an entry each in
`assets/sources-3d.json`.

Download from mixamo.com (Adobe login). For every clip use the default character **Y Bot**, then
Download with: Format **FBX Binary (.fbx)**, Skin **Without Skin**, Frames per Second **30**, Keyframe
Reduction **none**, and tick **In Place** where the list says so (the code moves the figure). Save each
as `assets/3d/mixamo/fbx/<action>.fbx`, then run `pnpm assets3d convert`.

The 20 most used actions in the storyboards so far (count in brackets), with the Mixamo search term to use:

| file | search Mixamo for | in place |
| --- | --- | --- |
| idle.fbx (43) | Breathing Idle | |
| walk.fbx (14) | Walking | yes |
| think.fbx (14) | Thinking | |
| sleep.fbx (11) | Sleeping (lying down, looping) | |
| peek.fbx (11) | Peeking / Look Around Corner | |
| sit_chair.fbx (8) | Sitting Idle | |
| gasp.fbx (8) | Surprised | |
| sigh.fbx (7) | Defeated / Sigh | |
| shrug.fbx (7) | Shrugging | |
| nod.fbx (7) | Head Nod Yes | |
| look_around.fbx (7) | Looking Around | |
| point.fbx (6) | Pointing | |
| cross_arms.fbx (6) | Standing Arms Crossed | |
| push.fbx (5) | Pushing | yes |
| drive.fbx (4) | Driving (sitting) | |
| tremble.fbx (3) | Terrified / Scared | |
| throw.fbx (3) | Throw (one hand) | |
| scratch_head.fbx (3) | Head Scratch / Thinking | |
| pull.fbx (3) | Pulling (rope) | yes |
| listen.fbx (3) | Listening / Hand To Ear | |

Mixamo's titles change, so treat the middle column as search terms, and pick the result that loops
cleanly and matches the action's description in `packages/schema/src/catalogue.ts`.
