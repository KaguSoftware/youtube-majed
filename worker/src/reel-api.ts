/**
 * The Reel cut and the Reel export over HTTP (Phase 4, Part C), for the Export page. Long work runs as queued
 * jobs (src/queue.ts: one at a time, progress over SSE, resumed after a restart).
 *
 *   GET  /projects/:id/reel               {format, links: {cutFrom, reels}, reel, stale}   the Reel export, and the cuts made from this video
 *   POST /projects/:id/reel/export        job "reelexport": the 9:16 file, its .srt and reel.json
 *   POST /projects/:id/reel/cut           job "reelcut": Claude picks the strongest loop; creates the child project <id>-reel
 *   POST /projects/:id/reveal {file}      shows a file of renders/ in the Finder (this Mac only)
 */
import { projectPaths, reveal as showFile } from "@studio/project";
import { existsSync, statSync } from "node:fs";
import { dirname, normalize, resolve, sep } from "node:path";
import { z } from "zod";
import type { Job, Runner } from "./queue";
import { cutReel, readReelCut, reelLinks } from "./reel-cut";
import { exportReel, reelStatus } from "./reel-export";
import { readScenes } from "./storyboard";
import { readNarration, readBrief, StoryError } from "./story";
import { readVoice } from "@studio/project";

export const reelRunners = {
  reelcut: async (j, o) => {
    const r = await cutReel(j.project, { signal: o.signal, report: o.report });
    return { child: r.child, loopId: r.cut.loopId, why: r.cut.why, keptLines: r.keptLines, takesCloned: r.takesCloned, newLines: r.newLines, voiced: r.voiced, seconds: r.seconds };
  },
  reelexport: (j, o) => exportReel(j.project, { signal: o.signal, report: o.report }),
} satisfies Record<string, Runner>;

type Handler = (req: { body: <T extends z.ZodType>(schema: T) => Promise<z.output<T>>; url: URL }, m: string[]) => Promise<unknown> | unknown;
type Enqueue = (project: string, kind: Job["kind"], label: string, args?: Record<string, unknown>) => Job;

function needsScenes(id: string): void {
  readBrief(id);
  if (!readVoice(id)) throw new StoryError("voice the script first");
  if (!readScenes(id)) throw new StoryError("plan the storyboard first");
}

/** Opens Finder or Explorer with the file selected. Only files under the project's renders/ folder. */
function reveal(id: string, rel: string): void {
  const root = resolve(projectPaths(id).dir, "renders");
  const file = resolve(projectPaths(id).dir, normalize(rel));
  if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) throw Object.assign(new Error(`no file ${rel} under renders/`), { status: 404 });
  showFile(file);
}

export function reelRoutes(enqueue: Enqueue): [string, RegExp, Handler][] {
  return [
    [
      "GET",
      /^\/projects\/([\w-]+)\/reel$/,
      async (_r, [id]) => {
        const brief = readBrief(id!);
        const { record, stale } = await reelStatus(id!);
        return { format: brief.format, links: reelLinks(id!), reel: record, stale };
      },
    ],
    [
      "POST",
      /^\/projects\/([\w-]+)\/reel\/export$/,
      (_r, [id]) => {
        needsScenes(id!);
        return { job: enqueue(id!, "reelexport", `Reel export of ${id}`) };
      },
    ],
    [
      "POST",
      /^\/projects\/([\w-]+)\/reel\/cut$/,
      (_r, [id]) => {
        needsScenes(id!);
        if (readBrief(id!).format === "reel") throw new StoryError(`${id} is already a Reel; a Reel cut is made from a long video`);
        if (readReelCut(id!)) throw new StoryError(`${id} is itself a Reel cut`);
        if (!readNarration(id!)?.lockedAt) throw new StoryError("lock the script first");
        return { job: enqueue(id!, "reelcut", `Reel cut of ${id}`) };
      },
    ],
    [
      "POST",
      /^\/projects\/([\w-]+)\/reveal$/,
      async (r, [id]) => {
        const { file } = await r.body(z.strictObject({ file: z.string().min(1) }));
        reveal(id!, file);
        return { ok: true, folder: dirname(file) };
      },
    ],
  ];
}
