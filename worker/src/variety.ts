/**
 * The cross-video variety guard (docs/PLAN.md sections 6 and 12), code only.
 *
 *   features   what a video used: backgrounds, action pairs, cameras, grades,
 *              shot types, caption styles, music, custom shots, opening,
 *              ending, thumbnail framing. Read tolerantly from the files on
 *              disk, so a project missing its mix or its storyboard report
 *              still has features.
 *   score      distinctness 0–100 against the last N earlier videos, with the
 *              specific repeats (see packages/schema/src/variety.ts for the
 *              definition and VARIETY_BANDS for the verdicts).
 *   avoid      the same history as plain lists the storyboard step reads as
 *              strong preferences.
 *
 * "Earlier video" means another storyboarded project whose storyboard is older
 * than this one's, newest first. A Reel cut and the long video it came from are
 * one story, so they are never compared with each other.
 */
import { projectPaths, projectsDir, readJson, storyboardPaths } from "@studio/project";
import {
  AvoidLists,
  CustomShotsFile,
  LIVE_STATUSES,
  VARIETY_AGAINST,
  VARIETY_BANDS,
  VARIETY_DIMENSIONS,
  VARIETY_DIMENSION_IDS,
  VarietyAllFile,
  VarietyReport,
  verdictOf,
  type VarietyDimensionId,
  type VarietyFeatures,
} from "@studio/schema";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

// ---------------------------------------------------------------- reading what a project used

/** The fields of a scene the guard reads. Loose on purpose: a library that grew since the scene was written is no reason to lose its history. */
const LooseScene = z.looseObject({
  id: z.string().optional(),
  lineIds: z.array(z.string()).default([]),
  bg: z.string(),
  grade: z.string().default("unknown"),
  camera: z.string().default("static"),
  transitionIn: z.string().default("cut"),
  caption: z.string().default("none"),
  framing: z.string().optional(),
  weather: z.string().optional(),
  chars: z.array(z.looseObject({ id: z.string(), action: z.string() })).default([]),
  overlays: z.array(z.looseObject({ style: z.string() })).default([]),
});
export type LooseScene = z.infer<typeof LooseScene>;

const Loose = {
  scenes: z.looseObject({ scenes: z.array(LooseScene) }),
  report: z.looseObject({ createdAt: z.string().optional(), music: z.array(z.looseObject({ mood: z.string() })).default([]), reveals: z.array(z.looseObject({ lineId: z.string() })).default([]) }),
  brief: z.looseObject({ format: z.string().optional(), createdAt: z.string().optional() }),
  mix: z.looseObject({ cues: z.array(z.looseObject({ kind: z.string(), asset: z.string().optional() })).default([]) }),
  reel: z.looseObject({ parent: z.string() }),
};

function readLoose<S extends z.ZodType>(file: string, schema: S): z.output<S> | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const r = schema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return r.success ? r.data : undefined;
  } catch {
    return undefined;
  }
}

