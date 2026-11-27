/**
 * Step 7 (render + mix) and step 9 (export) of docs/PLAN.md.
 *
 * - `renderPreview`: mixes the sound (cached by plan hash), then renders the
 *   whole video at the quick-preview profile (720p, CRF 26, veryfast). This is
 *   what Majed watches before spending a long 1080p encode.
 * - `exportVideo`: the YouTube profile (1080p, CRF 20, preset slow, AAC 320
 *   kbps, fast start). A file over the size cap is re-encoded once at CRF + 2.
 *   Next to the video: an .srt, a chapter list from the loop map, three
 *   thumbnail frames from head-fake moments, and export.json (what it was
 *   made from, timings, an ffprobe summary).
 *
 * Remotion runs as a child process (remotion/scripts/render-project.ts, JSON
 * lines on stdout) so a cancelled job kills Chrome with it and a crash never
 * takes the worker down. Both steps record content hashes of their inputs
 * (scenes.json, voice.json, the soundtrack): when any of them changes, the
 * step is out of date (src/pipeline.ts).
 */
import { REPO_DIR, projectPaths, readJson, readVoice, storyboardPaths, writeJson } from "@studio/project";
import { EXPORT_PROFILES, RenderRecord, sizeCapMB, type ExportProfile, type ExportProfileId } from "@studio/schema";
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { fileHash, hasFastStart, probe, runChild, ChildError } from "./media";
import { MixError, runMixAsync } from "./mix";
import type { JobProgress } from "./queue";
import { buildChapters, buildCues, buildSrt, chaptersText, headFakeMoments, pickThumbnails, thumbnailFrame, thumbnailPick } from "./sidecars";
import { loadStory, readStoryboard } from "./storyboard";

export class RenderError extends Error {
  override name = "RenderError";
}

const REMOTION_DIR = join(REPO_DIR, "remotion");

export type RenderPaths = {
  dir: string;
  previewMp4: string;
  previewJson: string;
  exportDir: string;
  exportMp4: string;
  exportJson: string;
  srt: string;
  chapters: string;
  thumbs: string;
};

export function renderPaths(id: string): RenderPaths {
  const dir = join(projectPaths(id).dir, "renders");
  const exportDir = join(dir, "youtube");
  return {
    dir,
    previewMp4: join(dir, "preview.mp4"),
    previewJson: join(dir, "preview.json"),
    exportDir,
    exportMp4: join(exportDir, `${id}.mp4`),
    exportJson: join(exportDir, "export.json"),
    srt: join(exportDir, `${id}.srt`),
    chapters: join(exportDir, "chapters.txt"),
    thumbs: join(exportDir, "thumbnails"),
  };
}

export const readPreviewRecord = (id: string) => readJson(renderPaths(id).previewJson, RenderRecord);
export const readExportRecord = (id: string) => readJson(renderPaths(id).exportJson, RenderRecord);

/** Content hashes of what a render is made from. The soundtrack is the mix when there is one. */
export async function currentInputs(id: string): Promise<RenderRecord["inputs"]> {
  const sb = storyboardPaths(id);
  return { scenes: await fileHash(sb.scenes), voice: await fileHash(projectPaths(id).voiceJson), soundtrack: await fileHash(sb.mix) };
}

// ---------------------------------------------------------------- the remotion child

const Event = z.discriminatedUnion("event", [
  z.object({ event: z.literal("bundle"), progress: z.number() }),
  z.object({ event: z.literal("render"), rendered: z.number(), encoded: z.number(), total: z.number(), progress: z.number() }),
  z.object({ event: z.literal("stills"), done: z.number(), total: z.number(), file: z.string() }),
  z.object({ event: z.literal("done"), file: z.string().nullable(), bytes: z.number(), bundleMs: z.number(), renderMs: z.number(), encodeMs: z.number(), totalMs: z.number(), concurrency: z.number(), frames: z.number(), fps: z.number() }),
  z.object({ event: z.literal("error"), message: z.string() }),
]);
type Done = Extract<z.infer<typeof Event>, { event: "done" }>;

type Phase = { label: string; from: number; to: number };
/** A phase of a longer job: maps 0..1 inside the phase to the job's 0..1000 scale. */
const scaled = (report: (p: JobProgress) => void, ph: Phase) => (fraction: number, detail?: string) => report({ label: ph.label, done: Math.round((ph.from + (ph.to - ph.from) * Math.min(1, Math.max(0, fraction))) * 1000), total: 1000, ...(detail ? { detail } : {}) });

