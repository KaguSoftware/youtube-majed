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
      headers: { "content-type": req.headers.get("content-type") ?? "application/json" },
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text(),
      signal: req.signal,
      cache: "no-store",
    });
    return new Response(res.body, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-cache" } });
  } catch {
    return Response.json({ error: "The worker isn't running. Start it with `pnpm worker`." }, { status: 503 });
  }
}

export { forward as GET, forward as POST, forward as PUT };
