# app/

The local Studio website (Next.js 16, React 19, Tailwind 4). Phase 2 builds
only what the story engine needs:

| Route | |
| --- | --- |
| `/` | Stories, newest first, with their state |
| `/new` | Brief: sentence, narrative, format, length, true or fiction, direction |
| `/p/[id]` | Three master loop options to pick from, then the story: tension graph, loop map, review scores |
| `/p/[id]/script` | The script editor |

The routes are the steps of `docs/PLAN.md` section 2, so the Phase 3
stepper can wrap them without moving anything.

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

Design context is in `PRODUCT.md`; the tokens in `app/globals.css` and the
control vocabulary in `components/ui.ts` come from `legacy/web/`.
