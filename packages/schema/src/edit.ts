import { z } from "zod";
import { libraryId } from "./ids";
import { CastId, CharInScene, LineId, OverlayInScene, PropInScene, Scene, SceneId, WordRef } from "./scene";
import { DraftScene } from "./storyboard";
import { FxPreset } from "./voice";

/**
 * The edit engine (docs/PLAN.md section 8): every change works on project
 * data, never on the MP4. An edit is a list of operations, applied to a draft
 * copy of the current version, checked, and committed as a new version.
 * Only what an operation touches is redone: a changed line is voiced again,
 * the track is re-assembled, the mix re-planned, and only render segments
 * whose pictures changed are drawn again.
 *
 * Scenes still carry no timing: an operation never sets a time. Positions are
 * lines, scenes and words ("L3.4:2" = word 2 of line L3.4).
 *
 * Locked script lines change only through `line.set`, `line.delete` or a
 * `scene.delete` with `lines: "cut"` (all explicit about the narration);
 * nothing else in an edit may alter a line's text.
 */

const Anchor = z.union([LineId, SceneId]);
const Label = z.string().trim().min(1).max(80);

/** A new narration line. Its id is chosen by the engine: the next free number in the loop it lands in. */
export const NewLine = z.strictObject({
  text: z.string().trim().min(1).max(300),
  energy: z.int().min(1).max(5).default(3),
  delivery: z.string().max(120).default(""),
});

/** A scene without an id; the engine gives it the next free one. `lineIds` defaults to the new line of the same insert. */
export const NewScene = Scene.omit({ id: true, lineIds: true }).extend({ lineIds: z.array(LineId).min(1).optional() });
export type NewScene = z.input<typeof NewScene>;

const CharPatch = z.strictObject({
  id: CastId,
  action: CharInScene.shape.action.optional(),
  expr: CharInScene.shape.expr.optional(),
  pos: CharInScene.shape.pos.optional(),
  /** null removes it */
  to: CharInScene.shape.pos.nullable().optional(),
  facing: z.enum(["left", "right"]).nullable().optional(),
  look: z.enum(["normal", "silhouette"]).nullable().optional(),
});

