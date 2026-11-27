import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time string comparison that does not leak length either. */
export function sameSecret(given: string | null | undefined, expected: string): boolean {
  if (!given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** The worker's bearer token. Proxy and session auth never apply to it. */
export function isWorker(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const expected = process.env.WORKER_TOKEN;
  return !!expected && sameSecret(token, expected);
}
