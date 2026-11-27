/**
 * Custom shots over HTTP (Phase 5, Part B), for the editor. Long work runs as queued jobs (src/queue.ts: one at a
 * time, progress over SSE, resumed after a restart); verdicts answer at once.
 *
 *   GET  /projects/:id/custom-shots                      {max, shots, suggestions, log}
 *   POST /projects/:id/custom-shots {scene, note?}       job "customshot" (op add): Claude writes the shot, code checks it
 *   POST /projects/:id/custom-shots/auto                 job "customshot" (op auto): the best moments with no shot yet
 *   POST /projects/:id/custom-shots/:shot/accept         keep it (also brings a reverted shot back)
 *   POST /projects/:id/custom-shots/:shot/reject {reason?}  revert to the library scene
 *   POST /projects/:id/custom-shots/:shot/regenerate {note}  job (op regenerate): a failed try never replaces a good shot
 *   POST /projects/:id/custom-shots/:shot/recheck        job (op recheck): the checks again
 *   Stills are served by GET /projects/:id/file/custom/stills/...
 */
import { liveShots, readLog, readShots, renderCodeHash, storyboardPaths } from "@studio/project";
import { LIVE_STATUSES, MAX_CUSTOM_SHOTS } from "@studio/schema";
import { existsSync } from "node:fs";
import { z } from "zod";
import { acceptShot, addShot, autoShots, recheckShot, regenerateShot, rejectShot, ShotError, suggest, type Candidate } from "./custom-shots";
import type { Job, Runner } from "./queue";
import { StoryError } from "./story";

const Args = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), scene: z.string(), note: z.string().optional() }),
  z.object({ op: z.literal("auto") }),
  z.object({ op: z.literal("regenerate"), shot: z.string(), note: z.string().min(1) }),
  z.object({ op: z.literal("recheck"), shot: z.string() }),
]);

export const shotRunners = {
  customshot: async (j, o) => {
    const a = Args.parse(j.args);
    o.report({ label: a.op === "recheck" ? "Checking the shot" : "Writing the custom shot", done: 0, total: 1 });
    if (a.op === "add") {
      const r = await addShot(j.project, { scene: a.scene, note: a.note, signal: o.signal });
      return { shot: r.shot.id, status: r.shot.status, reason: r.shot.reason, calls: r.calls, repaired: r.repaired };
    }
    if (a.op === "auto") {
      const rs = await autoShots(j.project, { signal: o.signal, onShot: (r, i, total) => o.report({ label: "Writing custom shots", done: i, total, detail: `${r.shot.id} on ${r.shot.sceneId}: ${r.shot.status}` }) });
      return { shots: rs.map((r) => ({ shot: r.shot.id, scene: r.shot.sceneId, status: r.shot.status, reason: r.shot.reason, calls: r.calls })) };
    }
    if (a.op === "regenerate") {
      const r = await regenerateShot(j.project, a.shot, a.note, { signal: o.signal });
      return { shot: r.shot.id, status: r.shot.status, kept: r.kept ?? false, problems: r.problems ?? [] };
    }
    const shot = await recheckShot(j.project, a.shot, { signal: o.signal });
    return { shot: shot.id, status: shot.status, reason: shot.reason };
  },
} satisfies Record<string, Runner>;

type Handler = (req: { body: <T extends z.ZodType>(schema: T) => Promise<z.output<T>>; url: URL }, m: string[]) => Promise<unknown> | unknown;
type Enqueue = (project: string, kind: Job["kind"], label: string, args?: Record<string, unknown>) => Job;

const refuse = (e: unknown): never => {
  if (e instanceof ShotError) throw Object.assign(new StoryError(e.message), { status: 409 });
  throw e;
};

export function shotRoutes(enqueue: Enqueue): [string, RegExp, Handler][] {
  return [
    [
      "GET",
      /^\/projects\/([\w-]+)\/custom-shots$/,
      (_r, [id]) => {
        const code = renderCodeHash();
        const shots = readShots(id!).shots.map((s) => ({ ...s, live: LIVE_STATUSES.includes(s.status), stale: s.check ? s.check.codeHash !== code : true }));
        let suggestions: Candidate[] = [];
        if (existsSync(storyboardPaths(id!).scenes)) {
          try {
            suggestions = suggest(id!);
          } catch {
            /* an unvoiced project has no timing to suggest from */
          }
        }
        return { max: MAX_CUSTOM_SHOTS, live: liveShots(id!).length, shots, suggestions, log: readLog(id!).slice(-40).reverse() };
      },
    ],
    [
      "POST",
      /^\/projects\/([\w-]+)\/custom-shots$/,
      async (r, [id]) => {
        const b = await r.body(z.strictObject({ scene: z.string(), note: z.string().optional() }));
        return { job: enqueue(id!, "customshot", `Custom shot for ${b.scene}`, { op: "add", ...b }) };
      },
    ],
    ["POST", /^\/projects\/([\w-]+)\/custom-shots\/auto$/, (_r, [id]) => ({ job: enqueue(id!, "customshot", "Custom shots for the best moments", { op: "auto" }) })],
    ["POST", /^\/projects\/([\w-]+)\/custom-shots\/(C\d+)\/accept$/, (_r, [id, shot]) => ({ shot: (() => { try { return acceptShot(id!, shot!); } catch (e) { return refuse(e); } })() })],
    [
      "POST",
      /^\/projects\/([\w-]+)\/custom-shots\/(C\d+)\/reject$/,
      async (r, [id, shot]) => {
        const b = await r.body(z.strictObject({ reason: z.string().optional() }));
        return { shot: rejectShot(id!, shot!, b.reason) };
      },
    ],
    [
      "POST",
      /^\/projects\/([\w-]+)\/custom-shots\/(C\d+)\/regenerate$/,
      async (r, [id, shot]) => {
        const b = await r.body(z.strictObject({ note: z.string().min(1) }));
        return { job: enqueue(id!, "customshot", `Regenerate ${shot}`, { op: "regenerate", shot, note: b.note }) };
      },
    ],
    ["POST", /^\/projects\/([\w-]+)\/custom-shots\/(C\d+)\/recheck$/, (_r, [id, shot]) => ({ job: enqueue(id!, "customshot", `Check ${shot}`, { op: "recheck", shot }) })],
  ];
}
