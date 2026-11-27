# app/

The local Studio website (Next.js 16, React 19, Tailwind 4). A stepper over the
nine steps of `docs/PLAN.md` section 2; each step is a page.

| # | Step | Route | |
| --- | --- | --- | --- |
| | Stories | `/` | Every story with its current step and that step's state |
| | New | `/new` | Writes the brief |
| 1 | Brief | `/p/[id]/brief` | The brief, read back |
| 2 | Story | `/p/[id]` | Three master loop options, then the story: tension graph, loop map |
| 3 | Review | `/p/[id]/review` | Fact-check and critic scores by round |
| 4 | Script | `/p/[id]/script` | The script editor; lock |
| 5 | Voice | `/p/[id]/voice` | Voice the script, listen per line, retake |
| 6 | Storyboard | `/p/[id]/storyboard` | Claude plans the scenes; what code repaired; the variety report against the last videos and what the run did about it |
| 7 | Render | `/p/[id]/render` | Sound mix, then the 720p preview |
| 8 | Editor | `/p/[id]/editor` | The video editor: live draft, timeline, every fix as a version, Update video |
| 9 | Export | `/p/[id]/export` | Two files from one project: YouTube 16:9 and Reel 9:16, each with progress, size, download and show in Finder; subtitles, chapters and thumbnail frames for YouTube; cut a Reel from a long video; the variety verdict to read before uploading |
| | Cast | `/p/[id]/cast` | Every character's look, previewed by the real animation library |

The routes of steps 2 and 4 are the Phase 2 ones: the stepper wraps them
(`app/p/[id]/layout.tsx`), nothing moved.

## The stepper

`components/stepper.tsx` (after `legacy/web/components/stage-strip.tsx`, which
had seven stages). A step is **waiting** (something before it is not done),
**running** (a job is queued or running), **needs you** (ready, and the next
move is yours) or **done**; a done step whose input changed since is also
**out of date**. Every state has a glyph and a word, so colour is never the
only signal. Any step can be opened; out-of-date output is kept, flagged, and
the steps after it reuse what is still valid.

The states are computed by the worker from the files on disk and the job queue
(`worker/src/pipeline.ts`, `GET /projects/:id/pipeline`), so they cannot
disagree with the files. The stepper reloads when a job starts or ends, after
any write the app makes (`studio:changed`), on route change and on focus.

## Run

```bash
pnpm worker   # terminal 1: the job worker on 127.0.0.1:8766
pnpm app      # terminal 2: http://localhost:3100
```

The app never runs Claude itself, and it has no server code: every page loads
in the browser and calls the worker on this computer directly
(`lib/worker-url.ts`, `http://127.0.0.1:8766`), including Server-Sent Events
and media with byte ranges. That is what lets the same pages run from Vercel
(`https://youtube-majed.vercel.app`) against the helper on whichever computer
opens them (`scripts/helper.sh`, `docs/PLAN.md` section 10). While the worker
is down a page says how to start it and opens by itself once it answers
(`components/with-project.tsx`). Everything the worker returns is checked with
zod (`lib/api.ts`).

## Script editor

- Edit a line's text in place, its energy (five pips) and its delivery note.
  Edits save on their own.
- Focus a line to edit its beats (stakes, question, plant, turn, head fake,
  rehook) and its plant ids; the loop checker reads them.
- Click a line id to select it, shift-click for a range. The toolbar then
  offers the tone presets (hype, hushed, dread, deadpan, awe, comic, each an
  energy and a delivery note), lock/unlock lines, and **rewrite with
  direction**: Claude rewrites only those lines, keeps their ids, and the
  result arrives as a suggestion.
- Reviewer findings and rewrites are pinned under their lines as diffs.
  Accept or reject in one click; an accepted fact fix keeps its sources on
  the line. Confirmed facts show "fact checked" with their sources.
- The rail re-runs the loop checker and the tension graph on every edit (the
  same code as `pnpm story check`), shows the word budget per loop, the
  review scores round by round, and the lock.
