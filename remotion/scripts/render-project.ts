/**
 * Renders a storyboarded project from projects/<id>/ (Phase 3).
 *
 *   pnpm render:project <id> [--profile preview|final|reel] [--track mix|narration] [--scenes <scenes.json>]
 *                       [--out name.mp4 | /abs/path.mp4] [--concurrency N] [--frames 0-299]
 *                       [--stills 120,900,2400 --stills-dir <dir>] [--no-video] [--json]
 *
 * Copies the project's scene file (projects/<id>/storyboard/scenes.json by
 * default), script.json, voice.json and soundtrack (the mix from `pnpm mix`, or
 * the bare narration) into remotion/public/projects/<id>/, validates them, and
 * renders scripts/project-entry.tsx with the export profile, through
 * Remotion's Node API (bundle → selectComposition → renderMedia), so progress
 * and timings are real numbers.
 *
 * --json: stdout carries only JSON lines for the worker ({"event": "bundle" |
 * "render" | "stills" | "done", ...}); human text goes to stderr.
 * --stills: after the video (or alone with --no-video), JPEG frames without
 * captions, for the thumbnail suggestions.
 */
import { projectPaths, storyboardPaths, syncAudio } from "@studio/project";
import { validateProject } from "@studio/schema";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { cpus } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { PROFILES } from "./profiles";
import { REMOTION_DIR, REPO_DIR } from "./load";
import { defaultConcurrency, glFor, removeOnExit, reportStyle, stageScenes, styleArg, styledRaw } from "./art-style";
import { prepareShots } from "./shots";

const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const json = args.includes("--json");
const emit = (e: Record<string, unknown>) => {
  if (json) process.stdout.write(JSON.stringify(e) + "\n");
};
const say = (m: string) => (json ? process.stderr.write(m + "\n") : console.log(m));
const die = (m: string): never => {
  if (json) process.stdout.write(JSON.stringify({ event: "error", message: m }) + "\n");
  process.stderr.write(m + "\n");
  process.exit(1);
};

const VALUE_FLAGS = ["profile", "track", "scenes", "out", "concurrency", "frames", "stills", "stills-dir", "style"].map((f) => `--${f}`);
const id = args.find((a, i) => !a.startsWith("--") && !VALUE_FLAGS.includes(args[i - 1] ?? ""));
if (!id) die("usage: pnpm render:project <id> [--profile preview|final|reel] [--track mix|narration] [--scenes <file>] [--out name.mp4] [--concurrency N] [--frames a-b] [--stills f,f --stills-dir dir] [--no-video] [--style stick|low_poly] [--json]");
const projectId = id!;
const profileName = arg("profile") ?? "preview";
const profile = PROFILES[profileName];
if (!profile) die(`Unknown profile "${profileName}". Use: ${Object.keys(PROFILES).join(", ")}`);
const prof = profile!;
const track = (arg("track") ?? "mix") as "mix" | "narration";
const p = projectPaths(projectId);
const scenesFile = arg("scenes") ? resolve(arg("scenes")!) : storyboardPaths(projectId).scenes;
const read = (f: string) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : undefined);

const style = styleArg(args);
const rawScenes = styledRaw(read(scenesFile), style);
const check = validateProject({ scenes: rawScenes, script: read(p.scriptJson), voice: read(p.voiceJson) });
if (!check.ok) die(`✗ ${projectId} is not valid, nothing rendered:\n  - ${check.errors.join("\n  - ")}`);
if (check.ok && !check.data.voice) die(`✗ ${projectId} has no voice.json: run \`pnpm voice ${projectId}\` first`);

syncAudio(projectId, { track });
mkdirSync(p.publicDir, { recursive: true });
// custom shots: stale ones are checked again (a failure puts the library scene back), the rest staged for the bundle
if (check.ok) await prepareShots(projectId, check.data, say);
stageScenes(rawScenes, join(p.publicDir, "scenes.json"));
copyFileSync(p.scriptJson, join(p.publicDir, "script.json"));

const outArg = arg("out");
const out = outArg && isAbsolute(outArg) ? outArg : join(REPO_DIR, "renders", outArg ?? `${projectId}-storyboard-${prof.suffix}.mp4`);
mkdirSync(join(out, ".."), { recursive: true });

