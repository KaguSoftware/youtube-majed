/**
 * Stills of a Studio composition, for looking at layouts (the 9:16 galleries) without opening Studio.
 *
 *   tsx scripts/stills.ts <CompositionId> --out <dir> [--frames 10,40,90] [--per-scene] [--scale 0.5] [--sheet sheet.jpg --cols 6]
 *
 * --per-scene: for a gallery project (Cameras, Scenery, Layouts, ...), one still per scene, at 55% of its length
 * (so a camera move is caught mid-move). --sheet: tile the stills into one contact sheet with ffmpeg.
 * One bundle and one browser for all the stills.
 */
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { GALLERY_PROJECTS, type GalleryProjectId } from "../src/gallery/projects";
import { buildTimeline } from "../src/scene/timeline";
import { REMOTION_DIR } from "./load";

const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const id = args[0];
if (!id || id.startsWith("--")) {
  console.error("usage: tsx scripts/stills.ts <CompositionId> --out <dir> [--frames a,b] [--per-scene] [--scale s] [--sheet file.jpg --cols n]");
  process.exit(1);
}
const out = resolve(process.env.INIT_CWD ?? process.cwd(), arg("out") ?? "stills");
const scale = Number(arg("scale") ?? 1);
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (f.endsWith(".jpg") && f.startsWith("s-")) rmSync(join(out, f));

const galleryId = id.replace(/Vertical$/, "") as GalleryProjectId;
let frames = (arg("frames") ?? "").split(",").filter(Boolean).map(Number);
if (args.includes("--per-scene")) {
  const g = GALLERY_PROJECTS[galleryId];
  if (!g) throw new Error(`${id} is not a gallery project`);
  const t = buildTimeline(g().project, { portrait: id.endsWith("Vertical") });
  frames = t.scenes.map((s) => s.start + Math.max(1, Math.round(s.frames * 0.55)));
}
if (!frames.length) frames = [30];

const serveUrl = await bundle({ entryPoint: join(REMOTION_DIR, "src/index.ts"), publicDir: join(REMOTION_DIR, "public") });
const composition = await selectComposition({ serveUrl, id });
const browser = await openBrowser("chrome", { chromiumOptions: {}, forceDeviceScaleFactor: scale });
try {
  for (const [i, frame] of frames.entries()) {
    await renderStill({ composition, serveUrl, output: join(out, `s-${String(i).padStart(3, "0")}.jpg`), frame: Math.min(frame, composition.durationInFrames - 1), imageFormat: "jpeg", jpegQuality: 88, scale, puppeteerInstance: browser, overwrite: true });
  }
} finally {
  await browser.close({ silent: true });
}
console.log(`${frames.length} stills in ${out} (${composition.width}×${composition.height} × ${scale})`);

const sheet = arg("sheet");
if (sheet) {
  const file = resolve(process.env.INIT_CWD ?? process.cwd(), sheet);
  mkdirSync(dirname(file), { recursive: true });
  const cols = Number(arg("cols") ?? 6);
  const rows = Math.ceil(frames.length / cols);
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-framerate", "1", "-i", join(out, "s-%03d.jpg"), "-vf", `tile=${cols}x${rows}:padding=8:color=#14121f`, "-frames:v", "1", "-q:v", "3", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  console.log(`contact sheet ${file}`);
}
process.exit(0);