const bump = (c: Record<string, number>, key: string) => {
  c[key] = (c[key] ?? 0) + 1;
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "shot";

/** A scene's actions: sorted, unique, joined with "+"; "none" with no characters. */
const actionsOf = (s: LooseScene) => [...new Set(s.chars.map((c) => c.action))].sort().join("+") || "none";
/** The picture of a shot, as the storyboard's own combo check sees it. */
export const signatureOf = (s: LooseScene) => `${s.bg}|${actionsOf(s)}|${s.camera}`;

export type FeatureExtras = {
  at: string;
  format?: VarietyFeatures["format"];
  /** music moods per loop */
  moods?: string[];
  /** music files the mix used */
  beds?: string[];
  /** line ids of the head-fake reveals, in script order */
  reveals?: string[];
  customShots?: VarietyFeatures["customShots"];
};

/** Features from a list of scenes. Used on files on disk and on the storyboard's draft before it is written. */
export function featuresFromScenes(id: string, scenes: readonly LooseScene[], x: FeatureExtras): VarietyFeatures {
  const f: VarietyFeatures = {
    id,
    at: x.at,
    format: x.format ?? "unknown",
    scenes: scenes.length,
    backgrounds: {},
    actionPairs: {},
    cameras: {},
    grades: {},
    shotTypes: {},
    captions: {},
    musicMoods: {},
    musicBeds: [...new Set(x.beds ?? [])].sort(),
    customShots: x.customShots ?? [],
    opening: [],
    ending: [],
    thumbnails: [],
  };
  for (const s of scenes) {
    bump(f.backgrounds, s.bg);
    const acts = actionsOf(s);
    if (acts !== "none" && acts !== "idle") bump(f.actionPairs, acts);
    bump(f.cameras, s.camera);
    bump(f.grades, s.grade);
    if (s.transitionIn !== "cut") bump(f.shotTypes, `transition:${s.transitionIn}`);
    if (s.framing) bump(f.shotTypes, `framing:${s.framing}`);
    if (s.weather) bump(f.shotTypes, `weather:${s.weather}`);
    for (const o of s.overlays) bump(f.shotTypes, `overlay:${o.style}`);
    if (s.caption !== "none") bump(f.captions, s.caption);
  }
  for (const m of x.moods ?? []) bump(f.musicMoods, m);

  const title = scenes.flatMap((s) => s.overlays).find((o) => o.style === "title_card");
  const titleToken = title ? [`title:${title.style}`] : [];
  f.opening = [...scenes.slice(0, 3).map(signatureOf), ...titleToken];
  const last = scenes.at(-1);
  f.ending = [...scenes.slice(-3).map(signatureOf), ...(last ? [`out:${last.transitionIn}`] : [])];

  const carries = (lineId: string) => scenes.find((s) => s.lineIds.includes(lineId));
  const reveals = (x.reveals ?? []).map(carries).filter((s): s is LooseScene => Boolean(s));
  const moments = [...new Set([reveals.at(-1) ?? last, reveals[0]])].filter((s): s is LooseScene => Boolean(s));
  f.thumbnails = [...moments.map((s) => `${s.bg}|${s.framing ?? "wide"}|${s.camera}|chars:${s.chars.length}`), ...titleToken];
  return f;
}

/** Features of a project from its files; undefined when it has no storyboard. */
export function loadFeatures(id: string): VarietyFeatures | undefined {
  const sb = storyboardPaths(id);
  const file = readLoose(sb.scenes, Loose.scenes);
  if (!file) return undefined;
  const report = readLoose(sb.report, Loose.report);
  const p = projectPaths(id);
  const brief = readLoose(join(p.dir, "brief.json"), Loose.brief);
  const mix = readLoose(join(p.audioDir, "mixplan.json"), Loose.mix);
  const at = report?.createdAt ?? brief?.createdAt ?? statSync(sb.scenes).mtime.toISOString();
  const format = brief?.format === "youtube" || brief?.format === "reel" ? brief.format : "unknown";

  let customShots: VarietyFeatures["customShots"] = [];
  try {
    const shots = readJson(join(p.dir, "custom", "shots.json"), CustomShotsFile);
    const n = Math.max(1, file.scenes.length - 1);
    customShots = (shots?.shots ?? [])
      .filter((s) => LIVE_STATUSES.includes(s.status))
      .map((s) => ({ id: s.id, type: slug(s.title), title: s.title, sceneId: s.sceneId, at: Math.min(1, Math.max(0, file.scenes.findIndex((x) => x.id === s.sceneId) / n)) }));
  } catch {
    customShots = []; // a manifest that does not parse is the custom-shot step's problem, not a reason to lose the report
  }

  return featuresFromScenes(id, file.scenes, {
    at,
    format,
    moods: report?.music.map((m) => m.mood),
    beds: mix?.cues.filter((c) => c.kind === "music" && c.asset).map((c) => c.asset!),
    reveals: report?.reveals.map((r) => r.lineId),
    customShots,
  });
}

// ---------------------------------------------------------------- history

/** Every storyboarded project's features, newest storyboard first. */
export function allFeatures(): VarietyFeatures[] {
  const dir = projectsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => {
      try {
        const f = loadFeatures(d.name);
        return f ? [f] : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** The long video a Reel cut came from, if this project is one. */
const parentOf = (id: string) => readLoose(join(projectPaths(id).dir, "reel.json"), Loose.reel)?.parent;
const related = (a: string, b: string) => a === b || parentOf(a) === b || parentOf(b) === a || (parentOf(a) !== undefined && parentOf(a) === parentOf(b));

/** The `n` videos before `id` (older than `before`, if given), newest first, leaving out the project itself and its Reel cuts. */
export function historyOf(id: string, o: { against?: number; before?: string; pool?: VarietyFeatures[] } = {}): VarietyFeatures[] {
  const n = Math.max(VARIETY_AGAINST.min, Math.min(VARIETY_AGAINST.max, o.against ?? VARIETY_AGAINST.default));
  const pool = o.pool ?? allFeatures();
  return pool
    // a Reel cut is its long video's story again: when both are in the pool, only the long video counts
    .filter((f) => !related(f.id, id) && (!o.before || f.at < o.before) && !pool.some((x) => x.id === parentOf(f.id)))
    .slice(0, n);
}

// ---------------------------------------------------------------- the score

const total = (c: Record<string, number>) => Object.values(c).reduce((s, v) => s + v, 0);
const normalised = (c: Record<string, number>) => {
  const t = total(c);
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v / t]));
};
const jaccard = (a: readonly string[], b: readonly string[]) => {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size && !B.size) return 0;
  const both = [...A].filter((x) => B.has(x)).length;
  return both / (A.size + B.size - both);
};

