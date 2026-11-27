import { z } from "zod";
import { SceneId } from "./scene";
import { Energy, LoopId, ProjectId, StoryLineId } from "./story";

/**
 * The Reel cut (docs/PLAN.md section 9: "A Reel is a separate 60–90 s cut around the strongest loop").
 *
 * Claude picks which lines of a finished long video make the cut and may add at
 * most a hook line before them and an ending line after them. Everything else
 * is reused: the kept lines keep their takes (by hash), their scenes and their
 * ids. Only the new lines are voiced. The result is a child project
 * `<id>-reel`, with its own scenes, versions and edit pass.
 */
export const REEL_SECONDS = { min: 60, max: 90, target: 75 } as const;
/** A hook is one breath, an ending is one more; anything longer is a second story. */
export const REEL_NEW_LINE_WORDS = { hook: 16, ending: 22 } as const;

const NewReelLine = z.strictObject({
  text: z.string().trim().min(1).max(200).describe("What the narrator says: one breath, spoken forms only (no digits or symbols)"),
  energy: Energy,
  delivery: z.string().max(60).describe("1–4 performable words, e.g. \"hushed, slow\""),
  showScene: SceneId.describe("A scene of the full video whose picture plays under this line (its background, characters and camera are copied); pick the one that shows the thing the line is about"),
});
export type NewReelLine = z.infer<typeof NewReelLine>;

export const ReelCutOutput = z.strictObject({
  loopId: LoopId.describe("The loop the cut is built around: the strongest one for a viewer who starts here"),
  why: z.string().min(1).describe("Two or three sentences: why this loop (cite the critic's scores and the loop map) and what the cut leaves out"),
  title: z.string().min(1).max(80).describe("A working title for the Reel"),
  lineIds: z.array(StoryLineId).min(4).describe("The existing lines to keep, in script order. They may skip lines inside a loop to tighten it, and may start in the loop before, for the stakes"),
  hook: NewReelLine.nullable().describe("An optional new first line that states the stakes or the question at once; null when a kept line already does"),
  ending: NewReelLine.nullable().describe("An optional new last line that closes the loop and leaves a question open; null when the kept lines already do"),
});
export type ReelCutOutput = z.infer<typeof ReelCutOutput>;

/** projects/<child>/reel.json: where a Reel cut came from and what was chosen. */
export const ReelCutFile = z.strictObject({
  version: z.literal(1),
  parent: ProjectId,
  /** the version of the parent the cut was made from */
  parentVersion: z.int().min(1),
  createdAt: z.iso.datetime(),
  cut: ReelCutOutput,
  /** seconds of narration: what Claude's lines add up to (parent takes and pauses), and what the assembled child measures */
  seconds: z.strictObject({ estimated: z.number(), measured: z.number().nullable() }),
  /** the new lines' ids in the child, once inserted */
  newLines: z.strictObject({ hook: StoryLineId.nullable(), ending: StoryLineId.nullable() }),
});
export type ReelCutFile = z.infer<typeof ReelCutFile>;
