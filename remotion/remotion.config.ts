import { Config } from "@remotion/cli/config";

// Studio and CLI defaults. Export profiles (CRF, x264 preset, size) live in
// scripts/render.ts so they sit next to the plan's section 9 table.
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(95);
Config.setOverwriteOutput(true);
