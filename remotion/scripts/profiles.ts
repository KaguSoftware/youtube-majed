/** Export profiles from docs/PLAN.md section 9 (defined in @studio/schema), shared by render.ts and render-project.ts. */
import { EXPORT_PROFILES, type ExportProfile } from "@studio/schema";

export type Profile = { scale: number; crf: number; x264Preset: string; jpegQuality: number; audioBitrate: string; suffix: string; label: string };

const of = (p: ExportProfile, suffix: string): Profile => ({ scale: p.width / (p.orientation === "portrait" ? 1080 : 1920), crf: p.crf, x264Preset: p.preset, jpegQuality: p.jpegQuality, audioBitrate: p.audioBitrate, suffix, label: p.label });

/** `final` and `preview` are the names the `pnpm render*` scripts have always used. */
export const PROFILES: Record<string, Profile> = {
  final: of(EXPORT_PROFILES.youtube, "v1"),
  preview: of(EXPORT_PROFILES.preview, "preview"),
  reel: of(EXPORT_PROFILES.reel, "reel"),
};