const MIX_KEYS = { backgrounds: "backgrounds", actionPairs: "actionPairs", cameras: "cameras", grades: "grades", shotTypes: "shotTypes", captions: "captions", musicMoods: "musicMoods" } as const;
type MixDimension = keyof typeof MIX_KEYS;
const isMix = (d: VarietyDimensionId): d is MixDimension => d in MIX_KEYS;
/**
 * A shot signature `a|b|c` becomes the whole signature plus each part with its position (`0:office`, `2:static`), so two
 * openings that share the place and the camera but not the action are partly alike, and an identical shot counts fully.
 */
const tokens = (xs: readonly string[]) => xs.flatMap((x) => (x.includes("|") ? [x, ...x.split("|").map((part, i) => `${i}:${part}`)] : [x]));
const PATTERN_KEYS = {
  musicBeds: (f: VarietyFeatures) => f.musicBeds,
  customShots: (f: VarietyFeatures) => f.customShots.map((s) => s.type),
  opening: (f: VarietyFeatures) => tokens(f.opening),
  ending: (f: VarietyFeatures) => tokens(f.ending),
  thumbnails: (f: VarietyFeatures) => tokens(f.thumbnails),
} as const;

/** The mean of the earlier videos' normalised mixes: what "recent usage" looks like. */
function pooled(history: readonly VarietyFeatures[], dim: MixDimension): Record<string, number> {
  const withData = history.filter((h) => total(h[dim]) > 0);
  const out: Record<string, number> = {};
  for (const h of withData) for (const [k, v] of Object.entries(normalised(h[dim]))) out[k] = (out[k] ?? 0) + v / withData.length;
  return out;
}

/** The overlap of two distributions: 1 when the video uses its items in the same proportions as the recent ones. */
function mixSimilarity(f: VarietyFeatures, history: readonly VarietyFeatures[], dim: MixDimension): number | null {
  if (!total(f[dim])) return null;
  const q = pooled(history, dim);
  if (!Object.keys(q).length) return null;
  return Object.entries(normalised(f[dim])).reduce((s, [k, p]) => s + Math.min(p, q[k] ?? 0), 0);
}

/** The best Jaccard match with any single earlier video (an identical ending as any recent video is a repeat). */
function patternSimilarity(f: VarietyFeatures, history: readonly VarietyFeatures[], dim: keyof typeof PATTERN_KEYS): number | null {
  const mine = PATTERN_KEYS[dim](f);
  if (!mine.length) return null;
  const theirs = history.map((h) => PATTERN_KEYS[dim](h)).filter((t) => t.length);
  // a custom shot type nobody used before is fully new; for the others no data on the other side means no verdict
  if (!theirs.length) return dim === "customShots" ? 0 : null;
  return Math.max(...theirs.map((t) => jaccard(mine, t)));
}

