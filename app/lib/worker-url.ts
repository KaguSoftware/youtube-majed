/**
 * The worker on this computer, called straight from the browser. The local app
 * (localhost:3100) and the hosted app (Vercel) run the same code: either way
 * the page talks to the helper running on the machine in front of you, never
 * to a server. The worker only answers the Studio's own origins
 * (worker/src/access.ts). Set at build time from STUDIO_WORKER_URL or
 * STUDIO_WORKER_PORT (next.config.ts).
 */
export const WORKER_URL = (process.env.NEXT_PUBLIC_STUDIO_WORKER_URL || "http://127.0.0.1:8766").replace(/\/$/, "");