export const EditOp = z.discriminatedUnion("op", [
  /** Swap scene fields, library ids only. `chars` patches characters by id; `props` and `overlays` replace the lists. */
  z.strictObject({
    op: z.literal("scene.set"),
    scene: SceneId,
    bg: libraryId("backgrounds", "background").optional(),
    grade: libraryId("grades", "grade").optional(),
    camera: libraryId("cameras", "camera move").optional(),
    transitionIn: libraryId("transitions", "transition").optional(),
    caption: libraryId("captions", "caption style").optional(),
    weather: libraryId("weather", "weather").nullable().optional(),
    framing: libraryId("framings", "framing").nullable().optional(),
    chars: z.array(CharPatch).min(1).optional(),
    props: z.array(PropInScene).max(6).optional(),
    overlays: z.array(OverlayInScene).max(3).optional(),
  }),
  /** Replace a scene's picture with another (a regenerated option), keeping its id and its lines. */
  z.strictObject({ op: z.literal("scene.replace"), scene: SceneId, with: Scene.omit({ id: true, lineIds: true }) }),
  /** Edit a line: only this line is voiced again (text or energy changed); its scenes stretch, later ones shift. `seed` asks for a retake. */
  z.strictObject({
    op: z.literal("line.set"),
    line: LineId,
    text: z.string().trim().min(1).max(300).optional(),
    energy: z.int().min(1).max(5).optional(),
    delivery: z.string().max(120).optional(),
    seed: z.int().min(0).optional(),
  }),
  /** Cut a narration line out of the video (explicitly). Its scene loses it; a scene left with no line goes too. */
  z.strictObject({ op: z.literal("line.delete"), line: LineId }),
  /**
   * Insert a narration line and/or a scene, after or before a line or a scene.
   * - line only: it joins the scene of the line before it (the scene stretches);
   * - line + scene: the scene shows the new line (a scene the line lands inside is split around it);
   * - scene only: give it `lineIds` (consecutive existing lines); they leave their old scenes.
   * Only the new line is voiced.
   */
  z
    .strictObject({ op: z.literal("insert"), after: Anchor.optional(), before: Anchor.optional(), line: NewLine.optional(), scene: NewScene.optional() })
    .refine((o) => o.line || o.scene, "insert a line, a scene or both")
    .refine((o) => !(o.after && o.before), 'give "after" or "before", not both')
    .refine((o) => o.line ? Boolean(o.after || o.before) : Boolean(o.scene?.lineIds), 'a new line needs "after" or "before"; a scene without a new line needs "lineIds"'),
  /** Sound effects on words. A tag is from the asset library (pnpm assets); the closest tag is used and flagged. */
  z.strictObject({ op: z.literal("sfx.add"), tag: z.string().regex(/^[a-z0-9_]+$/), at: WordRef }),
  z.strictObject({ op: z.literal("sfx.move"), tag: z.string().regex(/^[a-z0-9_]+$/), from: WordRef, to: WordRef }),
  z.strictObject({ op: z.literal("sfx.delete"), tag: z.string().regex(/^[a-z0-9_]+$/), at: WordRef }),
  /** A voice effect on a whole line, or on one word of it. "none" takes it off. */
  z.strictObject({ op: z.literal("fx"), line: LineId, word: z.int().min(0).optional(), preset: z.union([FxPreset, z.literal("none")]) }),
  /** Move a scene's edges by whole lines: `start: 1` gives its first line to the scene before, `end: -1` takes the next scene's first line. */
  z
    .strictObject({ op: z.literal("scene.trim"), scene: SceneId, start: z.int().optional(), end: z.int().optional() })
    .refine((o) => (o.start ?? 0) !== 0 || (o.end ?? 0) !== 0, "trim by at least one line at the start or the end"),
  /** Move a scene (with its lines) to after another scene of the same loop, or first in it (`after: null`). */
  z.strictObject({ op: z.literal("scene.move"), scene: SceneId, after: SceneId.nullable() }),
  /** Delete a scene. `merge`: its lines join the scene before (or after); the picture goes, the narration stays. `cut`: its lines go too. */
  z.strictObject({ op: z.literal("scene.delete"), scene: SceneId, lines: z.enum(["merge", "cut"]) }),
]);
export type EditOp = z.infer<typeof EditOp>;
export type EditOpIn = z.input<typeof EditOp>;

export const EditRequest = z.strictObject({ label: Label.optional(), ops: z.array(EditOp).min(1).max(50) });
export type EditRequest = z.infer<typeof EditRequest>;

/** projects/<id>/audio/fx.json: the voice effects of the current version, per line. */
export const FxFile = z.strictObject({
  version: z.literal(1),
  lines: z.record(LineId, z.array(z.strictObject({ preset: FxPreset, word: z.int().min(0).optional() })).min(1)),
});
export type FxFile = z.infer<typeof FxFile>;

// ---------------------------------------------------------------- versions (projects/<id>/versions/)

/**
 * The project files a version is made of. Small JSON only: takes, effected
 * takes, narration tracks, mixes and render segments live in their own
 * caches, by content hash, and a version only names them (`media`).
 */
export const TRACKED = [
  "script.json",
  "story/narration.json",
  "storyboard/scenes.json",
  "storyboard/storyboard.json",
  "audio/voice.json",
  "audio/overrides.json",
  "audio/fx.json",
  "audio/mixplan.json",
  "audio/mix.json",
] as const;
export type TrackedFile = (typeof TRACKED)[number];

