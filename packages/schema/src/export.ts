import { z } from "zod";

/**
 * Export profiles (docs/PLAN.md section 9) and what an export leaves behind.
 *
 * H.264 with CRF (a quality target), not a fixed bitrate: flat animation
 * compresses far better than camera footage. Every +6 CRF roughly halves the
 * file, so "over the cap" is answered once, with CRF + `crfStep`.
 */
export const ExportProfileId = z.enum(["preview", "youtube", "reel"]);
export type ExportProfileId = z.infer<typeof ExportProfileId>;

export type ExportProfile = {
  id: ExportProfileId;
  label: string;
  width: number;
  height: number;
  fps: 30;
  crf: number;
  /** x264 preset */
  preset: "veryfast" | "slow";
  audioBitrate: "128k" | "192k" | "320k";
  jpegQuality: number;
  /** MB; a file over this is re-encoded once at crf + crfStep. 0 = no cap. */
  maxMB: number;
  crfStep: number;
  /** srt, chapters and thumbnail suggestions are written next to the file (the Reel writes an srt only) */
  sidecars: boolean;
  /** `portrait` is drawn by the 9:16 composition (remotion/src/scene/view.ts) from the same project data */
  orientation: "landscape" | "portrait";
};

export const EXPORT_PROFILES: Record<ExportProfileId, ExportProfile> = {
  youtube: {
    id: "youtube",
    label: "YouTube 1920×1080, 30 fps, H.264 High, CRF 20, preset slow, AAC 320 kbps, fast start",
    width: 1920,
    height: 1080,
    fps: 30,
    crf: 20,
    preset: "slow",
    audioBitrate: "320k",
    jpegQuality: 95,
    maxMB: 250,
    crfStep: 2,
    sidecars: true,
    orientation: "landscape",
  },
  /** docs/PLAN.md section 9, "Reels / Shorts": 1080×1920, CRF 21, captions burned in, about 15–40 MB for 60–90 s */
  reel: {
    id: "reel",
    label: "Reel 1080×1920, 30 fps, H.264 High, CRF 21, preset slow, AAC 192 kbps, captions burned in, fast start",
    width: 1080,
    height: 1920,
    fps: 30,
    crf: 21,
    preset: "slow",
    audioBitrate: "192k",
    jpegQuality: 92,
    maxMB: 40,
    crfStep: 2,
    sidecars: true,
    orientation: "portrait",
  },
  preview: {
    id: "preview",
    label: "Quick preview 1280×720, 30 fps, CRF 26, preset veryfast, AAC 128 kbps",
    width: 1280,
    height: 720,
    fps: 30,
    crf: 26,
    preset: "veryfast",
    audioBitrate: "128k",
    jpegQuality: 80,
    maxMB: 0,
    crfStep: 0,
    sidecars: false,
    orientation: "landscape",
  },
};

/** The size cap for a profile, in MB. `STUDIO_EXPORT_MAX_MB` overrides the YouTube cap, `STUDIO_REEL_MAX_MB` the Reel's. */
export function sizeCapMB(p: ExportProfile, env: Record<string, string | undefined> = {}): number {
  if (p.id === "preview") return p.maxMB;
  const v = Number(p.id === "reel" ? env.STUDIO_REEL_MAX_MB : env.STUDIO_EXPORT_MAX_MB);
  return Number.isFinite(v) && v > 0 ? v : p.maxMB;
}

// ---------------------------------------------------------------- what is left on disk

/** What ffprobe says about a file, trimmed to what the plan promises. */
export const MediaInfo = z.strictObject({
  container: z.string(),
  durationS: z.number(),
  sizeBytes: z.number(),
  totalKbps: z.number(),
  video: z.strictObject({ codec: z.string(), profile: z.string(), width: z.int(), height: z.int(), fps: z.number(), pixFmt: z.string(), kbps: z.number() }),
  audio: z.strictObject({ codec: z.string(), profile: z.string(), sampleRate: z.int(), channels: z.int(), kbps: z.number() }).nullable(),
  /** the moov atom comes before the media data, so playback starts before the download ends */
  fastStart: z.boolean(),
});
export type MediaInfo = z.infer<typeof MediaInfo>;

export const ChapterMark = z.strictObject({ loopId: z.string(), title: z.string(), atS: z.number().min(0) });
export type ChapterMark = z.infer<typeof ChapterMark>;

export const ThumbnailPick = z.strictObject({
  file: z.string(),
  atS: z.number().min(0),
  lineId: z.string(),
  /** why this moment: which head fake, and what it reveals */
  why: z.string(),
});
export type ThumbnailPick = z.infer<typeof ThumbnailPick>;

/**
 * `render.json` (preview) or `export.json` (YouTube) next to the video. `inputs` are
 * content hashes of what the video was made from; when any differs from the
 * project's current files the step is out of date (worker/src/pipeline.ts).
 */
export const RenderRecord = z.strictObject({
  version: z.literal(1),
  profile: ExportProfileId,
  file: z.string(),
  createdAt: z.iso.datetime(),
  inputs: z.strictObject({ scenes: z.string(), voice: z.string(), soundtrack: z.string(), /** the custom shots drawn instead of library scenes (a hash; "" for none, and for records made before Phase 5) */ shots: z.string().default("") }),
  timings: z.strictObject({
    bundleMs: z.number(),
    renderMs: z.number(),
    encodeMs: z.number(),
    totalMs: z.number(),
    concurrency: z.int(),
    frames: z.int(),
    framesPerSecond: z.number(),
  }),
  /** Phase 4: drawn in segments (remotion/scripts/render-segments.ts): how many were drawn again, how many came from the cache */
  segments: z.strictObject({ total: z.int(), drawn: z.int(), reused: z.int(), framesDrawn: z.int(), stitchMs: z.number() }).optional(),
  encode: z.strictObject({
    crf: z.int(),
    preset: z.string(),
    /** a file over the cap was re-encoded once at a higher CRF */
    reencoded: z.boolean(),
    capMB: z.number(),
    firstPassMB: z.number(),
  }),
  media: MediaInfo,
  sidecars: z
    .strictObject({
      srt: z.string(),
      captions: z.int(),
      chapters: z.string(),
      chapterList: z.array(ChapterMark),
      thumbnails: z.array(ThumbnailPick),
    })
    .nullable(),
});
export type RenderRecord = z.infer<typeof RenderRecord>;

/**
 * `reel.json` next to a Reel (projects/<id>/renders/reel/): what the 9:16 file was made from and how it was encoded,
 * like `export.json`, with an .srt as its only sidecar (docs/PLAN.md section 9: captions are burned in).
 */
export const ReelRecord = RenderRecord.omit({ profile: true, sidecars: true }).extend({
  profile: z.literal("reel"),
  sidecars: z.strictObject({ srt: z.string(), captions: z.int() }),
});
export type ReelRecord = z.infer<typeof ReelRecord>;
