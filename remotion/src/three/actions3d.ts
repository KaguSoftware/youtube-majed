import { ACTIONS, type ActionId, type LowPolyActionId } from "@studio/schema";
import { ACTION_LIB } from "../library/actions";
import type { Tweak3D } from "./rig3d";

/**
 * The 3D layer of each action that has a low-poly version (catalogue
 * LOW_POLY.actions; TypeScript checks this Record against it). The motion
 * itself is the stick action's keyframes (library/actions.ts) played on the
 * 3D skeleton; this adds what a side-on drawing cannot say: hands meeting in
 * front of the body, folded arms, arms out to the side, and how far the figure
 * turns toward the camera.
 *
 * `turn` is degrees from profile toward the camera: a walker crosses the
 * frame nearly side-on, someone talking shows their face, a sleeper lies
 * along the bed.
 */

const TRAVEL = 22;
const STAND = 38;

export const ACTIONS3D: Record<LowPolyActionId, Tweak3D> = {
  idle: {},
  talk: { outF: 6 },
  think: { midF: 0.9, midB: 0.55, foldB: 60 },
  walk: { turn: TRAVEL },
  run: { turn: TRAVEL, outF: 4, outB: 4 },
  sneak: { turn: TRAVEL, outF: 10, outB: 10, stance: 3 },
  sleepwalk: { turn: TRAVEL, midF: 0.35, midB: 0.35 },
  trudge: { turn: TRAVEL },
  look_around: {},
  point: { turn: 30 },
  shrug: { outF: 32, outB: 32 },
  facepalm: { midF: 0.95 },
  panic: { outF: 28, outB: 28 },
  sit: { midF: 0.45, midB: 0.45, turn: 30 },
  sleep: { turn: 0 },
  nod: {},
  head_shake: {},
  wave: { outF: 14 },
  cross_arms: { foldF: 78, foldB: 78, midF: 0.15, midB: 0.15 },
  scratch_head: { midF: 0.45 },
  double_take: {},
  listen: { outF: 4 },
  gasp: { midF: 0.75, midB: 0.75 },
  tremble: { midF: 0.35, midB: 0.35 },
  sigh: {},
  yawn: { outF: 10, outB: 10 },
  peek: { turn: 26 },
  sit_chair: { turn: 30 },
  push: { midF: 0.3, midB: 0.3, turn: 24 },
  pull: { midF: 0.45, midB: 0.45, turn: 24 },
  throw: { turn: 30 },
  drive: { midF: 0.35, midB: 0.35, turn: 0 },
  text_phone: { midF: 0.6, midB: 0.55 },
  phone_call: {},
  read: { midF: 0.55, midB: 0.55 },
  dodge: { outF: 18, outB: 18 },
  hands_on_hips: { outF: 38, outB: 38 },
  knock: { turn: 24 },
  cower: { midF: 0.35, midB: 0.35, outF: 10, outB: 10 },
  type: { midF: 0.4, midB: 0.4, turn: 30 },
  jump: { outF: 8, outB: 8 },
  tap_foot: { foldF: 78, foldB: 78, midF: 0.15, midB: 0.15 },
  bow: {},
  salute: { outF: 18 },
  stop_hand: { midF: 0.2 },
  fists_up: { midF: 0.35, midB: 0.3, stance: 4 },
};

/** The tweak for an action, and its turn toward the camera. */
export function tweakOf(action: ActionId): Tweak3D & { turn: number } {
  const t = (ACTIONS3D as Partial<Record<ActionId, Tweak3D>>)[action] ?? {};
  const def = ACTION_LIB[action];
  const turn = t.turn ?? (def.lying ? 0 : ACTIONS[action].travels ? TRAVEL : STAND);
  return { ...t, turn };
}
