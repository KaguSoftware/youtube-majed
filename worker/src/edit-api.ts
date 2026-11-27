/**
 * The edit engine over HTTP (Phase 4), for the editor UI (Part B). Every
 * operation the CLI has (src/edit-cli.ts, src/versions-cli.ts). Long work runs
 * as queued jobs (src/queue.ts: one at a time, SSE progress, resumed after a
 * restart); quick reads and the dry-run check answer at once.
 *
 *   GET  /projects/:id/versions                       {head, versions}
 *   GET  /projects/:id/versions/:n                     one version (operations, changes, work)
 *   GET  /projects/:id/versions/diff?a=&b=             what differs between two versions
 *   POST /projects/:id/versions/:n/rollback {render?}  job "rollback"
 *   POST /projects/:id/edits {label?, ops, render?}    job "edit" (checked at once: 400/409 if impossible)
 *   POST /projects/:id/edits/check {ops}               dry run: lines to voice, track re-assembled, notes
 *   POST /projects/:id/edits/regenerate {scene, note, count?}            job "regenerate" → options
 *   GET  /projects/:id/edits/options/:oid                                saved options
 *   POST /projects/:id/edits/options/:oid/pick {n, render?}              job "edit"
 *   POST /projects/:id/edits/beat {beat, after|before, render?}          job "beat"
 *   POST /projects/:id/edits/fix {scenes: [{scene, note}], render?}      job "fixscenes"
 *   GET  /projects/:id/timeline                         scenes with frames and segment cache state, lines, cues
 *
 * `render`: "none" (default), "preview", "final" or "both": the job draws the
 * updated video after committing (only the segments that changed).
 */
import { customHashes, projectPaths, readJson, readVoice, renderCodeHash, storyboardPaths } from "@studio/project";
import { EXPORT_PROFILES, MixPlan, validateProject } from "@studio/schema";
import { planSegments } from "@studio/remotion/src/scene/segments";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { applyEdit, checkEdit, type EditResult } from "./edit";
import { beatEdit, fixScenesEdit, pickOption, readOptions, regenerateScene } from "./edit-claude";
import type { Job, JobProgress, Runner } from "./queue";
import { exportVideo, renderPreview } from "./render";
import { diffVersions, listVersions, readHead, readVersion, rollback } from "./versions";

export const RenderAfter = z.enum(["none", "preview", "final", "both"]).default("none");
type RenderAfter = z.infer<typeof RenderAfter>;

async function renderAfter(id: string, which: RenderAfter, o: { signal: AbortSignal; report: (p: JobProgress) => void }) {
  const out: Record<string, unknown> = {};
  if (which === "preview" || which === "both") out.preview = await renderPreview(id, o);
  if (which === "final" || which === "both") out.export = await exportVideo(id, o);
  return out;
}

const summary = (r: EditResult) => ({ version: r.version, notes: r.notes, voiced: r.voiced, generated: r.generated, assembled: r.assembled, mixCached: r.mixCached, timings: r.timings });

export const editRunners = {
  edit: async (j, o) => {
    const args = z.object({ request: z.unknown().optional(), pick: z.object({ options: z.string(), n: z.int() }).optional(), render: RenderAfter }).parse(j.args);
    const r = args.pick ? await pickOption(j.project, args.pick.options, args.pick.n, { signal: o.signal, report: o.report }) : await applyEdit(j.project, args.request, { signal: o.signal, report: o.report });
    return { ...summary(r), renders: await renderAfter(j.project, args.render, o) };
  },
  rollback: async (j, o) => {
    const args = z.object({ to: z.int(), render: RenderAfter }).parse(j.args);
    const v = rollback(j.project, args.to);
    return { version: v, renders: await renderAfter(j.project, args.render, o) };
  },
  regenerate: async (j, o) => {
    const args = z.object({ scene: z.string(), note: z.string(), count: z.int().optional() }).parse(j.args);
    o.progress({ step: "regenerate", phase: "start" });
    const r = await regenerateScene(j.project, args.scene, args.note, { signal: o.signal, ...(args.count ? { count: args.count } : {}) });
    o.progress({ step: "regenerate", phase: "done" });
    return r;
  },
  beat: async (j, o) => {
    const args = z.object({ beat: z.string(), after: z.string().optional(), before: z.string().optional(), render: RenderAfter }).parse(j.args);
    o.progress({ step: "beat", phase: "start" });
    const r = await beatEdit(j.project, args.beat, { after: args.after, before: args.before, signal: o.signal, report: o.report });
    o.progress({ step: "beat", phase: "done" });
    if ("ops" in r) return r;
    return { ...summary(r), renders: await renderAfter(j.project, args.render, o) };
  },
  fixscenes: async (j, o) => {
    const args = z.object({ scenes: z.array(z.object({ scene: z.string(), note: z.string() })), render: RenderAfter }).parse(j.args);
    o.progress({ step: "fixscenes", phase: "start" });
    const r = await fixScenesEdit(j.project, args.scenes, { signal: o.signal, report: o.report });
    o.progress({ step: "fixscenes", phase: "done" });
    return { ...summary(r), renders: await renderAfter(j.project, args.render, o) };
  },
} satisfies Record<string, Runner>;