- Lock writes `projects/<id>/script.json` for `pnpm voice <id>`. Locked lines
  are never rewritten. Alt + ↑/↓ moves between lines.

## Variety panel (steps 6 and 9)

`components/variety-panel.tsx`, from `GET /projects/:id/variety`. A verdict as a
glyph and a word (Distinct, Similar, Too similar, First video) with the 0 to 100
score, a gauge that names the three zones and their thresholds, one bar per part
of the look (a glyph and a word on each; the caption style reads "series style",
never flagged), what this video leans on, and the specific repeats. On the
Storyboard step it also says what the run did: the lists Claude was asked to
avoid, the score from the previous storyboard to Claude's draft to the final, and
the swaps code made. On Export it is the short version (three repeats, the
dimensions folded away) to read before uploading.

## Video editor (step 8)

docs/PLAN.md section 8, on the edit engine (`worker/README.md`, "Edit engine").
It works on the project data, never on the MP4.

- **The Player draws the live composition**: `StoryVideo` from
  `@studio/remotion` with the project as it is now (scenes, script and
  voice.json, validated with the same `validateProject` the render runs) and
  the current mix underneath. A swap previews before anything is committed or
  drawn. "Last render" plays the preview MP4 on the same frame clock. A Reel
  project (format `reel`) draws in the 9:16 frame (`PORTRAIT`). Fredoka for
  the captions comes from `public/fonts/` (the render entries load it with
  `staticFile`, which only works in a Remotion bundle).
- **The timeline**: scenes, voice lines (and their words from 64 px/s), sound
  effects (yours, on words, editable; the mix rules' risers, hits and whooshes
  shown faint) and music with ambience, on one playhead that follows the
  Player without re-rendering the tracks. Hatched scenes need drawing.
- **The inspector** (no modals): a scene's library-only dropdowns (preview
  live; Apply commits one `scene.set`), Ask Claude for 2–3 versions (preview
  each, use one), arrange (trim by lines, move within the loop, delete with
  or without its lines), flag. A line's text, energy and delivery (only that
  line is voiced again), another take, a voice effect on the line or one word,
  sound effects on a word (searchable from the asset index, with a preview of
  the file the mix uses), cut. A placed effect: hear it, move it to the word
  under the playhead, remove it.
- **Shots** (a tab beside Edit, Flags and Versions): custom shots, up to three. Suggested moments (the ending twist, head
  fakes) with a note field and a write button; each shot with its status as a glyph and a word, the words it reacts to,
  the stills its check drew alone in 16:9 and 9:16 (a frame picker and a 16:9 / 9:16 switch, no modal), why a failed shot
  fell back to the library scene, and keep / use the library scene / regenerate with a note / check again; the fallback
  log. The player still draws the library scene; Update video draws the shots.
- **Flags** collect misgenerated scenes with a note (kept in this browser) and
  send them to Claude in one `fixscenes` call. **Versions**: the history, any
  two compared, roll back to any one (a new version; nothing voiced or drawn).
- **Update video** draws only the segments that changed (the preview, and the
  1080p export if ticked), with an estimate from this project's last render.
  The message after each change says how long it took from the click.
- **Keyboard**: Space play/pause, ←/→ a frame (⇧ a second), ↑/↓ previous/next
  scene, inside a track ←/→ between its items, ⌫ delete (asks first for a
  scene), F flag, B beat at the playhead, ⌘Z roll back one version, −/+ zoom,
  Esc closes a preview or the beat.

The stepper needs nothing new: an edit changes the scenes, voice or sound, so
Render and Export show out of date until Update video draws them again.

The Cast page and the Remotion Player import the animation library from
`@studio/remotion` (transpiled by Next), so a look is drawn by the same code
that renders the video. Media (the preview, takes, the export and its
thumbnails) is served by the worker with byte ranges, through the same
`/api/worker/*` proxy.

Design context is in `PRODUCT.md`; the tokens in `app/globals.css` and the
control vocabulary in `components/ui.ts` come from `legacy/web/`.
