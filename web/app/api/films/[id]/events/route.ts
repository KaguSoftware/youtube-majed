import { getUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { imageKey, mediaUrls } from "@/lib/media";

/*
 * The render's progress as server-sent events, read from job_events (one row
 * per stage and per shot, written by the worker; PLAN.md section 3).
 *
 * Vercel functions must finish inside 60s, so each stream closes itself at
 * STREAM_MS. EventSource reconnects on its own and sends Last-Event-ID, which
 * is job_events.id, so the next stream resumes exactly where this one ended.
 */

const STREAM_MS = 45_000;
const POLL_MS = 1_500;
const TERMINAL = new Set(["done", "failed", "released", "error"]);

type EventRow = { id: string; job_id: string; attempt: number; kind: string; data: Record<string, unknown>; at: Date };

export async function GET(request: Request, ctx: RouteContext<"/api/films/[id]/events">) {
  if (!(await getUser())) return new Response("unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const [job] = await query<{ id: string; state: string }>(
    "SELECT id, state FROM jobs WHERE project_id = $1 AND kind = 'production' ORDER BY id DESC LIMIT 1", [id]);
  if (!job) return new Response("no render", { status: 404 });

  let after = Number(request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("after") ?? 0) || 0;
  const encoder = new TextEncoder();
  const started = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (s: string) => controller.enqueue(encoder.encode(s));
      send("retry: 2000\n\n");
      let finished = false;
      while (!finished && Date.now() - started < STREAM_MS && !request.signal.aborted) {
        const rows = await query<EventRow>(
          "SELECT id, job_id, attempt, kind, data, at FROM job_events WHERE job_id = $1 AND id > $2 ORDER BY id LIMIT 200",
          [job.id, after]);
        // Frames: one presigned URL per shot, signed locally (lib/media.ts).
        const hashes = rows.filter((r) => r.kind === "shot" && r.data.hash).map((r) => imageKey(String(r.data.hash)));
        const urls = hashes.length ? await mediaUrls(hashes).catch(() => ({} as Record<string, string>)) : {};
        for (const r of rows) {
          const url = r.kind === "shot" && r.data.hash ? urls[imageKey(String(r.data.hash))] : undefined;
          send(`id: ${r.id}\nevent: progress\ndata: ${JSON.stringify({ ...r, url })}\n\n`);
          after = Number(r.id);
          if (TERMINAL.has(r.kind) && r.kind !== "error") finished = true;
        }
        if (!finished) {
          send(": keep-alive\n\n");
          await new Promise((res) => setTimeout(res, POLL_MS));
        }
      }
      if (finished) send("event: end\ndata: {}\n\n");
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", Connection: "keep-alive" },
  });
}