export const VersionDiff = z.strictObject({
  scenes: z.strictObject({
    added: z.array(z.string()),
    removed: z.array(z.string()),
    /** scene id → the fields that differ (lineIds, bg, chars, sfx…) */
    changed: z.record(z.string(), z.array(z.string())),
    reordered: z.boolean(),
  }),
  lines: z.strictObject({ added: z.array(z.string()), removed: z.array(z.string()), changed: z.record(z.string(), z.array(z.string())) }),
  /** lines whose take changed (a new take or a new effect) */
  voiced: z.array(z.string()),
  cues: z.strictObject({ added: z.array(z.string()), removed: z.array(z.string()), moved: z.array(z.string()) }),
  durationS: z.strictObject({ from: z.number().nullable(), to: z.number().nullable() }),
});
export type VersionDiff = z.infer<typeof VersionDiff>;

export const Version = z.strictObject({
  version: z.literal(1),
  n: z.int().min(1),
  label: z.string(),
  kind: z.enum(["start", "edit", "outside", "rollback"]),
  parent: z.int().min(1).nullable(),
  /** for a rollback: the version it restored */
  restores: z.int().min(1).optional(),
  createdAt: z.iso.datetime(),
  ops: z.array(EditOp),
  /** tracked path → content hash (versions/objects/<hash>.json); a missing path did not exist in this version */
  files: z.partialRecord(z.enum(TRACKED), z.string()),
  /** what the version plays, by hash: the narration track (sha256 of the file) and the mix (its plan hash) */
  media: z.strictObject({ narration: z.string().nullable(), mix: z.string().nullable() }),
  changes: VersionDiff.nullable(),
  /** what the edit cost: lines voiced, effects made, seconds per stage */
  work: z.record(z.string(), z.number()).default({}),
});
export type Version = z.infer<typeof Version>;

// ---------------------------------------------------------------- Claude edit steps (engine/.claude/skills/edit-scenes)

/** `regenerate`: one scene again, following a note, as 2–3 different versions to pick from. */
export const RegenerateOutput = z.strictObject({
  options: z.array(DraftScene).min(2).max(3).describe("2 or 3 genuinely different takes on the scene, each covering exactly the scene's lineIds"),
});
export type RegenerateOutput = z.infer<typeof RegenerateOutput>;

/** `beat`: a beat described in plain words, as scenes plus any new narration line. */
export const BeatOutput = z.strictObject({
  line: z
    .strictObject({
      add: z.boolean().describe("true when the beat needs narration of its own"),
      text: z.string().describe('What the narrator says, one breath; "" when add is false'),
      energy: z.int().min(1).max(5),
      delivery: z.string(),
    })
    .describe("The new narration line, if any. Its id is given in the input as newLineId"),
  scenes: z.array(DraftScene).min(1).max(3).describe("The shots of the beat, in order; their lineIds are newLineId (when a line is added) and/or the lines listed in `canCover`"),
  why: z.string().describe("One sentence: how the beat plays"),
});
export type BeatOutput = z.infer<typeof BeatOutput>;

/** `fixscenes`: several flagged scenes fixed in one call, each following its note. */
export const FixScenesOutput = z.strictObject({
  scenes: z.array(z.strictObject({ sceneId: z.string().regex(/^S\d+$/), scene: DraftScene })).min(1).describe("One fixed scene per flagged scene, same sceneId, same lineIds"),
});
export type FixScenesOutput = z.infer<typeof FixScenesOutput>;

/** What the regenerate step leaves for the editor: options already validated and mapped, as ready-to-commit operations. */
export const SceneOptions = z.strictObject({
  version: z.literal(1),
  id: z.string(),
  project: z.string(),
  sceneId: SceneId,
  note: z.string(),
  baseVersion: z.int().min(1),
  createdAt: z.iso.datetime(),
  options: z.array(z.strictObject({ op: EditOp, why: z.string(), flags: z.array(z.string()) })).min(1),
});
export type SceneOptions = z.infer<typeof SceneOptions>;
