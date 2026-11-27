/**
 * Read side of the asset index, assets/index.sqlite (docs/PLAN.md section 7).
 * The index is written by `pnpm assets index` (audio/studio_audio/assets.py),
 * which measures every file listed in assets/sources.json. Node only reads it:
 * the storyboard step takes the SFX tags Claude may use from here, and the
 * mix planner picks files from here.
 *
 * Every row is checked with zod on the way in.
 */
import { ASSET_INDEX, ASSETS_DIR } from "@studio/project";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";

export const AssetKind = z.enum(["sfx", "ambience", "riser", "hit", "whoosh", "music"]);
export type AssetKind = z.infer<typeof AssetKind>;

const JsonList = z.string().transform((s, ctx) => {
  const r = z.array(z.string()).safeParse(JSON.parse(s));
  if (!r.success) {
    ctx.addIssue({ code: "custom", message: "not a JSON list of strings" });
    return z.NEVER;
  }
  return r.data;
});

export const AssetRow = z.object({
  id: z.string(),
  file: z.string(),
  kind: AssetKind,
  tags: JsonList,
  moods: JsonList,
  description: z.string(),
  duration: z.number().positive(),
  sample_rate: z.number().int().positive(),
  channels: z.number().int().positive(),
  lufs: z.number().nullable(),
  loudest: z.number(),
  peak_db: z.number(),
  onset: z.number().min(0),
  peak_at: z.number().min(0),
  loop_start: z.number().nullable(),
  loop_end: z.number().nullable(),
  licence: z.string().min(1),
  licence_url: z.string().nullable(),
  author: z.string().nullable(),
  source_url: z.string().nullable(),
  sha256: z.string().length(64),
});
export type Asset = z.infer<typeof AssetRow> & { path: string };

export class AssetIndexError extends Error {
  override name = "AssetIndexError";
}

/** Every asset in the index; [] when the index has not been built. */
export function readAssets(index: string = ASSET_INDEX): Asset[] {
  if (!existsSync(index)) return [];
  const db = new DatabaseSync(index, { readOnly: true });
  try {
    return db
      .prepare("SELECT * FROM assets ORDER BY id")
      .all()
      .map((raw) => {
        const r = AssetRow.safeParse(raw);
        if (!r.success) throw new AssetIndexError(`assets/index.sqlite: row ${(raw as { id?: string }).id ?? "?"} is invalid: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}. Rebuild it with \`pnpm assets index\`.`);
        return { ...r.data, path: join(ASSETS_DIR, r.data.file) };
      });
  } finally {
    db.close();
  }
}

/**
 * The SFX tags Claude may write in a scene, with what they sound like. Only
 * one-shot effects: risers, hits, whooshes, ambience and music are placed by
 * the mix rules, not by Claude.
 */
export function sfxVocabulary(assets: readonly Asset[] = readAssets()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of assets.filter((x) => x.kind === "sfx")) {
    for (const tag of a.tags) out[tag] ??= a.description;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
