/**
 * Renders a project in segments (Phase 4, partial re-render).
 *
 *   pnpm render:segments <id> [--profile preview|final|lossless] [--out file.mp4] [--concurrency N]
 *                        [--frames a-b] [--plan] [--json]
 *
 * One segment per scene, each a frame range of the full `Project`
 * composition, cached in projects/<id>/renders/segments/<profile>/<key>.mp4
 * by a hash of everything drawn in it (src/scene/segments.ts). Only the
 * segments missing from the cache are drawn, through one browser; then all of
 * them are joined without re-encoding and the mixed soundtrack (audio/mix.wav,
 * the same file a full render plays) is muxed in once.
 *
 * --plan: print the plan (which segments are cached, which would be drawn) and stop.
 * --frames a-b: only the segments that overlap these frames (for checks).
 * --json: stdout carries only JSON lines for the worker ({"event": "plan" |
 * "bundle" | "render" | "stitch" | "done" | "error", ...}).
 *
 * The file is the same composition a full render draws (scripts/render-project.ts):
 * scripts/compare-renders.ts proves it frame by frame.
 */
import { projectPaths, renderCodeHash, storyboardPaths, syncAudio } from "@studio/project";
import { validateProject } from "@studio/schema";
import { bundle } from "@remotion/bundler";
import { RenderInternals, openBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { planSegments } from "../src/scene/segments";
import { SEGMENT_PROFILES, encodeOptions, isProfileName, segmentProfile, type SegmentProfileName } from "./encode";
import { REMOTION_DIR, REPO_DIR } from "./load";

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


const VALUE_FLAGS = ["profile", "out", "concurrency", "frames"].map((f) => `--${f}`);
const id = args.find((a, i) => !a.startsWith("--") && !VALUE_FLAGS.includes(args[i - 1] ?? ""));
if (!id) die("usage: pnpm render:segments <id> [--profile preview|final|lossless] [--out file.mp4] [--concurrency N] [--frames a-b] [--plan] [--json]");
const projectId = id!;
const profileArg = arg("profile") ?? "preview";
if (!isProfileName(profileArg)) die(`Unknown profile "${profileArg}". Use: ${Object.keys(SEGMENT_PROFILES).join(", ")}`);
const profileName = profileArg as SegmentProfileName;
const prof = SEGMENT_PROFILES[profileName];
const segProfile = segmentProfile(profileName);

const p = projectPaths(projectId);
const sb = storyboardPaths(projectId);
const read = (f: string) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : undefined);
const check = validateProject({ scenes: read(sb.scenes), script: read(p.scriptJson), voice: read(p.voiceJson) });
if (!check.ok) die(`✗ ${projectId} is not valid, nothing rendered:\n  - ${check.errors.join("\n  - ")}`);
const project = check.ok ? check.data : die("unreachable");
if (!project.voice) die(`✗ ${projectId} has no voice.json`);
if (!existsSync(sb.mix)) die(`✗ ${projectId} has no mix: run \`pnpm mix ${projectId}\``);

const t0 = Date.now();
const code = renderCodeHash();
const plan = planSegments(project, { code, profile: segProfile });
const frameRange = arg("frames")?.split("-").map(Number) as [number, number] | undefined;
const wanted = frameRange ? plan.segments.filter((s) => s.start <= frameRange[1] && s.start + s.frames - 1 >= frameRange[0]) : plan.segments;
const cacheDir = join(p.dir, "renders", "segments", profileName);
mkdirSync(cacheDir, { recursive: true });
const fileOf = (key: string) => join(cacheDir, `${key}.mp4`);
const missing = wanted.filter((s) => !existsSync(fileOf(s.key)));
const missingFrames = missing.reduce((n, s) => n + s.frames, 0);
emit({ event: "plan", code, segments: wanted.length, cached: wanted.length - missing.length, toRender: missing.length, frames: wanted.reduce((n, s) => n + s.frames, 0), framesToRender: missingFrames, dirty: missing.map((s) => s.sceneId) });
say(`${projectId}: ${wanted.length} segments, ${wanted.length - missing.length} cached, ${missing.length} to draw (${missingFrames} of ${wanted.reduce((n, s) => n + s.frames, 0)} frames) · ${prof.label}`);
if (args.includes("--plan")) {
  if (!json) for (const s of wanted) say(`  ${existsSync(fileOf(s.key)) ? "·" : "▲"} ${s.sceneId.padEnd(5)} ${String(s.start).padStart(6)} +${String(s.frames).padEnd(4)} ${s.key}${s.layers.length > 1 ? `  (under ${s.layers.slice(0, -1).join(", ")})` : ""}`);
  process.exit(0);
}