const topOf = (f: VarietyFeatures, dim: VarietyDimensionId): string[] => {
  if (isMix(dim)) return Object.entries(f[dim]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${Math.round((v / total(f[dim])) * 100)}%`);
  const shown = dim === "opening" ? f.opening : dim === "ending" ? f.ending : dim === "thumbnails" ? f.thumbnails : PATTERN_KEYS[dim as "musicBeds" | "customShots"](f);
  return shown.slice(0, 3);
};

const MIN_SHARE = 0.05;
/** A small vocabulary (cameras, grades, caption styles…) repeats by nature: report only its two strongest. */
const MAX_REPEATS: Record<VarietyDimensionId, number> = { backgrounds: 4, actionPairs: 4, cameras: 2, grades: 2, shotTypes: 2, captions: 1, musicMoods: 2, musicBeds: 2, customShots: 2, opening: 2, ending: 2, thumbnails: 2 };
/** Library defaults: every video uses them, so they are not a sign of a copied look. */
const DEFAULTS: Partial<Record<VarietyDimensionId, string[]>> = { cameras: ["static"], captions: ["word_pop"] };

/** The specific repeats: items this video leans on that recent videos used too, and openings, endings and framings that match one. */
function repeatsOf(f: VarietyFeatures, history: readonly VarietyFeatures[]): VarietyReport["repeats"] {
  const out: VarietyReport["repeats"] = [];
  const n = history.length;
  const need = Math.min(n, 2);
  for (const dim of VARIETY_DIMENSION_IDS) {
    const found: { r: VarietyReport["repeats"][number]; rank: number }[] = [];
    if (isMix(dim)) {
      const t = total(f[dim]);
      for (const [item, count] of Object.entries(f[dim])) {
        const share = count / t;
        if (share < MIN_SHARE || count < 2 || DEFAULTS[dim]?.includes(item)) continue;
        const usedIn = history.filter((h) => (h[dim][item] ?? 0) > 0).map((h) => h.id);
        if (usedIn.length < need || !usedIn.length) continue;
        found.push({
          rank: share * usedIn.length,
          r: { dimension: dim, item, usedIn, share, message: `${item}: ${Math.round(share * 100)}% of this video's ${dim === "musicMoods" ? "loops" : "scenes"}, and ${n === 1 ? `in the previous video (${usedIn[0]})` : `in ${usedIn.length} of the last ${n} videos (${usedIn.join(", ")})`}` },
        });
      }
    } else {
      const raw = (x: VarietyFeatures) => (dim === "opening" ? x.opening : dim === "ending" ? x.ending : dim === "thumbnails" ? x.thumbnails : PATTERN_KEYS[dim as "musicBeds" | "customShots"](x));
      const mine = raw(f);
      for (const h of history) {
        const theirs = raw(h);
        const j = jaccard(PATTERN_KEYS[dim](f), PATTERN_KEYS[dim](h));
        const shared = mine.filter((x) => theirs.includes(x));
        if (!mine.length || (!shared.length && j < 0.5)) continue;
        const sig = (xs: readonly string[]) => (dim === "ending" ? xs.filter((x) => x.includes("|")).at(-1) : xs[0]);
        const sameEdge = (dim === "opening" || dim === "ending") && sig(mine) !== undefined && sig(mine) === sig(theirs);
        if ((dim === "opening" || dim === "ending") && j < 0.5 && !sameEdge) continue;
        const what =
          dim === "opening" ? (sameEdge ? `opens on the same picture as ${h.id} (${mine[0]})` : `opening is ${Math.round(j * 100)}% the same as ${h.id}'s (${shared.length ? `shared: ${shared.join(", ")}` : "same places and cameras"})`)
          : dim === "ending" ? (j === 1 ? `identical ending pattern as ${h.id}` : sameEdge ? `ends on the same picture as ${h.id} (${sig(mine)})` : `ending is ${Math.round(j * 100)}% the same as ${h.id}'s`)
          : dim === "thumbnails" ? `thumbnail framing matches ${h.id}: ${shared.join(", ")}`
          : dim === "musicBeds" ? `same music bed as ${h.id}: ${shared.join(", ")}`
          : `same custom shot type as ${h.id}: ${shared.join(", ")}`;
        found.push({ rank: j, r: { dimension: dim, item: shared.join(" + ") || "pattern", usedIn: [h.id], share: j, message: what } });
      }
    }
    found.sort((a, b) => b.rank - a.rank);
    out.push(...found.slice(0, MAX_REPEATS[dim]).map((x) => x.r));
  }
  return out;
}