/** Scene frames, segment cache state per profile, lines and sound cues: what a timeline view draws. */
export function timelineOf(id: string) {
  const sb = storyboardPaths(id);
  const read = (f: string) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : undefined);
  const check = validateProject({ scenes: read(sb.scenes), script: read(projectPaths(id).scriptJson), voice: read(projectPaths(id).voiceJson) });
  if (!check.ok) throw Object.assign(new Error(check.errors.slice(0, 5).join("; ")), { name: "ValidationError" });
  const code = renderCodeHash();
  const profiles = { preview: EXPORT_PROFILES.preview, final: EXPORT_PROFILES.youtube } as const;
  const plans = Object.fromEntries(
    Object.entries(profiles).map(([name, p]) => [name, planSegments(check.data, { code, custom: customHashes(id, new Set(check.data.scenes.scenes.map((s) => s.id))), profile: { width: p.width, height: p.height, crf: p.crf, preset: p.preset, jpegQuality: p.jpegQuality, pixelFormat: "yuv420p", codec: "h264" } })]),
  ) as Record<keyof typeof profiles, ReturnType<typeof planSegments>>;
  const cached = (name: string, key: string) => existsSync(join(projectPaths(id).dir, "renders", "segments", name, `${key}.mp4`));
  const voice = readVoice(id);
  const plan = readJson(sb.mixPlan, MixPlan);
  const tl = plans.preview.timeline;
  return {
    fps: tl.fps,
    frames: tl.total,
    head: readHead(id) ?? null,
    scenes: check.data.scenes.scenes.map((s, i) => ({
      id: s.id,
      lineIds: s.lineIds,
      start: tl.scenes[i]!.start,
      frames: tl.scenes[i]!.frames,
      bg: s.bg,
      chars: s.chars.map((c) => ({ id: c.id, action: c.action, expr: c.expr })),
      camera: s.camera,
      transitionIn: s.transitionIn,
      sfx: s.sfx,
      drawn: { preview: cached("preview", plans.preview.segments[i]!.key), final: cached("final", plans.final.segments[i]!.key) },
    })),
    lines: voice?.ok ? voice.data.lines.map((l) => ({ id: l.id, text: l.text, energy: l.energy, offset: l.offset, duration: l.duration, fx: l.fx?.effects ?? [], words: l.words.map((w) => ({ text: w.text, start: w.start, end: w.end })) })) : [],
    cues: plan?.cues.map((c) => ({ id: c.id, kind: c.kind, start: c.start, length: c.length, asset: c.asset, reason: c.reason })) ?? [],
  };
}

type Handler = (req: { body: <T extends z.ZodType>(schema: T) => Promise<z.output<T>>; url: URL }, m: string[]) => Promise<unknown> | unknown;
type Enqueue = (project: string, kind: Job["kind"], label: string, args?: Record<string, unknown>) => Job;

