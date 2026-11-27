/**
 * Proves a stitched partial render matches a full render (Phase 4).
 *
 *   pnpm compare-renders <id> [--profile preview|final|lossless] [--frames a-b] [--baseline] [--json]
 *
 * 1. The stitched file: scripts/render-segments.ts, which reuses every cached
 *    segment and draws only what is missing (after an edit: the dirty ones).
 * 2. The reference: the whole composition drawn in ONE renderMedia call with
 *    the same encode settings (scripts/encode.ts), audio laid in by Remotion,
 *    i.e. exactly what a render without segments produces.
 * 3. Pictures: per-frame PSNR and SSIM (ffmpeg), frame counts, worst frames
 *    with the scene they belong to, and the frames around every segment
 *    boundary on their own (where a transition, a caption or an off-by-one
 *    would show). With --profile lossless every frame must be identical.
 * 4. Sound: the two soundtracks against each other (audio/scripts/compare_audio.py:
 *    lag and residual) and every line's take against each file's audio
 *    (audio/scripts/verify_track.py: placement error per line).
 *
 * Writes projects/<id>/renders/compare/<profile>.json and prints a summary.
 */
import { projectPaths, storyboardPaths, syncAudio } from "@studio/project";
import { validateProject } from "@studio/schema";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { planSegments } from "../src/scene/segments";
import { encodeOptions, isProfileName, segmentProfile, type SegmentProfileName } from "./encode";
import { REMOTION_DIR, REPO_DIR } from "./load";
import { renderCodeHash } from "@studio/project";

const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const json = args.includes("--json");
const say = (m: string) => (json ? process.stderr.write(m + "\n") : console.log(m));
const id = args.find((a, i) => !a.startsWith("--") && !["--profile", "--frames"].includes(args[i - 1] ?? ""));
if (!id) throw new Error("usage: pnpm compare-renders <id> [--profile preview|final|lossless] [--frames a-b] [--json]");
const profileArg = arg("profile") ?? "preview";
if (!isProfileName(profileArg)) throw new Error(`unknown profile ${profileArg}`);
const profile = profileArg as SegmentProfileName;
const frameArg = arg("frames");

const p = projectPaths(id);
const sb = storyboardPaths(id);
const dir = join(p.dir, "renders", "compare");
mkdirSync(dir, { recursive: true });
const stitched = join(dir, `${profile}-stitched.mp4`);
const full = join(dir, `${profile}-full.mp4`);
const read = (f: string) => JSON.parse(readFileSync(f, "utf8"));
const check = validateProject({ scenes: read(sb.scenes), script: read(p.scriptJson), voice: read(p.voiceJson) });
if (!check.ok) throw new Error(check.errors.join("\n"));
const plan = planSegments(check.data, { code: renderCodeHash(), profile: segmentProfile(profile) });
const range: [number, number] = frameArg ? (frameArg.split("-").map(Number) as [number, number]) : [0, plan.total - 1];
const segs = plan.segments.filter((s) => s.start <= range[1] && s.start + s.frames - 1 >= range[0]);
const first = segs[0]!.start;
const last = segs.at(-1)!.start + segs.at(-1)!.frames - 1;

// ---- 1. stitched
const t0 = Date.now();
const seg = spawnSync(join(REMOTION_DIR, "node_modules/.bin/tsx"), ["scripts/render-segments.ts", id, "--profile", profile, "--out", stitched, "--json", ...(frameArg ? ["--frames", frameArg] : [])], { cwd: REMOTION_DIR, encoding: "utf8", maxBuffer: 64 << 20 });
const events = seg.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
const segDone = events.find((e) => e.event === "done");
if (seg.status !== 0 || !segDone) throw new Error(`render-segments failed:\n${seg.stderr.slice(-2000)}`);
const stitchedMs = Date.now() - t0;
say(`stitched: drew ${segDone.rendered} of ${segDone.segments} segments (${segDone.framesRendered} frames) in ${(stitchedMs / 1000).toFixed(1)} s`);

