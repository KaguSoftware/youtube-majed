/**
 * The worker as a local HTTP service for the app (127.0.0.1 only).
 *
 *   pnpm worker          # http://127.0.0.1:8766
 *
 * Claude steps run as jobs from a queue kept in SQLite (src/queue.ts): one at
 * a time, in order, under the same lock as the `pnpm story` CLI, and resumed
 * after a restart. Progress streams
 * over Server-Sent Events at GET /events. Quick edits (save the script,
 * accept a comment, lock) answer at once. Every request body is checked with
 * zod.
 */
import { projectPaths, projectsDir, readJson, readVoice, storyPaths, storyboardPaths, writeJson } from "@studio/project";
import { CastId, CastMember, FactCheckOutput, Format, MixResult, NarrativeId, SceneFile, budgetOf } from "@studio/schema";
import { pathToFileURL } from "node:url";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { z } from "zod";
import { JobQueue, type JobKind, type Runner } from "./queue";
import { check, decide, fix, lock, readHistory, review, rewrite, saveNarration, unlock } from "./review";
import { StoryError, createProject, generateOptions, listProjects, pickOption, readBrief, readComments, readLoopMap, readNarration, readOptions, readPick, readSteps, writeStory } from "./story";
import { byStep, readUsage, totals } from "./usage";
import { readScenes, readStoryboard, storyboard } from "./storyboard";
import { runMixAsync } from "./mix";
import { pipelineOf } from "./pipeline";
import { exportVideo, readExportRecord, readPreviewRecord, renderPaths, renderPreview } from "./render";
import { voiceProject } from "./voice-run";

const PORT = Number(process.env.STUDIO_WORKER_PORT ?? 8766);

// ---------------------------------------------------------------- jobs

const listeners = new Set<ServerResponse>();

/** Runs one job's work from its stored kind and arguments (so it can be rebuilt after a restart). */
const runners: Record<JobKind, Runner> = {
  options: (j, o) => generateOptions(j.project, { ...o, force: Boolean(j.args.force) }),
  write: (j, o) => writeStory(j.project, { ...o, force: Boolean(j.args.force) }),
  review: async (j, o) => {
    const r = await review(j.project, { ...o, force: Boolean(j.args.force) });
    // a failed review sends only the flagged lines back to be rewritten
    if (!r.round.passed && r.flagged.length && j.args.fix !== false) await fix(j.project, o);
    return r.round;
  },
  fix: (j, o) => fix(j.project, o),
  rewrite: (j, o) => rewrite(j.project, z.array(z.string()).parse(j.args.lineIds), z.string().parse(j.args.direction), o),
  storyboard: async (j, o) => (await storyboard(j.project, { ...o, force: Boolean(j.args.force) })).report.stats,
  voice: async (j, o) => {
    const line = typeof j.args.line === "string" ? j.args.line : undefined;
    const s = await voiceProject(j.project, {
      signal: o.signal,
      ...(line ? { line } : {}),
      ...(typeof j.args.seed === "number" ? { seed: j.args.seed } : {}),
      ...(typeof j.args.energy === "number" ? { energy: j.args.energy } : {}),
      onLine: ({ i, total, line: id }) => o.report({ label: "Voicing the script", done: i, total, detail: i < total ? `line ${i + 1} of ${total} (${id})` : "building the narration track" }),
    });
    const { voice: _voice, ...summary } = s;
    return summary;
  },
  mix: async (j, o) => {
    o.report({ label: "Mixing the sound", done: 0, total: 1 });
    const r = await runMixAsync(j.project, { signal: o.signal, force: Boolean(j.args.force) });
    return { cached: r.cached, lufs: r.result.integratedLufs, truePeakDbtp: r.result.truePeakDbtp, cues: r.plan.cues.length, warnings: r.plan.warnings };
  },
  render: (j, o) => renderPreview(j.project, { signal: o.signal, report: o.report }),
  export: (j, o) => exportVideo(j.project, { signal: o.signal, report: o.report }),
};

export const queue = new JobQueue(join(projectsDir(), "studio.sqlite"), runners, (job) => {
  const data = `event: job\ndata: ${JSON.stringify(job)}\n\n`;
  for (const res of listeners) res.write(data);
});
const resumed = queue.recover();
if (resumed.length) console.log(`resuming ${resumed.length} unfinished job(s): ${resumed.map((j) => j.label).join("; ")}`);
void queue.pump();

const enqueue = (project: string, kind: JobKind, label: string, args: Record<string, unknown> = {}) => queue.enqueue(project, kind, label, args);

// ---------------------------------------------------------------- project state

