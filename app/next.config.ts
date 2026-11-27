import type { NextConfig } from "next";

const config: NextConfig = {
  // workspace packages ship TypeScript source (@studio/remotion: the animation library, for the cast preview and the player)
  transpilePackages: ["@studio/schema", "@studio/story", "@studio/remotion", "remotion", "@remotion/player"],
  // type checking is `pnpm typecheck` (tsc 7), like the rest of the repo
  typescript: { ignoreBuildErrors: true },
  devIndicators: false,
  // the browser calls the worker on its own computer (lib/worker-url.ts); a second dev server points at its own worker
  env: { NEXT_PUBLIC_STUDIO_WORKER_URL: process.env.STUDIO_WORKER_URL ?? `http://127.0.0.1:${process.env.STUDIO_WORKER_PORT ?? 8766}` },
  // a second dev server (another port, another worker) needs its own build folder
  distDir: process.env.STUDIO_NEXT_DIST ?? ".next",
};

export default config;
