/**
 * The encode settings of the segmented renderer (render-segments.ts), shared
 * with the proof (compare-renders.ts) so a full render and a stitched one are
 * encoded the same way. Profiles come from docs/PLAN.md section 9
 * (@studio/schema EXPORT_PROFILES).
 *
 * `lossless` (x264 qp 0) exists only for the proof: with no encoder in the
 * way, a stitched render must decode to exactly the frames of a full render.
 */
import type { RenderMediaOptions } from "@remotion/renderer";
import { EXPORT_PROFILES } from "@studio/schema";
import type { SegmentProfile } from "../src/scene/segments";

export const SEGMENT_PROFILES = {
  preview: { ...EXPORT_PROFILES.preview, lossless: false },
  final: { ...EXPORT_PROFILES.youtube, lossless: false },
  /** the 9:16 Reel: drawn by the "ProjectVertical" composition (1080 wide), so the render scale is 1 */
  reel: { ...EXPORT_PROFILES.reel, lossless: false },
  lossless: { ...EXPORT_PROFILES.preview, id: "lossless" as const, label: "Lossless 1280×720 (x264 qp 0), for the proof only", crf: 0, lossless: true },
} as const;
export type SegmentProfileName = keyof typeof SEGMENT_PROFILES;
export const isProfileName = (s: string): s is SegmentProfileName => s in SEGMENT_PROFILES;

/** Width of the composition a profile is drawn from, so `scale` brings it to the profile's size. */
export const compositionWidth = (p: { orientation: "landscape" | "portrait" }) => (p.orientation === "portrait" ? 1080 : 1920);
/** The Remotion composition id a profile is drawn from (scripts/project-entry.tsx). */
export const compositionOf = (p: { orientation: "landscape" | "portrait" }) => (p.orientation === "portrait" ? "ProjectVertical" : "Project");

export function segmentProfile(name: SegmentProfileName): SegmentProfile {
  const p = SEGMENT_PROFILES[name];
  return { width: p.width, height: p.height, crf: p.crf, preset: p.preset, jpegQuality: p.jpegQuality, pixelFormat: "yuv420p", codec: "h264" };
}

/**
 * renderMedia's encode options for a profile. `keyframesAt` (frame numbers
 * relative to the first rendered frame) forces an IDR keyframe on each, so the
 * file can be cut there without re-encoding.
 */
export function encodeOptions(name: SegmentProfileName, o: { keyframesAt?: number[] } = {}): Pick<RenderMediaOptions, "codec" | "crf" | "x264Preset" | "scale" | "imageFormat" | "jpegQuality" | "pixelFormat" | "audioCodec" | "audioBitrate" | "ffmpegOverride"> {
  const p = SEGMENT_PROFILES[name];
  const keys = o.keyframesAt && o.keyframesAt.length > 1 ? o.keyframesAt : undefined;
  return {
    codec: "h264",
    crf: p.lossless ? 1 : p.crf, // Remotion accepts 1-51; qp 0 replaces it below
    x264Preset: p.preset,
    scale: p.width / compositionWidth(p),
    imageFormat: "jpeg",
    jpegQuality: p.jpegQuality,
    pixelFormat: "yuv420p",
    audioCodec: "aac",
    audioBitrate: p.audioBitrate,
    ffmpegOverride: ({ type, args }) => {
      if (type !== "pre-stitcher" && type !== "stitcher") return args;
      let out = args;
      if (p.lossless) {
        const at = out.indexOf("-crf");
        if (at > -1) out = [...out.slice(0, at), "-qp", "0", ...out.slice(at + 2)];
      }
      if (keys && type === "pre-stitcher") {
        const at = out.lastIndexOf("-y");
        out = [...out.slice(0, at), "-force_key_frames", `expr:${keys.map((k) => `eq(n,${k})`).join("+")}`, "-forced-idr", "1", ...out.slice(at)];
      }
      return out;
    },
  };
}
