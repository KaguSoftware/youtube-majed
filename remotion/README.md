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
