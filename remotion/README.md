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
  `voice.json`, never from the scene JSON (`src/scene/timeline.ts`).
- `StoryVideo` takes `captions={false}` for stills. The `Project` composition
  resolves its props per input props, so a caption-free still needs its own
  `selectComposition` call (`scripts/render-project.ts`).
- The app imports `src/gallery/Preview.tsx` for the Cast page's live preview, and
  plays the rendered MP4 in a `@remotion/player` on the Editor step.