async function remotionRender(id: string, profile: "preview" | "final", out: string, o: { signal: AbortSignal; progress: (stage: "bundle" | "render" | "stills", fraction: number, detail?: string) => void; stills?: { frames: number[]; dir: string }; concurrency?: number }): Promise<Done> {
  const args = ["scripts/render-project.ts", id, "--profile", profile, "--out", out, "--json", ...(o.concurrency ? ["--concurrency", String(o.concurrency)] : []), ...(o.stills ? ["--stills", o.stills.frames.join(","), "--stills-dir", o.stills.dir] : [])];
  let done: Done | undefined;
  let failure: string | undefined;
  try {
    await runChild(join(REMOTION_DIR, "node_modules/.bin/tsx"), args, {
      cwd: REMOTION_DIR,
      signal: o.signal,
      onLine: (line) => {
        let parsed;
        try {
          parsed = Event.safeParse(JSON.parse(line));
        } catch {
          return;
        }
        if (!parsed.success) return;
        const e = parsed.data;
        if (e.event === "bundle") o.progress("bundle", e.progress);
        else if (e.event === "render") o.progress("render", e.progress, `${e.rendered.toLocaleString("en-GB")} of ${e.total.toLocaleString("en-GB")} frames`);
        else if (e.event === "stills") o.progress("stills", e.done / e.total, `thumbnail ${e.done} of ${e.total}`);
        else if (e.event === "done") done = e;
        else failure = e.message;
      },
    });
  } catch (e) {
    if (e instanceof ChildError && e.message !== "cancelled") throw new RenderError(failure ?? `Remotion failed:\n${e.tail}`);
    throw e;
  }
  if (!done) throw new RenderError("Remotion finished without saying it was done");
  return done;
}

/** Mixes the soundtrack for the project (cached by plan hash), reporting as the first phase of a job. */
async function ensureMix(id: string, o: { signal: AbortSignal; report: (p: JobProgress) => void; phase: Phase }): Promise<{ cached: boolean; seconds: number }> {
  const at = scaled(o.report, o.phase);
  at(0.05, "planning the cues");
  const t0 = Date.now();
  try {
    const r = await runMixAsync(id, { signal: o.signal });
    at(1, r.cached ? "the mix is up to date" : "mixed");
    return { cached: r.cached, seconds: (Date.now() - t0) / 1000 };
  } catch (e) {
    if (e instanceof MixError) throw new RenderError(e.message);
    throw e;
  }
}

function requireVoiced(id: string) {
  const voice = readVoice(id);
  if (!voice) throw new RenderError(`${id} has not been voiced yet`);
  if (!voice.ok) throw new RenderError(`voice.json is not valid:\n  - ${voice.errors.join("\n  - ")}`);
  if (!existsSync(storyboardPaths(id).scenes)) throw new RenderError(`${id} has no storyboard yet`);
  return voice.data;
}

// ---------------------------------------------------------------- preview

export type RunOpts = { signal: AbortSignal; report: (p: JobProgress) => void; concurrency?: number };