// ---- 2. full reference, one call
syncAudio(id, { track: "mix" });
copyFileSync(sb.scenes, join(p.publicDir, "scenes.json"));
copyFileSync(p.scriptJson, join(p.publicDir, "script.json"));
const t1 = Date.now();
const serveUrl = await bundle({ entryPoint: join(REMOTION_DIR, "scripts/project-entry.tsx"), publicDir: join(REMOTION_DIR, "public") });
const inputProps = { project: id };
const composition = await selectComposition({ serveUrl, id: "Project", inputProps });
await renderMedia({ composition, serveUrl, inputProps, outputLocation: full, ...encodeOptions(profile), enforceAudioTrack: true, overwrite: true, concurrency: 8, frameRange: [first, last] });
const fullMs = Date.now() - t1;
say(`full:     ${last - first + 1} frames in one call in ${(fullMs / 1000).toFixed(1)} s`);

// ---- 2b. with --baseline, a second full render: how much two full renders of the same frames differ (Chrome's
// rasteriser is not bit-exact from run to run on a few frames), the noise floor a stitched render is judged against
const baselineFile = join(dir, `${profile}-full2.mp4`);
if (args.includes("--baseline")) await renderMedia({ composition, serveUrl, inputProps, outputLocation: baselineFile, ...encodeOptions(profile), enforceAudioTrack: true, overwrite: true, concurrency: 8, frameRange: [first, last] });

