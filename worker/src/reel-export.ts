/**
 * The Reel export (docs/PLAN.md section 9, "Reels / Shorts"): the same project, drawn into the 9:16 frame.
 *
 *   1080×1920, 30 fps, H.264 High, CRF 21, preset slow, AAC 192 kbps, captions burned in, fast start,
 *   about 15–40 MB for 60–90 s. A file over the cap is re-encoded once at CRF + 2, like the YouTube export.
 *
 * It uses the segment renderer (`render-segments.ts --profile reel`), so after an edit only the scenes that
 * changed are drawn again; the 9:16 segments live in their own cache (`renders/segments/reel/`) beside the 16:9
 * ones. Next to the video: an .srt from the spoken word times, and `reel.json` (what it was made from, timings,
 * encode settings, an ffprobe summary). Works for a native Reel (brief format "reel") and for a Reel cut
 * (src/reel-cut.ts) alike: both are just projects.
 */
import { projectPaths, readJson, writeJson } from "@studio/project";
import { EXPORT_PROFILES, ReelRecord, sizeCapMB } from "@studio/schema";
import { copyFileSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hasFastStart, probe } from "./media";
import { currentInputs, ensureMix, faststart, reencode, requireVoiced, round1, scaled, segmentRender, segmentsOf, timingsOf, type RunOpts } from "./render";
import { buildCues, buildSrt } from "./sidecars";

export function reelPaths(id: string) {
  const dir = join(projectPaths(id).dir, "renders", "reel");
  return { dir, mp4: join(dir, `${id}.mp4`), srt: join(dir, `${id}.srt`), json: join(dir, "reel.json") };
}

export const readReelRecord = (id: string) => readJson(reelPaths(id).json, ReelRecord);

/** The Reel export and whether the project changed since it was made (the same content hashes as the other exports). */
export async function reelStatus(id: string): Promise<{ record: ReelRecord | null; stale: boolean }> {
  const record = readReelRecord(id) ?? null;
  if (!record) return { record, stale: false };
  try {
    const now = await currentInputs(id);
    return { record, stale: record.inputs.scenes !== now.scenes || record.inputs.voice !== now.voice || record.inputs.soundtrack !== now.soundtrack || (record.inputs.shots ?? "") !== now.shots };
  } catch {
    return { record, stale: false };
  }
}

export async function exportReel(id: string, o: RunOpts): Promise<ReelRecord> {
  const profile = EXPORT_PROFILES.reel;
  const voice = requireVoiced(id);
  const paths = reelPaths(id);
  mkdirSync(paths.dir, { recursive: true });
  const t0 = Date.now();

  const phases = { mix: { label: "Mixing the sound", from: 0, to: 0.02 }, bundle: { label: "Preparing the scenes", from: 0.02, to: 0.05 }, draw: { label: "Drawing the Reel in 9:16", from: 0.05, to: 0.85 }, check: { label: "Checking the size", from: 0.85, to: 0.96 }, srt: { label: "Subtitles", from: 0.96, to: 1 } };
  await ensureMix(id, { ...o, phase: phases.mix });

  const bundle = scaled(o.report, phases.bundle);
  const draw = scaled(o.report, phases.draw);
  const pass1 = join(paths.dir, `${id}.pass1.mp4`);
  const r = await segmentRender(id, "reel", pass1, { signal: o.signal, concurrency: o.concurrency, progress: (stage, f, d) => (stage === "plan" || stage === "bundle" ? bundle(stage === "plan" ? 0 : f, d) : stage === "render" ? draw(f * 0.96, d) : draw(0.96 + 0.04 * f, d)) });

  // size check: one re-encode at CRF + 2 if the file is over the cap, then fast start
  const check = scaled(o.report, phases.check);
  const capMB = sizeCapMB(profile, process.env);
  const firstPassMB = statSync(pass1).size / 1_048_576;
  const over = capMB > 0 && firstPassMB > capMB;
  const crf = over ? profile.crf + profile.crfStep : profile.crf;
  check(0, over ? `${firstPassMB.toFixed(1)} MB is over the ${capMB} MB cap: re-encoding once at CRF ${crf}` : `${firstPassMB.toFixed(1)} MB, under the ${capMB} MB cap`);
  if (over) await reencode(pass1, paths.mp4, profile, crf, { signal: o.signal, durationS: voice.track.duration, progress: (f) => check(f, `re-encoding at CRF ${crf}`) });
  else if (hasFastStart(pass1)) copyFileSync(pass1, paths.mp4);
  else {
    check(0.5, "moving the index to the front for fast start");
    await faststart(pass1, paths.mp4, o.signal);
  }
  rmSync(pass1, { force: true });
  const media = await probe(paths.mp4);
  check(1);

  const at = scaled(o.report, phases.srt);
  at(0.3, "subtitles");
  const cues = buildCues(voice);
  writeFileSync(paths.srt, buildSrt(cues));

  const record = ReelRecord.parse({
    version: 1,
    profile: "reel",
    file: paths.mp4,
    createdAt: new Date().toISOString(),
    inputs: await currentInputs(id),
    timings: timingsOf(r.done, Date.now() - t0),
    encode: { crf, preset: profile.preset, reencoded: over, capMB, firstPassMB: round1(firstPassMB) },
    segments: segmentsOf(r.seg),
    media,
    sidecars: { srt: paths.srt, captions: cues.length },
  });
  writeJson(paths.json, record);
  at(1);
  return record;
}
