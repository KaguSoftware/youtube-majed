import { z } from "zod";

/**
 * The cross-video variety guard (docs/PLAN.md sections 6 and 12: YouTube's
 * "inauthentic content" rule means every video has to look distinct from the
 * last). Code only, no Claude call: worker/src/variety.ts reads what each
 * project's files say it used, scores the newest video against the last few,
 * lists the specific repeats and turns them into avoid-lists for the
 * storyboard step.
 *
 * THE SCORE, in two sentences. Each dimension (backgrounds, action pairs,
 * cameras, grades, …) gets a similarity from 0 to 1 against the recent videos:
 * for a mix of items (backgrounds, cameras) it is how much of the video's usage
 * mix the recent videos' pooled mix also holds (the overlap of the two
 * distributions); for a pattern (opening, ending, thumbnail framing, music
 * beds, custom shot types) it is the best Jaccard match with any single recent
 * video. The distinctness score is 100 × the weighted mean of (1 − similarity)
 * over the dimensions both sides have data for, and the verdict is read off
 * VARIETY_BANDS.
 */

export const VARIETY_DIMENSIONS = {
  backgrounds: { label: "Backgrounds", kind: "mix", weight: 18 },
  actionPairs: { label: "Action pairs", kind: "mix", weight: 14 },
  cameras: { label: "Camera moves", kind: "mix", weight: 10 },
  grades: { label: "Colour grades", kind: "mix", weight: 7 },
  shotTypes: { label: "Shot types", kind: "mix", weight: 6 },
  captions: { label: "Caption styles", kind: "mix", weight: 2 },
  musicMoods: { label: "Music moods", kind: "mix", weight: 5 },
  musicBeds: { label: "Music beds", kind: "pattern", weight: 5 },
  customShots: { label: "Custom shot types", kind: "pattern", weight: 5 },
  opening: { label: "Opening", kind: "pattern", weight: 10 },
  ending: { label: "Ending", kind: "pattern", weight: 10 },
  thumbnails: { label: "Title and thumbnail framing", kind: "pattern", weight: 8 },
} as const;
export type VarietyDimensionId = keyof typeof VARIETY_DIMENSIONS;
export const VarietyDimensionId = z.enum(Object.keys(VARIETY_DIMENSIONS) as [VarietyDimensionId, ...VarietyDimensionId[]]);
export const VARIETY_DIMENSION_IDS = Object.keys(VARIETY_DIMENSIONS) as VarietyDimensionId[];

/** Verdict bands, one place: a score at or above `distinct` is distinct, at or above `similar` is similar, below is too similar. */
export const VARIETY_BANDS = { distinct: 60, similar: 40 } as const;
export const Verdict = z.enum(["distinct", "similar", "too_similar", "first"]);
export type Verdict = z.infer<typeof Verdict>;
export function verdictOf(score: number): Exclude<Verdict, "first"> {
  return score >= VARIETY_BANDS.distinct ? "distinct" : score >= VARIETY_BANDS.similar ? "similar" : "too_similar";
}

/** How many earlier videos a new one is compared with. */
export const VARIETY_AGAINST = { min: 1, max: 6, default: 4 } as const;

const Counts = z.record(z.string(), z.int().positive());

/** What one video used, read from its files (worker/src/variety.ts). Everything is optional-tolerant: a missing piece is an empty field. */
export const VarietyFeatures = z.strictObject({
  id: z.string(),
  /** when its storyboard was made: the order of "last N videos" */
  at: z.string(),
  format: z.enum(["youtube", "reel", "unknown"]),
  scenes: z.int().nonnegative(),
  backgrounds: Counts,
  /** per scene, the sorted set of its characters' actions joined with "+" (a lone `idle` is the default and is left out) */
  actionPairs: Counts,
  cameras: Counts,
  grades: Counts,
  /** transitions, framings, weather and overlay styles, prefixed with their kind: `transition:whoosh_wipe` */
  shotTypes: Counts,
  captions: Counts,
  musicMoods: Counts,
  /** music files the mix used (empty until the project is mixed) */
  musicBeds: z.array(z.string()),
  /** one type per live custom shot: the slug of its title */
  customShots: z.array(z.strictObject({ id: z.string(), type: z.string(), title: z.string(), sceneId: z.string(), at: z.number().min(0).max(1) })),
  /** the first and last three shots as `background|actions|camera` signatures, and the first and last overlay */
  opening: z.array(z.string()),
  ending: z.array(z.string()),
  /** the ending twist's shot and the first head-fake shot (thumbnail moments), `background|framing|camera|characters`, plus the title card style */
  thumbnails: z.array(z.string()),
});
export type VarietyFeatures = z.infer<typeof VarietyFeatures>;