// Tuned on the M3 Pro (6 performance + 6 efficiency cores, 36 GB): 4, 6, 8, 10 and 12 all land within 10% of each other
// (40 to 44 frames/s at 1080p); 8 was fastest and leaves four cores for the rest of the machine. See remotion/README.md.
const concurrency = Number(arg("concurrency") ?? process.env.STUDIO_RENDER_CONCURRENCY ?? defaultConcurrency(check.ok ? glFor(check.data) : null, cpus().length));
const frameRange = arg("frames")?.split("-").map(Number) as [number, number] | undefined;
const stills = (arg("stills") ?? "").split(",").filter(Boolean).map(Number);
// pnpm runs scripts in this folder; INIT_CWD is where it was typed
const stillsDir = arg("stills-dir") ? resolve(process.env.INIT_CWD ?? process.cwd(), arg("stills-dir")!) : undefined;
const wantVideo = !args.includes("--no-video");

const t0 = Date.now();
say(`Rendering ${projectId} (${scenesFile.replace(REPO_DIR + "/", "")}, ${track}) → ${out}\n  ${prof.label} · concurrency ${concurrency}`);
const gl = check.ok ? glFor(check.data) : null;
if (check.ok) reportStyle(check.data, say, emit);
let lastBundle = 0;
const serveUrl = await bundle({
  entryPoint: join(REMOTION_DIR, "scripts/project-entry.tsx"),
  publicDir: join(REMOTION_DIR, "public"),
  onProgress: (pct) => {
    if (pct - lastBundle >= 5 || pct === 100) {
      lastBundle = pct;
      emit({ event: "bundle", progress: pct / 100 });
    }
  },
});
removeOnExit(serveUrl);
const bundleMs = Date.now() - t0;
const inputProps = { project: projectId };
const chromiumOptions = { gl };
const composition = await selectComposition({ serveUrl, id: profileName === "reel" ? "ProjectVertical" : "Project", inputProps, chromiumOptions });
const frames = frameRange ? frameRange[1] - frameRange[0] + 1 : composition.durationInFrames;

let renderMs = 0;
let encodeMs = 0;
if (wantVideo) {
  const t1 = Date.now();
  let allRenderedAt = 0;
  let lastEmit = 0;
  await renderMedia({
    composition,
    serveUrl,
    inputProps,
    outputLocation: out,
    codec: "h264",
    crf: prof.crf,
    x264Preset: prof.x264Preset as "slow",
    scale: prof.scale,
    imageFormat: "jpeg",
    jpegQuality: prof.jpegQuality,
    pixelFormat: "yuv420p",
    audioCodec: "aac",
    audioBitrate: prof.audioBitrate as `${number}k`,
    enforceAudioTrack: true,
    overwrite: true,
    concurrency,
    chromiumOptions,
    ...(frameRange ? { frameRange } : {}),
    onProgress: (e) => {
      if (!allRenderedAt && e.renderedFrames >= frames) allRenderedAt = Date.now();
      const now = Date.now();
      if (now - lastEmit > 400 || e.progress >= 1) {
        lastEmit = now;
        emit({ event: "render", rendered: e.renderedFrames, encoded: e.encodedFrames, total: frames, progress: e.progress });
      }
    },
  });
  const t2 = Date.now();
  renderMs = t2 - t1;
  encodeMs = allRenderedAt ? t2 - allRenderedAt : 0;
}

if (stills.length) {
  if (!stillsDir) die("--stills needs --stills-dir");
  mkdirSync(stillsDir!, { recursive: true });
  const files: string[] = [];
  // the composition's props are resolved from its input props, so the caption-free stills need their own resolution
  const stillProps = { ...inputProps, captions: false };
  const stillComposition = await selectComposition({ serveUrl, id: profileName === "reel" ? "ProjectVertical" : "Project", inputProps: stillProps, chromiumOptions });
  for (const [i, frame] of stills.entries()) {
    const output = join(stillsDir!, `thumb-${i + 1}.jpg`);
    await renderStill({ composition: stillComposition, serveUrl, inputProps: stillProps, output, frame, imageFormat: "jpeg", jpegQuality: 95, overwrite: true, chromiumOptions });
    files.push(output);
    emit({ event: "stills", done: i + 1, total: stills.length, file: output });
  }
}

const totalMs = Date.now() - t0;
const bytes = wantVideo && existsSync(out) ? statSync(out).size : 0;
emit({ event: "done", file: wantVideo ? out : null, bytes, bundleMs, renderMs, encodeMs, totalMs, concurrency, frames: wantVideo ? frames : 0, fps: composition.fps });
say(`\n✓ ${wantVideo ? out : "stills"}\n  ${(bytes / 1024 / 1024).toFixed(1)} MB · bundle ${(bundleMs / 1000).toFixed(0)} s · render ${(renderMs / 1000).toFixed(0)} s (${renderMs ? (frames / (renderMs / 1000)).toFixed(1) : "–"} frames/s) · total ${(totalMs / 1000).toFixed(0)} s`);
process.exit(0);