export type ScoreOptions = { avoid?: AvoidLists | null; now?: Date };

/** Scores a video's features against earlier videos' (newest first). */
export function scoreFeatures(project: string, f: VarietyFeatures, history: readonly VarietyFeatures[], o: ScoreOptions = {}): VarietyReport {
  const dimensions = VARIETY_DIMENSION_IDS.map((dimension) => {
    const similarity = history.length ? (isMix(dimension) ? mixSimilarity(f, history, dimension) : patternSimilarity(f, history, dimension as keyof typeof PATTERN_KEYS)) : null;
    return {
      dimension,
      similarity: similarity === null ? null : Math.round(similarity * 1000) / 1000,
      distinct: similarity === null ? null : Math.round((1 - similarity) * 1000) / 10,
      weight: VARIETY_DIMENSIONS[dimension].weight,
      top: topOf(f, dimension),
    };
  });
  const used = dimensions.filter((d) => d.distinct !== null);
  const weight = used.reduce((s, d) => s + d.weight, 0);
  const score = history.length && weight ? Math.round((used.reduce((s, d) => s + d.weight * d.distinct!, 0) / weight) * 10) / 10 : null;
  return VarietyReport.parse({
    version: 1,
    project,
    createdAt: (o.now ?? new Date()).toISOString(),
    against: history.map((h) => h.id),
    score,
    verdict: score === null ? "first" : verdictOf(score),
    dimensions,
    repeats: history.length ? repeatsOf(f, history) : [],
    avoid: o.avoid ?? null,
    features: f,
  });
}

// ---------------------------------------------------------------- avoid-lists

/** How many items of a section may be avoided: never more than half of a small library, or the video would have nothing left to use. */
const AVOID_CAP = { backgrounds: 5, actionPairs: 6, cameras: 2, grades: 2, musicMoods: 2 } as const;
const AVOID_MIN_SHARE = 0.08;
/** Library defaults that every video uses by design (the plan-scenes skill: "static is the default and the most common"): reported nowhere, steered nowhere. */
const NEVER_AVOID: Partial<Record<MixDimension, string[]>> = { cameras: ["static"], captions: ["word_pop"] };

/** What the earlier videos overused: items in at least two of them (or the one, if there is one) with a real share of their scenes. Null with no history. */
export function avoidFrom(history: readonly VarietyFeatures[]): AvoidLists | null {
  if (!history.length) return null;
  const need = Math.min(history.length, 2);
  const pick = (dim: MixDimension, cap: number): string[] => {
    const q = pooled(history, dim);
    return Object.entries(q)
      .filter(([item, share]) => !NEVER_AVOID[dim]?.includes(item) && share >= AVOID_MIN_SHARE && history.filter((h) => (h[dim][item] ?? 0) > 0).length >= need)
      .sort((a, b) => b[1] - a[1])
      .slice(0, cap)
      .map(([k]) => k);
  };
  const first = <T>(xs: T[]) => (xs.length ? [xs[0]!] : []);
  const uniq = (xs: string[]) => [...new Set(xs)];
  return AvoidLists.parse({
    against: history.map((h) => h.id),
    backgrounds: pick("backgrounds", AVOID_CAP.backgrounds),
    actionPairs: pick("actionPairs", AVOID_CAP.actionPairs),
    cameras: pick("cameras", AVOID_CAP.cameras),
    grades: pick("grades", AVOID_CAP.grades),
    captions: [], // the caption style is the series identity (word_pop on every scene): reported, never steered
    musicMoods: pick("musicMoods", AVOID_CAP.musicMoods),
    openings: uniq(history.flatMap((h) => first(h.opening))),
    endings: uniq(history.flatMap((h) => h.ending.filter((x) => x.includes("|")).slice(-1))),
    thumbnails: uniq(history.flatMap((h) => h.thumbnails.filter((x) => x.includes("|")))),
  });
}

