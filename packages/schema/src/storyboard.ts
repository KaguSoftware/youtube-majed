import { z } from "zod";

/**
 * The storyboard step (docs/PLAN.md sections 2 step 6, and 6): Claude turns
 * the locked script into scene JSON, code checks and repairs it.
 *
 * Two `claude -p` steps, both in the `plan-scenes` skill:
 *
 * - `cast`: once per video. Who is on screen (looks), where each loop
 *   happens, the time of day, a music mood per loop, and how each plant is
 *   shown. Every batch gets this, so batches agree with each other.
 * - `storyboard`: scenes for one batch of lines (one or more whole loops),
 *   and again for the few scenes code could not repair.
 *
 * Library ids here are plain strings, not enums over the catalogue: the
 * catalogue grows while these JSON Schemas stay fixed, and an unknown id is
 * not a reason to throw a whole batch away. Code maps each id to the closest
 * library item and flags it (worker/src/storyboard.ts); the result is then
 * checked with the strict `SceneFile` schema from scene.ts.
 *
 * As in story.ts, every field of a step output is required ("" or [] where
 * there is nothing to say): structured output is more reliable that way.
 */

const Slug = z.string().regex(/^[a-z0-9_]+$/, "ids are lower_snake_case");
const LineRef = z.string().regex(/^L\d+\.\d+$/, 'line ids look like "L3.4"');
const WordRef = z.string().regex(/^L\d+\.\d+:\d+$/, 'expected "<lineId>:<wordIndex>", e.g. "L3.4:0"');

// ---------------------------------------------------------------- step: cast

export const CastPlanMember = z.strictObject({
  id: Slug.describe('lower_snake_case id used in every scene, e.g. "keeper"'),
  name: z.string().min(1).describe('The name viewers hear, or "?" for someone unknown'),
  role: z.string().min(1).describe("Who this is in the story, in a few words"),
  look: z
    .string()
    .min(2)
    .describe("The character's look as one JSON object that follows `castLook` in the input (every field but name), e.g. {\"color\":\"#d0473d\",\"hat\":\"keeper_cap\"}"),
});
export type CastPlanMember = z.infer<typeof CastPlanMember>;

export const LoopLook = z.strictObject({
  loopId: z.string().regex(/^L\d+$/),
  locations: z.array(Slug).min(1).max(4).describe("Background ids this loop uses, in order of appearance"),
  grade: Slug.describe("Colour grade id (time of day) the loop starts in"),
  music: Slug.describe("Music mood for this loop, from the moods list"),
  intent: z.string().min(1).describe("One sentence: what the pictures must make the viewer feel or notice in this loop"),
});
export type LoopLook = z.infer<typeof LoopLook>;

export const PlantShot = z.strictObject({
  plantId: z.string().regex(/^P\d+$/),
  show: z.string().min(1).describe("How the plant is visible on screen: the prop, action or expression that carries it"),
  props: z.array(Slug).describe("Prop ids that carry it; [] if none fits"),
});

export const CastOutput = z
  .strictObject({
    cast: z.array(CastPlanMember).min(1).max(8),
    loops: z.array(LoopLook).min(1),
    plants: z.array(PlantShot),
    style: z.string().min(1).describe("One sentence: the visual through-line of this video"),
  })
  .superRefine((o, ctx) => {
    const seen = new Set<string>();
    o.cast.forEach((c, i) => {
      if (seen.has(c.id)) ctx.addIssue({ code: "custom", path: ["cast", i, "id"], message: `cast id "${c.id}" is used twice` });
      seen.add(c.id);
    });
  });
export type CastOutput = z.infer<typeof CastOutput>;

// ---------------------------------------------------------------- step: storyboard

export const DraftChar = z.strictObject({
  id: Slug.describe("A cast id"),
  action: Slug,
  expr: Slug,
  pos: Slug,
  to: z.string().describe('Where a travelling action ends up (a position id), or ""'),
  facing: z.enum(["auto", "left", "right"]).describe('"auto" faces the centre or the direction of travel'),
  look: z.enum(["normal", "silhouette"]),
});
export type DraftChar = z.infer<typeof DraftChar>;

export const DraftProp = z.strictObject({
  id: Slug,
  attach: z.string().describe('"<castId>.hand_r" / ".hand_l" / ".head" for a held prop, or ""'),
  pos: z.string().describe('A position id for a prop that stands on its own, or ""'),
});
export type DraftProp = z.infer<typeof DraftProp>;

export const DraftSfx = z.strictObject({
  tag: Slug.describe("A sound tag from the sfx list"),
  at: WordRef.describe("The word it lands on, as <lineId>:<wordIndex> (0 = first word)"),
});

export const DraftScene = z.strictObject({
  lineIds: z.array(LineRef).min(1).describe("Consecutive script lines this shot covers, in order"),
  bg: Slug,
  grade: Slug,
  chars: z.array(DraftChar).max(4),
  props: z.array(DraftProp),
  camera: Slug,
  transitionIn: Slug,
  caption: Slug,
  sfx: z.array(DraftSfx),
  why: z.string().describe("A few words: what this shot does (establish, react, reveal, plant…)"),
});
export type DraftScene = z.infer<typeof DraftScene>;

export const Reveal = z.strictObject({
  lineId: LineRef.describe("A head-fake line"),
  at: WordRef.describe("The word where the truth lands"),
  kind: z.enum(["hit", "silence"]).describe("hit = an impact on the word; silence = everything but the voice drops out"),
});
export type Reveal = z.infer<typeof Reveal>;

export const StoryboardOutput = z.strictObject({
  scenes: z.array(DraftScene).min(1),
  reveals: z.array(Reveal).describe("One per head-fake line in this batch"),
});
export type StoryboardOutput = z.infer<typeof StoryboardOutput>;

// ---------------------------------------------------------------- files: projects/<id>/storyboard/

/**
 * What code did to Claude's draft. `mapped`: an unknown id replaced by the
 * closest library item. `repaired`: a fix code could make without changing
 * the shot's meaning. `payoff`: a head-fake line given its own reveal shot.
 * `variety`: a variety-guard hit (`fixed` says whether code fixed it).
 * `regenerated`: a scene Claude wrote again because code could not repair it.
 */
export const StoryboardFlag = z.strictObject({
  sceneId: z.string(),
  kind: z.enum(["mapped", "repaired", "payoff", "variety", "regenerated", "fallback", "dropped"]),
  message: z.string(),
  fixed: z.boolean(),
});
export type StoryboardFlag = z.infer<typeof StoryboardFlag>;

export const StoryboardFile = z.strictObject({
  version: z.literal(1),
  createdAt: z.iso.datetime(),
  /** Hash of the catalogue the scenes were written against: a changed library makes them stale. */
  catalogue: z.string(),
  source: z.enum(["narration", "script"]),
  style: z.string(),
  music: z.array(z.strictObject({ loopId: z.string(), mood: z.string() })),
  reveals: z.array(Reveal),
  batches: z.array(z.strictObject({ loopIds: z.array(z.string()), lines: z.int(), scenes: z.int() })),
  flags: z.array(StoryboardFlag),
  /** Combos (background · actions · camera) this video uses, for the cross-video variety guard. */
  combos: z.array(z.string()),
  stats: z.strictObject({
    scenes: z.int(),
    lines: z.int(),
    seconds: z.number(),
    timedBy: z.enum(["voice", "estimate"]),
    regenerated: z.int(),
    varietyHits: z.int(),
    varietyFixed: z.int(),
    mappedIds: z.int(),
  }),
});
export type StoryboardFile = z.infer<typeof StoryboardFile>;