// ---- 3. pictures
const frames = (f: string) => Number(spawnSync("ffprobe", ["-v", "error", "-count_packets", "-select_streams", "v:0", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", f], { encoding: "utf8" }).stdout.trim());
const psnrLog = join(dir, `${profile}.psnr.log`);
const ssimLog = join(dir, `${profile}.ssim.log`);
const ff = spawnSync("ffmpeg", ["-v", "error", "-i", stitched, "-i", full, "-lavfi", `[0:v]split[a0][a1];[1:v]split[b0][b1];[a0][b0]psnr=stats_file=${psnrLog};[a1][b1]ssim=stats_file=${ssimLog}`, "-f", "null", "-"], { encoding: "utf8" });
if (ff.status !== 0) throw new Error(ff.stderr);
const psnr = readFileSync(psnrLog, "utf8").trim().split("\n").map((l) => (/psnr_avg:inf/.test(l) ? Infinity : Number(/psnr_avg:([\d.]+)/.exec(l)![1])));
const ssim = readFileSync(ssimLog, "utf8").trim().split("\n").map((l) => Number(/All:([\d.]+)/.exec(l)![1]));
rmSync(psnrLog);
rmSync(ssimLog);
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
const pct = (xs: number[], q: number) => sorted(xs)[Math.min(xs.length - 1, Math.floor(xs.length * q))]!;
const finite = psnr.filter(Number.isFinite);
const sceneAt = (f: number) => segs.find((s) => f >= s.start && f < s.start + s.frames)!;
const boundaries = segs.slice(1).flatMap((s) => [-2, -1, 0, 1, 2].map((d) => s.start + d - first)).filter((i) => i >= 0 && i < psnr.length);
const worst = psnr.map((v, i) => ({ frame: first + i, psnr: v, ssim: ssim[i]! })).sort((a, b) => a.psnr - b.psnr).slice(0, 5).map((w) => ({ ...w, scene: sceneAt(w.frame).sceneId, intoScene: w.frame - sceneAt(w.frame).start }));
const pictures = {
  frames: { stitched: frames(stitched), full: frames(full), compared: psnr.length },
  identical: psnr.filter((v) => v === Infinity).length,
  psnr: { min: Math.min(...psnr), p1: pct(psnr, 0.01), median: pct(psnr, 0.5), meanFinite: finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : Infinity },
  ssim: { min: Math.min(...ssim), p1: pct(ssim, 0.01), median: pct(ssim, 0.5) },
  boundaries: { frames: boundaries.length, psnrMin: Math.min(...boundaries.map((i) => psnr[i]!)), ssimMin: Math.min(...boundaries.map((i) => ssim[i]!)), identical: boundaries.filter((i) => psnr[i] === Infinity).length },
  worst,
};

let baseline: { differing: number; psnrMin: number } | null = null;
if (args.includes("--baseline")) {
  const log = join(dir, `${profile}.base.log`);
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", full, "-i", baselineFile, "-lavfi", `psnr=stats_file=${log}`, "-f", "null", "-"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  const vals = readFileSync(log, "utf8").trim().split("\n").map((l) => (/psnr_avg:inf/.test(l) ? Infinity : Number(/psnr_avg:([\d.]+)/.exec(l)![1])));
  rmSync(log);
  baseline = { differing: vals.filter((v) => v !== Infinity).length, psnrMin: Math.min(...vals) };
}

// ---- 4. sound
const uv = (script: string, ...a: string[]) => {
  const r = spawnSync("uv", ["run", "--no-sync", "python", script, ...a], { cwd: join(REPO_DIR, "audio"), encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`${script} failed: ${r.stderr.slice(-1500)}`);
  return JSON.parse(r.stdout.trim().split("\n").at(-1)!);
};
const whole = !frameArg;
const between = uv("scripts/compare_audio.py", full, stitched) as { lagMs: number; residualDb: number; seconds: number; durationDiffMs: number };
const lines = (video: string) => {
  if (!whole) return null;
  const r = uv("scripts/verify_track.py", p.audioDir, "--video", video) as { perLine: { video: { id: string; lagMs: number }[] } };
  const lags = r.perLine.video.map((x) => Math.abs(x.lagMs));
  return { lines: lags.length, maxAbsLagMs: Math.max(...lags), within1ms: lags.filter((l) => l <= 1).length };
};
const sound = { stitchedVsFull: between, stitchedVsVoice: lines(stitched), fullVsVoice: lines(full) };

const report = { project: id, profile, createdAt: new Date().toISOString(), range: [first, last], fullVsFull: baseline, segments: { total: segs.length, drawn: segDone.rendered, reused: segDone.reused, framesDrawn: segDone.framesRendered }, timings: { stitchedMs, fullMs }, pictures, sound };
// PSNR of identical frames is infinite; JSON has no Infinity, so it is written as "inf"
const inf = (_k: string, v: unknown) => (v === Infinity ? "inf" : v);
writeFileSync(join(dir, `${profile}.json`), JSON.stringify(report, inf, 2) + "\n");
if (json) process.stdout.write(JSON.stringify(report, inf) + "\n");
const db = (v: number) => (v === Infinity ? "∞" : v.toFixed(2));
say(`\npictures: ${pictures.frames.compared} frames compared (stitched ${pictures.frames.stitched}, full ${pictures.frames.full}), ${pictures.identical} identical`);
say(`  PSNR min ${db(pictures.psnr.min)} dB · 1st pct ${db(pictures.psnr.p1)} · median ${db(pictures.psnr.median)}   SSIM min ${pictures.ssim.min.toFixed(5)} · median ${pictures.ssim.median.toFixed(5)}`);
say(`  segment boundaries (±2 frames, ${pictures.boundaries.frames} frames): PSNR min ${db(pictures.boundaries.psnrMin)} dB, SSIM min ${pictures.boundaries.ssimMin.toFixed(5)}, ${pictures.boundaries.identical} identical`);
if (baseline) say(`  noise floor: a second full render differs from the first on ${baseline.differing} frames, PSNR min ${db(baseline.psnrMin)} dB`);
say(`sound: stitched vs full lag ${between.lagMs} ms, residual ${between.residualDb} dB, length diff ${between.durationDiffMs} ms`);
if (sound.stitchedVsVoice) say(`  every line's take in the stitched audio: max |lag| ${sound.stitchedVsVoice.maxAbsLagMs} ms (${sound.stitchedVsVoice.within1ms}/${sound.stitchedVsVoice.lines} within 1 ms); full render: ${sound.fullVsVoice!.maxAbsLagMs} ms`);
if (!existsSync(stitched)) process.exit(1);
process.exit(0);
