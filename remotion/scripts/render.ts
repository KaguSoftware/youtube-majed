/**
 * Renders a sample with one of the export profiles from docs/PLAN.md section 9.
 *   pnpm render                      # lighthouse, final 1080p → renders/lighthouse-v1.mp4
 *   pnpm render:preview              # lighthouse, 720p preview → renders/lighthouse-preview.mp4
 *   tsx scripts/render.ts <sample> --profile final|preview [--out name.mp4]
 *
 * Validates first and stops with readable errors if a scene file is wrong.
 */
import { syncAudio } from "@studio/project";
import { spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { compositionId } from "../samples";
import { PROFILES } from "./profiles";
import { REMOTION_DIR, REPO_DIR, loadProject, sampleDir } from "./load";


function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const sample = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "lighthouse";
const profileName = arg("profile") ?? "final";
const profile = PROFILES[profileName];
if (!profile) {
  console.error(`Unknown profile "${profileName}". Use: ${Object.keys(PROFILES).join(", ")}`);
  process.exit(1);
}

const check = loadProject(sampleDir(sample));
if (!check.ok) {
  console.error(`✗ ${sample} is not valid, nothing rendered:`);
  for (const e of check.errors) console.error(`  - ${e}`);
  process.exit(1);
}

// Voiced projects: make the narration loadable by Remotion (copied into remotion/public/projects/<id>/).
const voiced = Boolean(check.data.voice);
if (voiced) syncAudio(sample);
else console.log(`! ${sample} has no voice.json: rendering silent, scene timing from timing.json. Run \`pnpm voice ${sample}\` first for sound.`);

const outDir = join(REPO_DIR, "renders");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, arg("out") ?? `${sample}-${profile.suffix}${voiced ? "-voiced" : ""}.mp4`);

console.log(`Rendering ${sample} → ${out}\n  ${profile.label}`);
const started = Date.now();
const r = spawnSync(
  join(REMOTION_DIR, "node_modules/.bin/remotion"),
  [
    "render", "src/index.ts", compositionId(sample), out,
    "--codec=h264",
    `--crf=${profile.crf}`,
    `--x264-preset=${profile.x264Preset}`,
    `--scale=${profile.scale}`,
    "--image-format=jpeg",
    `--jpeg-quality=${profile.jpegQuality}`,
    "--pixel-format=yuv420p",
    ...(voiced ? ["--audio-codec=aac", `--audio-bitrate=${profile.audioBitrate}`, "--enforce-audio-track"] : []),
  ],
  { cwd: REMOTION_DIR, stdio: "inherit" },
);
if (r.status !== 0) process.exit(r.status ?? 1);

const seconds = (Date.now() - started) / 1000;
const bytes = statSync(out).size;
const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration,bit_rate:stream=width,height,codec_name,profile,bit_rate,sample_rate,channels", "-of", "json", out], { encoding: "utf8" });
let info = "";
if (probe.status === 0) {
  const j = JSON.parse(probe.stdout) as { format: { duration: string; bit_rate: string }; streams: { codec_name: string; profile?: string; width?: number; height?: number; bit_rate?: string; sample_rate?: string; channels?: number }[] };
  const v = j.streams.find((s) => s.width);
  const a = j.streams.find((s) => !s.width);
  info = `${v?.width}×${v?.height} ${v?.codec_name} ${v?.profile ?? ""}, ${Number(j.format.duration).toFixed(1)} s, ${(Number(j.format.bit_rate) / 1000).toFixed(0)} kb/s total`;
  if (a) info += ` · audio ${a.codec_name} ${a.profile ?? ""} ${(Number(a.bit_rate) / 1000).toFixed(0)} kb/s ${a.sample_rate} Hz ${a.channels}ch`;
}
console.log(`\n✓ ${out}\n  ${(bytes / 1024 / 1024).toFixed(1)} MB · rendered in ${seconds.toFixed(0)} s${info ? ` · ${info}` : ""}`);