const outArg = arg("out");
const out = outArg && isAbsolute(outArg) ? outArg : resolve(process.env.INIT_CWD ?? process.cwd(), outArg ?? join(REPO_DIR, "renders", `${projectId}-segments-${profileName}.mp4`));
mkdirSync(dirname(out), { recursive: true });
const concurrency = Number(arg("concurrency") ?? process.env.STUDIO_RENDER_CONCURRENCY ?? Math.max(2, Math.min(8, Math.floor(cpus().length * 0.67))));

// ---- draw the missing segments
let bundleMs = 0;
let renderMs = 0;
if (missing.length) {
  // the composition reads the project from public/projects/<id>/, as a full render does
  syncAudio(projectId, { track: "mix" });
  copyFileSync(sb.scenes, join(p.publicDir, "scenes.json"));
  copyFileSync(p.scriptJson, join(p.publicDir, "script.json"));
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
  bundleMs = Date.now() - t0;
  const inputProps = { project: projectId };
  const composition = await selectComposition({ serveUrl, id: "Project", inputProps });
  if (composition.durationInFrames !== plan.total) die(`the composition has ${composition.durationInFrames} frames but the plan has ${plan.total}; was a file changed during the render?`);
  // the scale factor must match the render scale, as when renderMedia opens its own browser: without it Chrome draws
  // every frame at 1080p and the screenshot is scaled down (measured 72 instead of 103 frames/s at 720p)
  const browser = await openBrowser("chrome", { chromiumOptions: {}, forceDeviceScaleFactor: prof.width / 1920 });
  const t1 = Date.now();
  let done = 0;
  let lastEmit = 0;
  // Consecutive missing segments are drawn in one call (each call costs ~0.8 s of tab start-up, measured), with an IDR
  // keyframe forced on every segment start, then cut apart without re-encoding. A lone segment is drawn on its own.
  const runs: (typeof missing)[] = [];
  for (const s of missing) {
    const run = runs.at(-1);
    if (run && run.at(-1)!.index === s.index - 1) run.push(s);
    else runs.push([s]);
  }
  const draw = async (segs: typeof missing, output: string) => {
    const a = segs[0]!.start;
    const last = segs.at(-1)!;
    const cuts = segs.map((s) => s.start - a);
    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      outputLocation: output,
      ...encodeOptions(profileName, { keyframesAt: cuts }),
      muted: true,
      overwrite: true,
      concurrency,
      frameRange: [a, last.start + last.frames - 1],
      puppeteerInstance: browser,
      onProgress: (e) => {
        const now = Date.now();
        if (now - lastEmit > 400) {
          lastEmit = now;
          emit({ event: "render", rendered: done + e.renderedFrames, total: missingFrames, segments: missing.length, scene: segs[0]!.sceneId });
        }
      },
    });
  };
  try {
    for (const run of runs) {
      const tmp = `${fileOf(run[0]!.key)}.${process.pid}.partial.mp4`;
      await draw(run, tmp);
      if (run.length === 1) renameSync(tmp, fileOf(run[0]!.key));
      else if (!splitRun(tmp, run)) {
        // a cut did not land on a keyframe: draw the run one segment at a time instead (slower, never wrong)
        say(`  could not cut a run of ${run.length} segments at its keyframes; drawing them one by one`);
        for (const s of run) {
          const one = `${fileOf(s.key)}.${process.pid}.partial.mp4`;
          await draw([s], one);
          renameSync(one, fileOf(s.key));
        }
      }
      rmSync(tmp, { force: true });
      done += run.reduce((n, s) => n + s.frames, 0);
      emit({ event: "render", rendered: done, total: missingFrames, segments: missing.length, scene: run.at(-1)!.sceneId });
    }
  } finally {
    await browser.close({ silent: true });
  }
  renderMs = Date.now() - t1;
}