function projectState(id: string) {
  const n = readNarration(id);
  return n?.lockedAt ? "locked" : n ? "script" : readPick(id) ? "writing" : readOptions(id) ? "options" : "brief";
}

async function projectSummary(id: string) {
  const brief = readBrief(id);
  const n = readNarration(id);
  const pick = readPick(id);
  const pipeline = await pipelineOf(id, queue.list(40, id));
  return { id, brief, state: projectState(id), title: pick?.option.title ?? null, lockedAt: n?.lockedAt ?? null, updatedAt: n?.updatedAt ?? pick?.pickedAt ?? brief.createdAt, budget: budgetOf(brief), wpm: brief.wpm, pipeline };
}

async function projectDetail(id: string) {
  const loopmap = readLoopMap(id) ?? null;
  const narration = readNarration(id) ?? null;
  const usage = readUsage(id);
  return {
    ...(await projectSummary(id)),
    options: readOptions(id) ?? null,
    pick: readPick(id) ?? null,
    loopmap,
    narration,
    comments: readComments(id).comments,
    history: readHistory(id).rounds,
    factcheck: readJson(join(storyPaths(id).reviewDir, "factcheck.json"), FactCheckOutput) ?? null,
    check: loopmap && narration ? check(id) : null,
    steps: readSteps(id).done,
    usage: { total: totals(usage), byStep: byStep(usage) },
    jobs: queue.list(10, id),
  };
}

// ---------------------------------------------------------------- http

/** Refuses at once (instead of failing later in the queue) when the script is locked. A missing script may still be on its way (a queued pick). */
function notLocked(id: string): undefined {
  readBrief(id);
  if (readNarration(id)?.lockedAt) throw new StoryError("the script is locked; unlock it first");
  return undefined;
}

function needsScenes(id: string): void {
  readBrief(id);
  if (!readVoice(id)) throw new StoryError("voice the script first");
  if (!existsSync(storyboardPaths(id).scenes)) throw new StoryError("plan the storyboard first");
}

