/**
 * Same-origin proxy to the local worker (worker/src/server.ts), so the
 * browser never talks to another port. Streams the response through, which
 * keeps Server-Sent Events (/events) live.
 */
import { WORKER_URL } from "@/lib/worker-url";

export const dynamic = "force-dynamic";

async function forward(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = `${WORKER_URL}/${path.map(encodeURIComponent).join("/")}${new URL(req.url).search}`;
  try {
    const res = await fetch(url, {
      method: req.method,
      headers: { "content-type": req.headers.get("content-type") ?? "application/json", ...(req.headers.get("range") ? { range: req.headers.get("range")! } : {}) },
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text(),
      signal: req.signal,
      cache: "no-store",
    });
    // a video seeks with byte ranges, so the file headers go through too
    const pass = Object.fromEntries(["content-range", "accept-ranges", "content-length", "content-disposition"].flatMap((h) => (res.headers.get(h) ? [[h, res.headers.get(h)!]] : [])));
    return new Response(res.body, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-cache", ...pass } });
  } catch {
    return Response.json({ error: "The worker isn't running. Start it with `pnpm worker`." }, { status: 503 });
  }
}

export { forward as GET, forward as POST, forward as PUT };
