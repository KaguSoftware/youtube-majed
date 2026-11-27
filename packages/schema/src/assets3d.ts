import { z } from "zod";

/**
 * The 3D asset index (assets/sources-3d.json, committed). The files it lists
 * live under assets/3d/, which is gitignored: licensed 3D sources (Mixamo FBX,
 * their GLB conversions) never go into git. Every file has a licence entry,
 * as every sound in assets/sources.json does.
 *
 * Today the low-poly style draws everything in code (remotion/src/three), so
 * the index starts empty; `pnpm assets3d convert` adds an entry per clip.
 */
export const Asset3D = z.strictObject({
  id: z.string().regex(/^[a-z0-9_/-]+$/, "ids are lower case, e.g. mixamo/walk"),
  kind: z.enum(["clip", "character"]),
  /** path under assets/3d/ */
  file: z.string().min(1),
  /** the converted GLB under assets/3d/ */
  glb: z.string().min(1).optional(),
  /** for clips: the library action it plays */
  action: z.string().regex(/^[a-z_]+$/).optional(),
  description: z.string().min(1),
  licence: z.strictObject({ name: z.string().min(1), url: z.string().url(), redistribute: z.boolean() }),
  source: z.strictObject({ name: z.string().min(1), url: z.string().url(), sha1: z.string().regex(/^[0-9a-f]{40}$/) }),
});

export const Asset3DIndex = z.strictObject({
  version: z.literal(1),
  note: z.string(),
  assets: z.array(Asset3D),
});

export type Asset3D = z.infer<typeof Asset3D>;
export type Asset3DIndex = z.infer<typeof Asset3DIndex>;

export const MIXAMO_LICENCE = {
  name: "Mixamo (Adobe): royalty-free in personal and commercial videos; the raw files may not be redistributed",
  url: "https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html",
  redistribute: false,
} as const;
