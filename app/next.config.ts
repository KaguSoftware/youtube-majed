import type { NextConfig } from "next";

const config: NextConfig = {
  // workspace packages ship TypeScript source (@studio/remotion: the animation library, for the cast preview and the player)
  transpilePackages: ["@studio/schema", "@studio/story", "@studio/remotion", "remotion", "@remotion/player"],
  // type checking is `pnpm typecheck` (tsc 7), like the rest of the repo
  typescript: { ignoreBuildErrors: true },
  devIndicators: false,
};

export default config;