/** voice.json as the voice page needs it: per line the take's quality, length and any retake, plus the track. */
function voiceState(id: string) {
  const v = readVoice(id);
  if (!v) return { voice: null };
  if (!v.ok) throw new StoryError(`voice.json is not valid: ${v.errors[0]}`);
  const overrides = readJson(projectPaths(id).overrides, z.record(z.string(), z.object({ seed: z.number().optional(), energy: z.number().optional() }))) ?? {};
  return {
    voice: {
      engine: v.data.engine,
      reference: v.data.reference.file,
      track: v.data.track,
      lines: v.data.lines.map((l) => ({ id: l.id, text: l.text, energy: l.energy, offset: l.offset, duration: l.duration, file: l.file, quality: l.quality, retake: overrides[l.id] ?? null })),
    },
  };
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function body<T extends z.ZodType>(req: IncomingMessage, schema: T): Promise<z.output<T>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  let raw: unknown = {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (text) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new HttpError(400, "the request body is not JSON");
    }
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return r.data;
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

const NewProject = z.strictObject({
  sentence: z.string().trim().min(8),
  narrative: NarrativeId,
  format: Format,
  minutes: z.number().positive(),
  wpm: z.number().min(100).max(240).optional(),
  factual: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
});
const Force = z.strictObject({ force: z.boolean().optional() });

type Route = [method: string, pattern: RegExp, handler: (req: IncomingMessage, res: ServerResponse, m: string[]) => Promise<unknown> | unknown];

const routes: Route[] = [
  ["GET", /^\/health$/, () => ({ ok: true, busy: queue.list(5).some((j) => j.status === "running") })],
  ["GET", /^\/projects$/, async () => (await Promise.all(listProjects().map(projectSummary))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))],
  [
    "POST",
    /^\/projects$/,
    async (req) => {
      const b = await body(req, NewProject);
      const brief = createProject(b);
      const job = enqueue(brief.id, "options", `master loop options for ${brief.id}`);
      return { brief, job };
    },
  ],
  ["GET", /^\/projects\/([\w-]+)$/, (_q, _s, [id]) => projectDetail(id!)],
  ["GET", /^\/projects\/([\w-]+)\/pipeline$/, (_q, _s, [id]) => pipelineOf(id!, queue.list(40, id!))],
  [
    "POST",
    /^\/projects\/([\w-]+)\/options$/,
    async (req, _s, [id]) => {
      const { force } = await body(req, Force);
      return { job: enqueue(id!, "options", `master loop options for ${id}`, { force: Boolean(force) }) };
    },
  ],
  [
    "POST",
    /^\/projects\/([\w-]+)\/pick$/,
    async (req, _s, [id]) => {
      const { option, force } = await body(req, z.strictObject({ option: z.string(), force: z.boolean().optional() }));
      const pick = pickOption(id!, option, { force });
      return { pick, job: enqueue(id!, "write", `loop map and narration for ${id}`, { force: Boolean(force) }) };
    },
  ],
  [
    "POST",
    /^\/projects\/([\w-]+)\/review$/,
    async (req, _s, [id]) => {
      const { force, fix: autoFix } = await body(req, z.strictObject({ force: z.boolean().optional(), fix: z.boolean().default(true) }));
      notLocked(id!);
      return { job: enqueue(id!, "review", `review of ${id}`, { force: Boolean(force), fix: autoFix }) };
    },
  ],
  ["POST", /^\/projects\/([\w-]+)\/storyboard$/, async (q, _s, [id]) => {
    const { force } = await body(q, Force);
    if (!readNarration(id!)?.lockedAt) throw new StoryError("lock the script before the storyboard");
    return { job: enqueue(id!, "storyboard", `storyboard ${id}`, { force: Boolean(force) }) };
  }],
  ["GET", /^\/projects\/([\w-]+)\/storyboard$/, (_q, _s, [id]) => ({ storyboard: readStoryboard(id!) ?? null })],
  ["POST", /^\/projects\/([\w-]+)\/fix$/, (_q, _s, [id]) => notLocked(id!) ?? ({ job: enqueue(id!, "fix", `fix flagged lines in ${id}`) })],
  [
    "POST",
    /^\/projects\/([\w-]+)\/rewrite$/,
    async (req, _s, [id]) => {
      const { lineIds, direction } = await body(req, z.strictObject({ lineIds: z.array(z.string()).min(1), direction: z.string().trim().min(1) }));
      notLocked(id!);
      const locked = (readNarration(id!)?.loops ?? []).flatMap((l) => l.lines).filter((l) => l.locked && lineIds.includes(l.id));
      if (locked.length) throw new StoryError(`${locked.map((l) => l.id).join(", ")} locked; locked lines are never rewritten`);
      return { job: enqueue(id!, "rewrite", `rewrite ${lineIds.join(", ")}`, { lineIds, direction }) };
    },
  ],
  [
    "PUT",
    /^\/projects\/([\w-]+)\/narration$/,
    async (req, _s, [id]) => {
      const { narration } = await body(req, z.strictObject({ narration: z.unknown() }));
      const saved = saveNarration(id!, narration);
      return { narration: saved, check: check(id!) };
    },
  ],
  [
    "POST",
    /^\/projects\/([\w-]+)\/comments\/([\w-]+)\/(accept|reject)$/,
    (_q, _s, [id, cid, what]) => {
      const r = decide(id!, cid!, what as "accept" | "reject");
      return { ...r, comments: readComments(id!).comments, check: check(id!) };
    },
  ],
  [
    "POST",
    /^\/projects\/([\w-]+)\/lock$/,
    async (req, _s, [id]) => {
      const { force } = await body(req, Force);
      const r = lock(id!, { force });
      return { narration: r.narration, scriptJson: r.scriptJson };
    },
  ],
  ["POST", /^\/projects\/([\w-]+)\/unlock$/, (_q, _s, [id]) => ({ narration: unlock(id!) })],
  // ---- Phase 3: voice, scenes, sound, render, export
  [
    "POST",
    /^\/projects\/([\w-]+)\/voice$/,
    async (req, _s, [id]) => {
      const b = await body(req, z.strictObject({ line: z.string().optional(), seed: z.int().optional(), energy: z.int().min(1).max(5).optional() }));
      if (!readNarration(id!)?.lockedAt) throw new StoryError("lock the script before the voice");
      return { job: enqueue(id!, "voice", b.line ? `retake ${b.line} of ${id}` : `voice for ${id}`, b) };
    },
  ],
  ["GET", /^\/projects\/([\w-]+)\/voice$/, (_q, _s, [id]) => voiceState(id!)],
  [
    "POST",
    /^\/projects\/([\w-]+)\/mix$/,
    async (req, _s, [id]) => {
      const { force } = await body(req, Force);
      needsScenes(id!);
      return { job: enqueue(id!, "mix", `mix ${id}`, { force: Boolean(force) }) };
    },
  ],
  ["GET", /^\/projects\/([\w-]+)\/mix$/, (_q, _s, [id]) => ({ mix: readJson(join(projectPaths(id!).audioDir, "mix.json"), MixResult) ?? null })],
  [
    "POST",
    /^\/projects\/([\w-]+)\/render$/,
    (_q, _s, [id]) => {
      needsScenes(id!);
      return { job: enqueue(id!, "render", `preview render of ${id}`) };
    },
  ],
  [
    "POST",
    /^\/projects\/([\w-]+)\/export$/,
    (_q, _s, [id]) => {
      needsScenes(id!);
      return { job: enqueue(id!, "export", `YouTube export of ${id}`) };
    },
  ],
  ["GET", /^\/projects\/([\w-]+)\/renders$/, (_q, _s, [id]) => ({ preview: readPreviewRecord(id!) ?? null, export: readExportRecord(id!) ?? null })],
  ["GET", /^\/projects\/([\w-]+)\/scenes$/, (_q, _s, [id]) => ({ scenes: readScenes(id!) ?? null })],
  ["GET", /^\/projects\/([\w-]+)\/cast$/, (_q, _s, [id]) => ({ cast: readScenes(id!)?.cast ?? null })],
  [
    "PUT",
    /^\/projects\/([\w-]+)\/cast$/,
    async (req, _s, [id]) => {
      const { cast } = await body(req, z.strictObject({ cast: z.record(CastId, CastMember) }));
      const file = readScenes(id!);
      if (!file) throw new StoryError("there are no scenes yet; plan the storyboard first");
      // the scene file is the judge: every character a scene uses must stay in the cast
      const next = SceneFile.safeParse({ ...file, cast });
      if (!next.success) throw new HttpError(422, next.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      writeJson(storyboardPaths(id!).scenes, next.data);
      return { cast: next.data.cast };
    },
  ],
  ["GET", /^\/jobs$/, () => queue.list(30)],
  [
    "POST",
    /^\/jobs\/(j\d+)\/cancel$/,
    (_q, _s, [jid]) => {
      const job = queue.cancel(jid!);
      if (!job) throw new HttpError(404, `no job ${jid}`);
      return { job };
    },
  ],
];


// ---------------------------------------------------------------- media files

const MIME: Record<string, string> = { ".mp4": "video/mp4", ".wav": "audio/wav", ".jpg": "image/jpeg", ".srt": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".json": "application/json" };
/** Only what the app plays or downloads: renders, takes and the mixed track. */
const SERVED = [/^renders\//, /^audio\/lines\/[^/]+\.wav$/, /^audio\/(mix|narration)\.wav$/];

/** GET /projects/<id>/file/<path>: a file of the project with Range support (the video player seeks). */
function serveFile(req: IncomingMessage, res: ServerResponse, id: string, rel: string): void {
  const root = projectPaths(id).dir;
  const file = resolve(root, normalize(rel));
  // the allow-list is checked on the resolved path, so "renders/../brief.json" is judged as brief.json
  const inside = file.startsWith(root + sep) ? file.slice(root.length + 1).split(sep).join("/") : "";
  if (!inside || !SERVED.some((re) => re.test(inside)) || !existsSync(file) || !statSync(file).isFile()) return send(res, 404, { error: `no file ${rel}` });
  const size = statSync(file).size;
  const headers: Record<string, string | number> = { "content-type": MIME[extname(file)] ?? "application/octet-stream", "accept-ranges": "bytes", "cache-control": "no-cache" };
  if (new URL(req.url ?? "/", "http://localhost").searchParams.has("download")) headers["content-disposition"] = `attachment; filename="${file.split(sep).pop()}"`;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { "content-range": `bytes */${size}` });
      return void res.end();
    }
    res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, "content-length": size });
  createReadStream(file).pipe(res);
}

