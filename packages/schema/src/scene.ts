import { z } from "zod";
import { ACTIONS, BACKGROUNDS, PROPS } from "./catalogue";
import { libraryId } from "./ids";

/**
 * Scene JSON (docs/PLAN.md section 6). Written by Claude from Phase 3 on, by
 * hand in Phase 0. A scene carries no timing: it starts and ends on the word
 * timestamps of its `lineIds` (Phase 1+), or on `timing.json` (Phase 0).
 *
 * Additions to the plan's example, all optional:
 * - `chars[].to`: where a travelling action (walk, run, sneak, sleepwalk) ends up.
 * - `chars[].facing`: which way the character faces (default: toward the centre,
 *   or the direction of travel).
 * - `chars[].look`: "silhouette" hides who it is (black figure, no face).
 * - `props[].pos`: where a ground/wall prop stands, instead of `attach`.
 * - The file wraps scenes with a `cast`, so a character id like "keeper" maps to
 *   one consistent look (hat, colour, beard, height) across every scene.
 */

export const LINE_ID = /^[A-Za-z][A-Za-z0-9]*\.\d+$/;
export const LineId = z.string().regex(LINE_ID, 'line ids look like "L3.4"');
export const CastId = z.string().regex(/^[a-z][a-z0-9_]*$/, 'cast ids are lower_snake_case, e.g. "keeper"');
export const SceneId = z.string().regex(/^S\d+$/, 'scene ids look like "S41"');

export const Position = libraryId("positions", "position");

export const SfxCue = z.strictObject({
  tag: z.string().regex(/^[a-z0-9_]+$/, 'sfx tags are lower_snake_case, e.g. "footsteps_wood"'),
  at: z.string().regex(/^[A-Za-z][A-Za-z0-9]*\.\d+:\d+$/, 'expected "<lineId>:<wordIndex>", e.g. "L3.4:0"'),
});

export const CharInScene = z.strictObject({
  id: CastId,
  action: libraryId("actions", "action"),
  expr: libraryId("expressions", "expression"),
  pos: Position,
  to: Position.optional(),
  facing: z.enum(["left", "right"]).optional(),
  look: z.enum(["normal", "silhouette"]).optional(),
});

export const PropInScene = z.strictObject({
  id: libraryId("props", "prop"),
  attach: z
    .string()
    .regex(/^[a-z][a-z0-9_]*\.(hand_r|hand_l|head)$/, 'attach looks like "<charId>.hand_r" (points: hand_r, hand_l, head)')
    .optional(),
  pos: Position.optional(),
});

export const Scene = z.strictObject({
  id: SceneId,
  lineIds: z.array(LineId).min(1, "a scene needs at least one line id"),
  bg: libraryId("backgrounds", "background"),
  grade: libraryId("grades", "grade"),
  chars: z.array(CharInScene).max(4, "at most 4 characters per scene"),
  props: z.array(PropInScene).default([]),
  camera: libraryId("cameras", "camera move"),
  transitionIn: libraryId("transitions", "transition"),
  sfx: z.array(SfxCue).default([]),
  caption: libraryId("captions", "caption style"),
});

export const CastMember = z.strictObject({
  name: z.string().min(1),
  hat: libraryId("hats", "hat"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'colours are hex, e.g. "#d0473d"'),
  beard: z.boolean().default(false),
  scale: z.number().min(0.6).max(1.4).default(1),
});

const TRAVELLING = Object.entries(ACTIONS)
  .filter(([, a]) => a.travels)
  .map(([id]) => id);

export const SceneFile = z
  .strictObject({
    version: z.literal(1),
    title: z.string().min(1),
    cast: z.record(CastId, CastMember),
    scenes: z.array(Scene).min(1),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.scenes.forEach((scene, i) => {
      const at = (...rest: (string | number)[]) => ["scenes", i, ...rest];

      if (seen.has(scene.id)) ctx.addIssue({ code: "custom", path: at("id"), message: `duplicate scene id "${scene.id}"` });
      seen.add(scene.id);

      const inScene = new Set<string>();
      scene.chars.forEach((c, j) => {
        if (!(c.id in file.cast)) {
          ctx.addIssue({ code: "custom", path: at("chars", j, "id"), message: `"${c.id}" is not in the cast (cast: ${Object.keys(file.cast).join(", ")})` });
        }
        if (inScene.has(c.id)) ctx.addIssue({ code: "custom", path: at("chars", j, "id"), message: `"${c.id}" appears twice in this scene` });
        inScene.add(c.id);
        if (c.to && !TRAVELLING.includes(c.action)) {
          ctx.addIssue({ code: "custom", path: at("chars", j, "to"), message: `"to" only works with travelling actions (${TRAVELLING.join(", ")}), not "${c.action}"` });
        }
      });

      const bgInterior = BACKGROUNDS[scene.bg].interior;
      scene.props.forEach((p, j) => {
        const placement = PROPS[p.id].placement;
        if (p.attach && p.pos) ctx.addIssue({ code: "custom", path: at("props", j), message: 'use either "attach" or "pos", not both' });
        if (p.attach) {
          const owner = p.attach.split(".")[0]!;
          if (!inScene.has(owner)) ctx.addIssue({ code: "custom", path: at("props", j, "attach"), message: `"${owner}" is not a character in this scene` });
          if (placement !== "hand" && placement !== "hand_or_ground") {
            ctx.addIssue({ code: "custom", path: at("props", j, "attach"), message: `"${p.id}" can't be held; give it a "pos" instead` });
          }
        } else {
          if (placement === "hand") ctx.addIssue({ code: "custom", path: at("props", j), message: `"${p.id}" must be held: add "attach": "<charId>.hand_r"` });
          if (!p.pos && placement !== "horizon") ctx.addIssue({ code: "custom", path: at("props", j), message: `"${p.id}" needs a "pos"` });
        }
        if (placement === "horizon" && bgInterior) ctx.addIssue({ code: "custom", path: at("props", j, "id"), message: `"${p.id}" needs an outdoor sea background, not "${scene.bg}"` });
        if (placement === "wall" && !bgInterior) ctx.addIssue({ code: "custom", path: at("props", j, "id"), message: `"${p.id}" hangs on a wall; "${scene.bg}" has none` });
      });

      scene.sfx.forEach((s, j) => {
        const lineId = s.at.split(":")[0]!;
        if (!scene.lineIds.includes(lineId)) {
          ctx.addIssue({ code: "custom", path: at("sfx", j, "at"), message: `line "${lineId}" is not one of this scene's lineIds (${scene.lineIds.join(", ")})` });
        }
      });
    });
  });

export type SfxCue = z.infer<typeof SfxCue>;
export type CharInScene = z.infer<typeof CharInScene>;
export type PropInScene = z.infer<typeof PropInScene>;
export type Scene = z.infer<typeof Scene>;
export type CastMember = z.infer<typeof CastMember>;
export type SceneFile = z.infer<typeof SceneFile>;
