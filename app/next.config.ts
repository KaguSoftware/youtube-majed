import type { NextConfig } from "next";

const config: NextConfig = {
  // workspace packages ship TypeScript source
  transpilePackages: ["@studio/schema", "@studio/story"],
  // type checking is `pnpm typecheck` (tsc 7), like the rest of the repo
  typescript: { ignoreBuildErrors: true },
  devIndicators: false,
};

export default config;
