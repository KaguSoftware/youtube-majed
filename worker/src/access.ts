/**
 * Who may talk to the worker. It listens on 127.0.0.1 only, but any web page
 * the browser opens can still send it requests, so it answers only the
 * Studio's own pages:
 *
 * - the local app (http://localhost:3100, http://127.0.0.1:3100)
 * - the hosted app on Vercel (youtube-majed.vercel.app and this project's
 *   team-scoped preview URLs, which only this Vercel account can create)
 * - anything listed in STUDIO_ALLOWED_ORIGINS (comma-separated)
 *
 * A request without an Origin header (curl, the CLI, a <video> or <audio>
 * element) is allowed: browsers always send Origin on cross-origin fetches
 * and on every POST/PUT, so a foreign page cannot hide it. The Host header
 * must name the loopback address, which stops DNS rebinding (a foreign
 * domain resolving to 127.0.0.1).
 *
 * The hosted page is https and the worker is http://127.0.0.1. Browsers treat
 * loopback as a secure context, so this is not mixed content; Chrome asks
 * once for "local network access" and sends a preflight carrying
 * Access-Control-Request-Private-Network, answered below.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

const STATIC_ORIGINS = ["http://localhost:3100", "http://127.0.0.1:3100", "https://youtube-majed.vercel.app", "https://youtube-majed-majeds-projects-8c18cb68.vercel.app"];
/** Preview and branch deployments of this Vercel project (team scope `majeds-projects-8c18cb68`). */
const PREVIEW = /^https:\/\/youtube-majed-[a-z0-9-]+-majeds-projects-8c18cb68\.vercel\.app$/;
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

export function allowedOrigin(origin: string, extra = process.env.STUDIO_ALLOWED_ORIGINS ?? ""): boolean {
  const list = [...STATIC_ORIGINS, ...extra.split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean)];
  return list.includes(origin) || PREVIEW.test(origin);
}

/**
 * Applies the access rules to a request. Returns false when the request has
 * been answered already (refused, or a CORS preflight), true when the route
 * should run. CORS headers are set with setHeader, so every later writeHead
 * keeps them.
 */
export function guard(req: IncomingMessage, res: ServerResponse): boolean {
  if (!LOOPBACK_HOST.test(req.headers.host ?? "")) {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "the worker answers on 127.0.0.1 only" }));
    return false;
  }
  const origin = req.headers.origin;
  if (origin !== undefined) {
    if (!allowedOrigin(origin)) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `origin ${origin} may not use this worker (add it to STUDIO_ALLOWED_ORIGINS)` }));
      return false;
    }
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
    res.setHeader("access-control-expose-headers", "content-range, accept-ranges, content-length, content-disposition");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
      "access-control-allow-headers": "content-type, range",
      "access-control-max-age": "600",
      ...(req.headers["access-control-request-private-network"] ? { "access-control-allow-private-network": "true" } : {}),
    });
    res.end();
    return false;
  }
  return true;
}
