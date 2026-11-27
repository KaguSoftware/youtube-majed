import { z } from "zod";
import { LineId, SceneId, WordRef } from "./scene";

/**
 * Custom shots (docs/PLAN.md section 6, Phase 5): up to 3 per video, a one-off
 * Remotion component Claude writes for a moment the library cannot show well
 * (a head-fake reveal). They live in their own file per project, never inside
 * scene JSON: the scene stays the library fallback, and anything that goes
 * wrong puts the library scene back.
 *
 *   projects/<id>/custom/shots.json       the manifest below (CustomShotsFile)
 *   projects/<id>/custom/src/<hash>.tsx   every source ever written, by content hash
 *   projects/<id>/custom/stills/<id>/…    the stills each check drew, in both frames
 *   projects/<id>/custom/log.jsonl        why a shot fell back (CustomShotLogLine), append-only
 */

export const MAX_CUSTOM_SHOTS = 3;

export const CustomShotId = z.string().regex(/^C\d+$/, 'custom shot ids look like "C1"');

/**
 * - `verified`: passed every check; it is drawn in the video, and waits for your look.
 * - `accepted`: you looked and kept it; drawn in the video.
 * - `rejected`: you reverted to the library scene (or a regenerate replaced it); the library scene is drawn.
 * - `failed`: a check failed; the library scene is drawn, `reason` says why.
 */
export const CustomShotStatus = z.enum(["verified", "accepted", "rejected", "failed"]);
export type CustomShotStatus = z.infer<typeof CustomShotStatus>;
/** Statuses whose shot is drawn instead of the library scene. */
export const LIVE_STATUSES: readonly CustomShotStatus[] = ["verified", "accepted"];

export const FailureKind = z.enum(["claude", "import_rule", "typecheck", "crash", "timeout", "blank", "other"]);
export type FailureKind = z.infer<typeof FailureKind>;

/** What a scene gives its custom shot: its frames and the words' frames, all relative to the scene's first frame. */
export const ShotWord = z.strictObject({ text: z.string(), lineId: LineId, index: z.int().nonnegative(), start: z.int(), end: z.int() });
export const ShotLine = z.strictObject({ id: LineId, text: z.string(), start: z.int(), end: z.int() });
export const ShotTiming = z.strictObject({
  frames: z.int().positive(),
  fps: z.int().positive(),
  words: z.array(ShotWord),
  lines: z.array(ShotLine),
});
export type ShotWord = z.infer<typeof ShotWord>;
export type ShotLine = z.infer<typeof ShotLine>;
export type ShotTiming = z.infer<typeof ShotTiming>;

/** One run of the checks: import rule, typecheck, then the shot drawn alone in both frames. */
export const ShotCheck = z.strictObject({
  at: z.iso.datetime(),
  /** renderCodeHash() when it ran: a library change makes the check stale and it runs again before the next render */
  codeHash: z.string(),
  /** a hash of what the shot was drawn with (its scene's frames, word times and library scene): a trimmed or re-voiced scene makes the check stale too */
  inputs: z.string(),
  ok: z.boolean(),
  failure: z.strictObject({ kind: FailureKind, message: z.string() }).optional(),
  imports: z.array(z.string()),
  /** stills drawn alone, relative to custom/stills/ */
  stills: z.strictObject({ landscape: z.array(z.string()), portrait: z.array(z.string()) }),
  /** wall time of the render-alone step, both frames */
  renderMs: z.number().nonnegative(),
  warnings: z.array(z.string()),
});
export type ShotCheck = z.infer<typeof ShotCheck>;

export const ShotEvent = z.enum(["written", "verified", "failed", "accepted", "rejected", "regenerated", "restored", "rechecked"]);

export const CustomShot = z.strictObject({
  id: CustomShotId,
  sceneId: SceneId,
  status: CustomShotStatus,
  title: z.string(),
  /** what the viewer sees, and why the library cannot show it */
  idea: z.string(),
  /** the note this shot was written or regenerated with ("" if none) */
  note: z.string().default(""),
  /** sha256 (first 16 hex) of the source; the file is custom/src/<source>.tsx */
  source: z.string().regex(/^[0-9a-f]{16}$/),
  model: z.string(),
  origin: z.enum(["claude", "file"]),
  /** words the shot reacts to, as Claude declared them (each checked against the scene's words) */
  timing: z.array(z.strictObject({ at: WordRef, does: z.string() })).default([]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  check: ShotCheck.optional(),
  /** why the library scene is drawn (failed, rejected); "" for a live shot */
  reason: z.string().default(""),
  history: z.array(z.strictObject({ at: z.iso.datetime(), event: ShotEvent, detail: z.string() })).default([]),
});
export type CustomShot = z.infer<typeof CustomShot>;

export const CustomShotsFile = z
  .strictObject({ version: z.literal(1), shots: z.array(CustomShot) })
  .superRefine((f, ctx) => {
    const ids = new Set<string>();
    f.shots.forEach((s, i) => {
      if (ids.has(s.id)) ctx.addIssue({ code: "custom", path: ["shots", i, "id"], message: `duplicate custom shot id "${s.id}"` });
      ids.add(s.id);
    });
    const live = new Map<string, string>();
    f.shots.forEach((s, i) => {
      if (!LIVE_STATUSES.includes(s.status)) return;
      const other = live.get(s.sceneId);
      if (other) ctx.addIssue({ code: "custom", path: ["shots", i, "sceneId"], message: `${s.id} and ${other} are both live on scene ${s.sceneId}` });
      live.set(s.sceneId, s.id);
    });
    if (live.size > MAX_CUSTOM_SHOTS) ctx.addIssue({ code: "custom", path: ["shots"], message: `at most ${MAX_CUSTOM_SHOTS} live custom shots per video, found ${live.size}` });
  });
export type CustomShotsFile = z.infer<typeof CustomShotsFile>;

/** One line of custom/log.jsonl: every time the library scene is used in place of a shot, and why. */
export const CustomShotLogLine = z.strictObject({
  at: z.iso.datetime(),
  shot: CustomShotId,
  scene: SceneId,
  event: z.enum(["fallback", "rejected", "accepted", "verified", "regenerated", "restored", "rechecked"]),
  kind: FailureKind.optional(),
  message: z.string(),
});
export type CustomShotLogLine = z.infer<typeof CustomShotLogLine>;

// ---------------------------------------------------------------- step: customshot

/**
 * What Claude returns for one moment. The source is a complete TSX file; code
 * checks its imports, typechecks it and draws it alone before it is used.
 * `timing` names the words the shot reacts to, so code can check that they
 * exist in the scene and the editor can show them.
 */
export const CustomShotOutput = z.strictObject({
  title: z.string().trim().min(2).max(60).describe("A short name for the shot, e.g. \"The elevator light stutters\""),
  idea: z.string().trim().min(10).max(400).describe("One or two sentences: what the viewer sees, and why the library cannot show it"),
  timing: z
    .array(z.strictObject({ at: WordRef.describe('A word in this scene, "<lineId>:<wordIndex>" with the index from the input'), does: z.string().trim().min(3).max(120) }))
    .min(1)
    .max(8)
    .describe("The words the shot reacts to and what happens on each"),
  source: z.string().min(120).max(30000).describe("The complete TSX file: the default export is the component"),
});
export type CustomShotOutput = z.infer<typeof CustomShotOutput>;
