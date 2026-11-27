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
| 6 | Storyboard | `/p/[id]/storyboard` | Claude plans the scenes; what code repaired |
| 7 | Render | `/p/[id]/render` | Sound mix, then the 720p preview |
| 8 | Editor | `/p/[id]/editor` | Phase 4. The render plays in a Remotion Player meanwhile |
| 9 | Export | `/p/[id]/export` | The YouTube file, subtitles, chapters, thumbnail frames |
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

The app never runs Claude itself. Server components read from the worker,
and the browser talks to it through `/api/worker/*` (a same-origin proxy
that streams Server-Sent Events). Everything the worker returns is checked
with zod (`lib/api.ts`).

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

The Cast page and the Remotion Player import the animation library from
`@studio/remotion` (transpiled by Next), so a look is drawn by the same code
that renders the video. Media (the preview, takes, the export and its
thumbnails) is served by the worker with byte ranges, through the same
`/api/worker/*` proxy.

Design context is in `PRODUCT.md`; the tokens in `app/globals.css` and the
control vocabulary in `components/ui.ts` come from `legacy/web/`.