export const VarietyRepeat = z.strictObject({
  dimension: VarietyDimensionId,
  item: z.string(),
  /** the earlier videos that used it too, newest first */
  usedIn: z.array(z.string()),
  /** the share of this video's scenes (mix dimensions), or the best match 0–1 (pattern dimensions) */
  share: z.number().min(0).max(1),
  message: z.string(),
});
export type VarietyRepeat = z.infer<typeof VarietyRepeat>;

export const VarietyDimensionScore = z.strictObject({
  dimension: VarietyDimensionId,
  /** 0–1 against the recent videos; null when this video or all of them have no data for it */
  similarity: z.number().min(0).max(1).nullable(),
  /** 0–100, 100 − similarity × 100 (null with similarity) */
  distinct: z.number().min(0).max(100).nullable(),
  weight: z.number(),
  /** the most-used items of this video here, for the bar's caption */
  top: z.array(z.string()),
});
export type VarietyDimensionScore = z.infer<typeof VarietyDimensionScore>;

/** What recent videos overused, as plain lists the storyboard step reads as strong preferences. Empty lists are omitted by the caller. */
export const AvoidLists = z.strictObject({
  /** the videos these lists come from, newest first */
  against: z.array(z.string()),
  backgrounds: z.array(z.string()),
  actionPairs: z.array(z.string()),
  cameras: z.array(z.string()),
  grades: z.array(z.string()),
  captions: z.array(z.string()),
  musicMoods: z.array(z.string()),
  /** the recent videos' first picture: don't open on the same one (`background|actions|camera`) */
  openings: z.array(z.string()),
  endings: z.array(z.string()),
  /** the recent videos' thumbnail moments (`background|framing|camera|characters`) */
  thumbnails: z.array(z.string()),
});
export type AvoidLists = z.infer<typeof AvoidLists>;

export const VarietyReport = z.strictObject({
  version: z.literal(1),
  project: z.string(),
  createdAt: z.iso.datetime(),
  /** the earlier videos compared with, newest first; empty for the first video */
  against: z.array(z.string()),
  /** 0–100, null when there is nothing to compare with */
  score: z.number().min(0).max(100).nullable(),
  verdict: Verdict,
  dimensions: z.array(VarietyDimensionScore),
  repeats: z.array(VarietyRepeat),
  /** what the storyboard step was asked to avoid (the lists derived from `against`) */
  avoid: AvoidLists.nullable(),
  features: VarietyFeatures,
});
export type VarietyReport = z.infer<typeof VarietyReport>;

/** What a storyboard run changed. `previous` is the project's own earlier storyboard (a rerun), `firstPass` Claude's draft before the code passes. */
export const VarietySwap = z.strictObject({ sceneId: z.string(), what: z.string() });
export const VarietyFile = z.strictObject({
  version: z.literal(1),
  createdAt: z.iso.datetime(),
  against: z.array(z.string()),
  avoid: AvoidLists.nullable(),
  /** the report of Claude's assembled draft, before the camera and avoid-list passes */
  firstPass: VarietyReport,
  final: VarietyReport,
  /** the report of the project's previous storyboard (a rerun); null the first time */
  previous: VarietyReport.nullable(),
  swaps: z.array(VarietySwap),
});
export type VarietyFile = z.infer<typeof VarietyFile>;

/** `pnpm variety all`: every storyboarded project against the videos before it. */
export const VarietyAllFile = z.strictObject({
  version: z.literal(1),
  createdAt: z.iso.datetime(),
  against: z.int(),
  bands: z.strictObject({ distinct: z.number(), similar: z.number() }),
  reports: z.array(VarietyReport),
  /** projects with no storyboard yet, and why they are left out */
  skipped: z.array(z.strictObject({ id: z.string(), reason: z.string() })),
});
export type VarietyAllFile = z.infer<typeof VarietyAllFile>;