export const server = createServer(async (req, res) => {
  const fileMatch = req.method === "GET" ? /^\/projects\/([\w-]+)\/file\/(.+)$/.exec(new URL(req.url ?? "/", "http://localhost").pathname) : null;
  if (fileMatch) return serveFile(req, res, fileMatch[1]!, decodeURIComponent(fileMatch[2]!));
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(`event: hello\ndata: ${JSON.stringify(queue.list(20))}\n\n`);
    listeners.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(ping);
      listeners.delete(res);
    });
    return;
  }
  for (const [method, pattern, handler] of routes) {
    const m = url.pathname.match(pattern);
    if (!m || req.method !== method) continue;
    try {
      send(res, 200, await handler(req, res, m.slice(1)));
    } catch (e) {
      const err = e as Error;
      if (e instanceof HttpError) send(res, e.status, { error: e.message });
      else if (e instanceof StoryError) send(res, 409, { error: err.message });
      else if (err.name === "ValidationError") send(res, 422, { error: err.message });
      else {
        console.error(err);
        send(res, 500, { error: err.message });
      }
    }
    return;
  }
  send(res, 404, { error: `no route ${req.method} ${url.pathname}` });
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(PORT, "127.0.0.1", () => console.log(`studio worker on http://127.0.0.1:${PORT}`));
}
