import type { NextConfig } from "next";

const config: NextConfig = {
  // workspace packages ship TypeScript source (@studio/remotion: the animation library, for the cast preview and the player)
  transpilePackages: ["@studio/schema", "@studio/story", "@studio/remotion", "remotion", "@remotion/player"],
  // type checking is `pnpm typecheck` (tsc 7), like the rest of the repo
  typescript: { ignoreBuildErrors: true },
  devIndicators: false,
  // a second dev server (another port, another worker) needs its own build folder
  distDir: process.env.STUDIO_NEXT_DIST ?? ".next",
};

export default config;