/** The avoid-lists as the storyboard steps' input: omitted entirely when there is nothing to avoid, so a first video's input is unchanged. */
export function avoidInput(a: AvoidLists | null): Omit<AvoidLists, "against"> & { against: string[]; note: string } | undefined {
  if (!a) return undefined;
  const any = [a.backgrounds, a.actionPairs, a.cameras, a.grades, a.captions, a.musicMoods, a.openings, a.endings, a.thumbnails].some((l) => l.length);
  if (!any) return undefined;
  return { ...a, note: "Recent videos leaned on these. Treat each list as a strong preference to pick something else, unless the story demands it (a place the story needs, a grade for its time of day)." };
}

// ---------------------------------------------------------------- reports

/** The report of a project as it is now, against the `against` videos before it. Undefined when it has no storyboard. */
export function varietyReport(id: string, o: { against?: number; pool?: VarietyFeatures[] } = {}): VarietyReport | undefined {
  const pool = o.pool ?? allFeatures();
  const f = pool.find((x) => x.id === id) ?? loadFeatures(id);
  if (!f) return undefined;
  const history = historyOf(id, { against: o.against, before: f.at, pool });
  return scoreFeatures(id, f, history, { avoid: avoidFrom(history) });
}

/** Every storyboarded project against the videos before it, and the projects left out. */
export function varietyAll(o: { against?: number } = {}): VarietyAllFile {
  const pool = allFeatures();
  const against = Math.max(VARIETY_AGAINST.min, Math.min(VARIETY_AGAINST.max, o.against ?? VARIETY_AGAINST.default));
  const reports = [...pool].reverse().map((f) => varietyReport(f.id, { against, pool })!);
  const dir = projectsDir();
  const skipped = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !pool.some((f) => f.id === d.name))
        .map((d) => ({ id: d.name, reason: existsSync(join(dir, d.name, "script.json")) || existsSync(join(dir, d.name, "story")) ? "no storyboard yet" : "no scenes" }))
    : [];
  return VarietyAllFile.parse({ version: 1, createdAt: new Date().toISOString(), against, bands: VARIETY_BANDS, reports, skipped });
}

/** A readable table of `varietyAll`, for the terminal and the saved proof. */
export function allTable(all: VarietyAllFile): string {
  const lines = [`Distinctness against the ${all.against} videos before each (distinct ≥ ${all.bands.distinct}, similar ≥ ${all.bands.similar}, otherwise too similar)`, ""];
  const w = Math.max(...all.reports.map((r) => r.project.length), 7);
  lines.push(`${"video".padEnd(w)}  score  verdict      against`);
  for (const r of all.reports) lines.push(`${r.project.padEnd(w)}  ${(r.score === null ? "—" : r.score.toFixed(1)).padStart(5)}  ${r.verdict.replace("_", " ").padEnd(11)}  ${r.against.join(", ") || "(first video)"}`);
  for (const r of all.reports) {
    lines.push("", `${r.project}: ${r.score === null ? "first video, nothing to compare with" : `${r.score.toFixed(1)} ${r.verdict.replace("_", " ")}`}`);
    for (const d of r.dimensions) lines.push(`  ${VARIETY_DIMENSIONS[d.dimension].label.padEnd(28)} ${d.distinct === null ? "—".padStart(5) : d.distinct.toFixed(0).padStart(5)}  ${d.top.join(", ")}`);
    for (const x of r.repeats) lines.push(`  ↺ ${VARIETY_DIMENSIONS[x.dimension].label.toLowerCase()}: ${x.message}`);
  }
  if (all.skipped.length) lines.push("", `Left out: ${all.skipped.map((s) => `${s.id} (${s.reason})`).join(", ")}`);
  return lines.join("\n") + "\n";
}
