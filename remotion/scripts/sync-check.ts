/**
 * Proves captions and audio are in sync, three ways, and prints the worst offset in ms.
 *
 *   pnpm sync-check lighthouse [--video renders/lighthouse-v1-voiced.mp4] [--stills 16]
 *
 * 1. Frames vs words (exact, every word): for each word in voice.json, the frame
 *    the caption timeline gives it, converted back to milliseconds, minus the
 *    word's real start/end. Frame rounding makes the bound ±½ frame (16.7 ms at 30 fps).
 * 2. Audio vs voice.json (audio/scripts/verify_track.py): cross-correlates every
 *    line's raw take with the mastered track and, with --video, with the audio
 *    decoded from the rendered MP4. Catches anything that shifts audio in mastering,
 *    in Remotion or in AAC encoding.
 * 3. Rendered frames at word onsets: stills of the real composition just before
 *    a word that follows a pause and a few frames after it; the highlight colour
 *    must be absent before and present after. A spot check of the picture itself.
 */
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { projectPaths, syncAudio } from "@studio/project";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { compositionId } from "../samples";
import { ACCENT } from "../src/theme";
import { buildTimeline } from "../src/scene/timeline";
import { REMOTION_DIR, REPO_DIR, loadProject, sampleDir } from "./load";

const arg = (name: string) => (process.argv.indexOf(`--${name}`) > -1 ? process.argv[process.argv.indexOf(`--${name}`) + 1] : undefined);
const sample = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "lighthouse";
const video = arg("video");
const stillCount = Number(arg("stills") ?? 16);

const loaded = loadProject(sampleDir(sample));
if (!loaded.ok) throw new Error(`${sample} is not valid:\n  - ${loaded.errors.join("\n  - ")}`);
const project = loaded.data;
if (!project.voice) throw new Error(`${sample} has no voice.json; run pnpm voice ${sample}`);
syncAudio(sample);

// ---- 1. frames vs words ------------------------------------------------------
const tl = buildTimeline(project);
const fps = tl.fps;
const voiceWords = project.scenes.scenes.flatMap((s) => s.lineIds.flatMap((id) => project.voice!.lines.find((l) => l.id === id)!.words));
if (voiceWords.length !== tl.words.length) throw new Error(`timeline has ${tl.words.length} words, voice.json has ${voiceWords.length}`);
let maxStart = 0, maxEnd = 0, sumStart = 0, worst = "";
const problems: string[] = [];
tl.words.forEach((w, i) => {
  const v = voiceWords[i]!;
  if (w.text !== v.text) problems.push(`word ${i}: caption "${w.text}" vs voice "${v.text}"`);
  const ds = Math.abs((w.start / fps - v.start) * 1000);
  const de = Math.abs((w.end / fps - v.end) * 1000);
  sumStart += ds;
  if (ds > maxStart) (maxStart = ds), (worst = `"${v.text}" (${w.lineId}) at ${v.start.toFixed(3)} s`);
  maxEnd = Math.max(maxEnd, de);
  const scene = tl.scenes[w.sceneIndex]!;
  if (w.start < scene.start || w.start >= scene.start + scene.frames) problems.push(`word "${w.text}" (${w.lineId}) starts in frame ${w.start}, outside its scene ${w.sceneIndex} (${scene.start}–${scene.start + scene.frames})`);
});
tl.chunks.forEach((c) => {
  if (c.start !== c.words[0]!.start) problems.push(`caption chunk "${c.words.map((w) => w.text).join(" ")}" appears at ${c.start}, not on its first word (${c.words[0]!.start})`);
});
console.log(`1. frames vs words: ${tl.words.length} words, ${tl.scenes.length} scenes, ${tl.total} frames @ ${fps} fps`);
console.log(`   caption start vs spoken start: max ${maxStart.toFixed(1)} ms (mean ${(sumStart / tl.words.length).toFixed(1)} ms), worst ${worst}`);
console.log(`   caption end   vs spoken end:   max ${maxEnd.toFixed(1)} ms   (bound: half a frame = ${(500 / fps).toFixed(1)} ms)`);
if (maxStart > 500 / fps + 0.01) problems.push(`caption start offset ${maxStart.toFixed(1)} ms exceeds half a frame`);