/** Counts a file's video frames from the container (cheap: no decode). */
function frameCount(file: string): number {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=nb_frames", "-of", "csv=p=0", file], { encoding: "utf8" });
  return Number(r.stdout.trim());
}

/** Cuts a run file into its segments at the forced keyframes. False (and nothing cached) if any piece has the wrong length. */
function splitRun(file: string, run: typeof missing): boolean {
  const pattern = `${file}.%04d.mp4`;
  const points = run.slice(1).map((s) => s.start - run[0]!.start);
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", file, "-map", "0:v:0", "-c", "copy", "-f", "segment", "-segment_frames", points.join(","), "-reset_timestamps", "1", "-segment_format", "mp4", pattern], { encoding: "utf8" });
  const pieces = run.map((_, i) => pattern.replace("%04d", String(i).padStart(4, "0")));
  const ok = r.status === 0 && pieces.every((f, i) => existsSync(f) && frameCount(f) === run[i]!.frames);
  if (ok) pieces.forEach((f, i) => renameSync(f, fileOf(run[i]!.key)));
  else pieces.forEach((f) => rmSync(f, { force: true }));
  return ok;
}

// ---- stitch: join the segments without re-encoding, then mux the soundtrack once
const t2 = Date.now();
emit({ event: "stitch", stage: "join" });
const work = `${out}.${process.pid}`;
const list = `${work}.txt`;
writeFileSync(list, wanted.map((s) => `file '${fileOf(s.key).replace(/'/g, "'\\''")}'\n`).join(""));
// Remotion's own ffmpeg build (the one a full render encodes its audio with), so the AAC is the same encoder:
// measured on elevator-13 at 128 kbps, Homebrew's ffmpeg 9 left -24.8 dB of residual against the mix, Remotion's -29.5 dB.
const ff = async (argv: string[]) => {
  try {
    await RenderInternals.callFf({ bin: "ffmpeg", args: ["-y", "-v", "error", ...argv], indent: false, logLevel: "error", binariesDirectory: null, cancelSignal: undefined });
  } catch (e) {
    die(`ffmpeg failed: ${String((e as { stderr?: string }).stderr ?? (e as Error).message).trim().slice(-1200)}`);
  }
};
const video = `${work}.video.mp4`;
await ff(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", video]);
const first = wanted[0]!.start;
const frames = wanted.reduce((n, s) => n + s.frames, 0);
const seconds = frames / plan.timeline.fps;
emit({ event: "stitch", stage: "mux" });
// the same slice of the soundtrack a full render would play under these frames, encoded as Remotion encodes it (AAC, -cutoff 18000)
await ff(["-i", video, "-ss", (first / plan.timeline.fps).toFixed(6), "-i", sb.mix, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", prof.audioBitrate, "-cutoff", "18000", "-ar", "48000", "-ac", "2", "-af", "apad", "-t", seconds.toFixed(6), "-movflags", "+faststart", `${work}.mp4`]);
renameSync(`${work}.mp4`, out);
rmSync(video, { force: true });
rmSync(list, { force: true });
const stitchMs = Date.now() - t2;

const totalMs = Date.now() - t0;
const bytes = statSync(out).size;
emit({ event: "done", file: out, bytes, frames, segments: wanted.length, rendered: missing.length, reused: wanted.length - missing.length, framesRendered: missingFrames, bundleMs, renderMs, stitchMs, totalMs, concurrency, profile: profileName, code, keys: wanted.map((s) => s.key) });
say(`\n✓ ${out}\n  ${(bytes / 1024 / 1024).toFixed(1)} MB · drew ${missing.length} of ${wanted.length} segments (${missingFrames} frames) in ${(renderMs / 1000).toFixed(1)} s · stitch ${(stitchMs / 1000).toFixed(1)} s · total ${(totalMs / 1000).toFixed(1)} s`);
process.exit(0);