/** Routes for server.ts: [method, pattern, handler]. Quick checks happen before a job is queued, so a bad edit is refused at once. */
export function editRoutes(enqueue: Enqueue): [string, RegExp, Handler][] {
  return [
    ["GET", /^\/projects\/([\w-]+)\/versions$/, (_r, [id]) => ({ head: readHead(id!) ?? null, versions: listVersions(id!).map(({ files: _f, ...v }) => v) })],
    [
      "GET",
      /^\/projects\/([\w-]+)\/versions\/diff$/,
      (r, [id]) => {
        const a = Number(r.url.searchParams.get("a"));
        const b = Number(r.url.searchParams.get("b"));
        return { diff: diffVersions(id!, readVersion(id!, a), readVersion(id!, b)) };
      },
    ],
    ["GET", /^\/projects\/([\w-]+)\/versions\/(\d+)$/, (_r, [id, n]) => ({ version: readVersion(id!, Number(n)) })],
    [
      "POST",
      /^\/projects\/([\w-]+)\/versions\/(\d+)\/rollback$/,
      async (r, [id, n]) => {
        const { render } = await r.body(z.strictObject({ render: RenderAfter }));
        readVersion(id!, Number(n));
        return { job: enqueue(id!, "rollback", `roll ${id} back to version ${n}`, { to: Number(n), render }) };
      },
    ],
    [
      "POST",
      /^\/projects\/([\w-]+)\/edits\/check$/,
      async (r, [id]) => {
        const { ops } = await r.body(z.strictObject({ ops: z.array(z.unknown()).min(1) }));
        return checkEdit(id!, { ops });
      },
    ],
    [
      "POST",
      /^\/projects\/([\w-]+)\/edits$/,
      async (r, [id]) => {
        const { label, ops, render } = await r.body(z.strictObject({ label: z.string().optional(), ops: z.array(z.unknown()).min(1), render: RenderAfter }));
        const request = { ...(label ? { label } : {}), ops };
        checkEdit(id!, request); // refuses an impossible edit now, not later in the queue
        return { job: enqueue(id!, "edit", label ?? `edit ${id}`, { request, render }) };
      },
    ],
    [
      "POST",
      /^\/projects\/([\w-]+)\/edits\/regenerate$/,
      async (r, [id]) => {
        const b = await r.body(z.strictObject({ scene: z.string().regex(/^S\d+$/), note: z.string().max(500).default(""), count: z.int().min(2).max(3).optional() }));
        return { job: enqueue(id!, "regenerate", `options for ${b.scene} of ${id}`, b) };
      },
    ],
    [
      "GET",
      /^\/projects\/([\w-]+)\/edits\/options\/([\w-]+)$/,
      (_r, [id, oid]) => {
        const o = readOptions(id!, oid!);
        if (!o) throw Object.assign(new Error(`no options ${oid}`), { status: 404 });
        return { options: o };
      },
    ],
    [
      "POST",
      /^\/projects\/([\w-]+)\/edits\/options\/([\w-]+)\/pick$/,
      async (r, [id, oid]) => {
        const { n, render } = await r.body(z.strictObject({ n: z.int().min(1), render: RenderAfter }));
        const o = readOptions(id!, oid!);
        if (!o?.options[n - 1]) throw Object.assign(new Error(`no option ${n} in ${oid}`), { status: 404 });
        return { job: enqueue(id!, "edit", `${o.sceneId}: option ${n}`, { pick: { options: oid, n }, render }) };
      },
    ],
    [
      "POST",
      /^\/projects\/([\w-]+)\/edits\/beat$/,
      async (r, [id]) => {
        const b = await r.body(z.strictObject({ beat: z.string().trim().min(3).max(300), after: z.string().optional(), before: z.string().optional(), render: RenderAfter }).refine((x) => x.after || x.before, "say where: after or before a line or scene"));
        return { job: enqueue(id!, "beat", `beat in ${id}: ${b.beat}`.slice(0, 80), b) };
      },
    ],
    [
      "POST",
      /^\/projects\/([\w-]+)\/edits\/fix$/,
      async (r, [id]) => {
        const b = await r.body(z.strictObject({ scenes: z.array(z.strictObject({ scene: z.string().regex(/^S\d+$/), note: z.string().max(500) })).min(1).max(12), render: RenderAfter }));
        return { job: enqueue(id!, "fixscenes", `fix ${b.scenes.map((s) => s.scene).join(", ")} of ${id}`, b) };
      },
    ],
    ["GET", /^\/projects\/([\w-]+)\/timeline$/, (_r, [id]) => timelineOf(id!)],
  ];
}