// ---- 2. audio vs voice.json --------------------------------------------------
const py = spawnSync("uv", ["run", "--no-project", "python", "scripts/verify_track.py", projectPaths(sample).audioDir, ...(video ? ["--video", join(REPO_DIR, video)] : [])], { cwd: join(REPO_DIR, "audio"), encoding: "utf8" });
let audioMs = 0;
if (py.status !== 0) problems.push(`verify_track.py failed: ${py.stderr.slice(-400)}`);
else {
  const r = JSON.parse(py.stdout.trim().split("\n").at(-1)!) as { track: { maxAbsMs: number; worst: string } | null; video: { maxAbsMs: number; meanMs: number; worst: string } | null };
  console.log(`2. audio vs voice.json (cross-correlation, every line):`);
  console.log(`   mastered narration.wav: max ${r.track!.maxAbsMs.toFixed(3)} ms (line ${r.track!.worst})`);
  audioMs = Math.max(r.track!.maxAbsMs, r.video?.maxAbsMs ?? 0);
  if (r.video) console.log(`   audio inside ${video}: max ${r.video.maxAbsMs.toFixed(3)} ms, mean ${r.video.meanMs.toFixed(3)} ms (line ${r.video.worst})`);
  else console.log(`   (pass --video <mp4> to check the audio inside a render)`);
  if (audioMs > 5) problems.push(`audio is ${audioMs} ms from where voice.json puts it`);
}

// ---- 3. rendered frames at word onsets ---------------------------------------
const sceneEnd = new Set(tl.scenes.map((s) => s.start + s.frames));
const candidates = tl.words.filter((w, i) => {
  const prev = tl.words[i - 1];
  return w.end - w.start >= 5 && w.start > 4 && (!prev || w.start - prev.end >= 4) && !sceneEnd.has(w.start); // follows a pause (so nothing else is highlighted just before) and lasts 5+ frames (so it is still lit and fully faded in at frame+3)
});
const picks = candidates.filter((_, i) => i % Math.max(1, Math.floor(candidates.length / stillCount)) === 0).slice(0, stillCount);
console.log(`3. rendered frames at ${picks.length} word onsets (after a pause): highlight absent at frame−1, present at frame+3`);
const serveUrl = await bundle({ entryPoint: join(REMOTION_DIR, "src/index.ts"), publicDir: join(REMOTION_DIR, "public") });
const composition = await selectComposition({ serveUrl, id: compositionId(sample) });
const dir = join(REPO_DIR, "renders", "sync-check");
mkdirSync(dir, { recursive: true });
const accent = [parseInt(ACCENT.slice(1, 3), 16), parseInt(ACCENT.slice(3, 5), 16), parseInt(ACCENT.slice(5, 7), 16)];
async function accentPixels(frame: number): Promise<number> {
  const output = join(dir, `${sample}-${frame}.png`);
  await renderStill({ serveUrl, composition, frame, output, imageFormat: "png" });
  // caption band only (bottom of the frame); count pixels close to the highlight colour
  const ff = spawnSync("ffmpeg", ["-v", "error", "-i", output, "-vf", "crop=1920:230:0:800", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 28 });
  const px = ff.stdout;
  let n = 0;
  for (let i = 0; i < px.length; i += 3) if (Math.abs(px[i]! - accent[0]!) < 14 && Math.abs(px[i + 1]! - accent[1]!) < 14 && Math.abs(px[i + 2]! - accent[2]!) < 14) n++;
  return n;
}
let stillsOk = 0;
for (const w of picks) {
  const [before, after] = [await accentPixels(w.start - 1), await accentPixels(w.start + 3)];
  const ok = before < 200 && after > 1500;
  if (ok) stillsOk++;
  else problems.push(`frame ${w.start} "${w.text}": highlight pixels ${before} before, ${after} after (wanted < 200 and > 1500)`);
}
console.log(`   ${stillsOk}/${picks.length} onsets show the highlight appearing on cue (stills in renders/sync-check/)`);

const total = maxStart + audioMs;
console.log(`\nworst-case offset between a spoken word and its caption: ${total.toFixed(1)} ms (caption frame rounding ${maxStart.toFixed(1)} ms + audio placement ${audioMs.toFixed(3)} ms)`);
if (problems.length) {
  console.error(`\n✗ ${problems.length} problem(s):\n  - ${problems.slice(0, 12).join("\n  - ")}`);
  process.exit(1);
}
console.log("✓ in sync");