export async function renderPreview(id: string, o: RunOpts): Promise<RenderRecord> {
  const profile = EXPORT_PROFILES.preview;
  requireVoiced(id);
  const paths = renderPaths(id);
  mkdirSync(paths.dir, { recursive: true });
  const t0 = Date.now();
  await ensureMix(id, { ...o, phase: { label: "Mixing the sound", from: 0, to: 0.04 } });
  const bundle = scaled(o.report, { label: "Preparing the scenes", from: 0.04, to: 0.1 });
  const draw = scaled(o.report, { label: "Drawing the video", from: 0.1, to: 1 });
  const tmp = `${paths.previewMp4}.partial.mp4`;
  const done = await remotionRender(id, "preview", tmp, { signal: o.signal, concurrency: o.concurrency, progress: (stage, f, d) => (stage === "bundle" ? bundle(f) : draw(f, d)) });
  renameSync(tmp, paths.previewMp4);
  const media = await probe(paths.previewMp4);
  const record = RenderRecord.parse({
    version: 1,
    profile: "preview",
    file: paths.previewMp4,
    createdAt: new Date().toISOString(),
    inputs: await currentInputs(id),
    timings: timingsOf(done, Date.now() - t0),
    encode: { crf: profile.crf, preset: profile.preset, reencoded: false, capMB: 0, firstPassMB: round1(media.sizeBytes / 1_048_576) },
    media,
    sidecars: null,
  });
  writeJson(paths.previewJson, record);
  return record;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const timingsOf = (d: Done, totalMs: number) => ({ bundleMs: d.bundleMs, renderMs: d.renderMs, encodeMs: d.encodeMs, totalMs, concurrency: d.concurrency, frames: d.frames, framesPerSecond: d.renderMs ? round1(d.frames / (d.renderMs / 1000)) : 0 });

// ---------------------------------------------------------------- export

/** Re-encodes the video at a higher CRF, keeping the audio as it is. ffmpeg's -progress output drives the bar. */
async function reencode(src: string, dest: string, profile: ExportProfile, crf: number, o: { signal: AbortSignal; progress: (fraction: number) => void; durationS: number }): Promise<void> {
  await runChild("ffmpeg", ["-y", "-v", "error", "-nostats", "-progress", "pipe:1", "-i", src, "-c:v", "libx264", "-profile:v", "high", "-preset", profile.preset, "-crf", String(crf), "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", dest], {
    signal: o.signal,
    onLine: (line) => {
      const m = line.match(/^out_time_us=(\d+)/);
      if (m) o.progress(Number(m[1]) / 1e6 / o.durationS);
    },
  });
}

async function faststart(src: string, dest: string, signal: AbortSignal): Promise<void> {
  await runChild("ffmpeg", ["-y", "-v", "error", "-i", src, "-c", "copy", "-movflags", "+faststart", dest], { signal });
}

export async function exportVideo(id: string, o: RunOpts & { profile?: ExportProfileId }): Promise<RenderRecord> {
  const profile = EXPORT_PROFILES[o.profile ?? "youtube"];
  if (profile.id !== "youtube") throw new RenderError("the quick preview is made by the render step");
  const voice = requireVoiced(id);
  const story = loadStory(id);
  const paths = renderPaths(id);
  mkdirSync(paths.exportDir, { recursive: true });
  mkdirSync(paths.thumbs, { recursive: true });
  const t0 = Date.now();

  const phases = { mix: { label: "Mixing the sound", from: 0, to: 0.01 }, bundle: { label: "Preparing the scenes", from: 0.01, to: 0.03 }, draw: { label: "Drawing the video in 1080p", from: 0.03, to: 0.9 }, check: { label: "Checking the size", from: 0.9, to: 0.97 }, sidecars: { label: "Subtitles, chapters and thumbnails", from: 0.97, to: 1 } };
  await ensureMix(id, { ...o, phase: phases.mix });

  // thumbnail suggestions: head-fake moments, as frames of the video
  const moments = pickThumbnails(headFakeMoments(story, voice, readStoryboard(id)?.reveals ?? []));
  const frames = moments.map((m) => thumbnailFrame(m, profile.fps));

  const bundle = scaled(o.report, phases.bundle);
  const draw = scaled(o.report, phases.draw);
  const pass1 = join(paths.exportDir, `${id}.pass1.mp4`);
  const done = await remotionRender(id, "final", pass1, {
    signal: o.signal,
    concurrency: o.concurrency,
    ...(frames.length ? { stills: { frames, dir: paths.thumbs } } : {}),
    progress: (stage, f, d) => (stage === "bundle" ? bundle(f) : stage === "render" ? draw(f * 0.98, d) : draw(0.98 + 0.02 * f, d)),
  });

  // size check: one re-encode at CRF + 2 if the file is over the cap (docs/PLAN.md section 9), then fast start
  const check = scaled(o.report, phases.check);
  const capMB = sizeCapMB(profile, process.env);
  const firstPassMB = statSync(pass1).size / 1_048_576;
  const over = capMB > 0 && firstPassMB > capMB;
  const crf = over ? profile.crf + profile.crfStep : profile.crf;
  check(0, over ? `${firstPassMB.toFixed(0)} MB is over the ${capMB} MB cap: re-encoding once at CRF ${crf}` : `${firstPassMB.toFixed(0)} MB, under the ${capMB} MB cap`);
  if (over) {
    await reencode(pass1, paths.exportMp4, profile, crf, { signal: o.signal, durationS: voice.track.duration, progress: (f) => check(f, `re-encoding at CRF ${crf}`) });
  } else if (hasFastStart(pass1)) {
    copyFileSync(pass1, paths.exportMp4);
  } else {
    check(0.5, "moving the index to the front for fast start");
    await faststart(pass1, paths.exportMp4, o.signal);
  }
  rmSync(pass1, { force: true });
  const media = await probe(paths.exportMp4);
  check(1);

  // sidecars
  const at = scaled(o.report, phases.sidecars);
  at(0.2, "subtitles");
  const cues = buildCues(voice);
  writeFileSync(paths.srt, buildSrt(cues));
  at(0.6, "chapters");
  const chapterList = buildChapters(story);
  writeFileSync(paths.chapters, chaptersText(chapterList));
  const thumbnails = moments.map((m, i) => thumbnailPick(m, join(paths.thumbs, `thumb-${i + 1}.jpg`), profile.fps));

  const record = RenderRecord.parse({
    version: 1,
    profile: "youtube",
    file: paths.exportMp4,
    createdAt: new Date().toISOString(),
    inputs: await currentInputs(id),
    timings: timingsOf(done, Date.now() - t0),
    encode: { crf, preset: profile.preset, reencoded: over, capMB, firstPassMB: round1(firstPassMB) },
    media,
    sidecars: { srt: paths.srt, captions: cues.length, chapters: paths.chapters, chapterList, thumbnails },
  });
  writeJson(paths.exportJson, record);
  at(1);
  return record;
}
