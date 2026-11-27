import type { BuildId, CastMember } from "@studio/schema";
import * as THREE from "three";
import type { Pose } from "../rig/pose";
import { bodyOf, sizeOf } from "../rig/look";
import { solve } from "../rig/skeleton";
import { PX, RAD } from "./world";

/**
 * The low-poly skeleton, driven by the stick rig's poses.
 *
 * A 2D pose is a set of joint angles in the figure's own plane (rig/pose.ts).
 * In 3D those angles become rotations about each joint's sideways axis (the
 * sagittal plane), so all 63 actions, their timing, travel and perching carry
 * over unchanged. What a side-on drawing cannot say (hands meeting in front of
 * the face, folded arms) comes from a small per-action 3D layer (Tweak3D).
 *
 * The bones use Mixamo's names and hierarchy (Hips, Spine, Head, RightArm,
 * RightForeArm, RightUpLeg, ...), so Mixamo or other humanoid clips can drive
 * the same figure later (assets/3d/README.md).
 *
 * Character space: +z is where the figure faces, +y up. A rotation of +a about
 * x tips a bone that points up toward +z (forward) and swings a bone that
 * hangs down toward -z (backward). The "front" limbs (F) are the ones on the
 * camera's side, as in 2D, so `side` flips with facing.
 */

export type Dims = {
  size: number;
  headR: number;
  neckGap: number;
  torso: number;
  shoulderDrop: number;
  upperArm: number;
  foreArm: number;
  thigh: number;
  shin: number;
  foot: number;
  /** half the distance between the shoulders / the hips */
  shoulderW: number;
  hipW: number;
  chestR: number;
  waistR: number;
  limbR: number;
  belly: number;
};

type BuildShape = { chest: number; waist: number; limb: number; shoulder: number; belly: number };
const BUILD3D: Record<BuildId, BuildShape> = {
  average: { chest: 1, waist: 1, limb: 1, shoulder: 1, belly: 0 },
  slim: { chest: 0.82, waist: 0.8, limb: 0.78, shoulder: 0.9, belly: 0 },
  broad: { chest: 1.22, waist: 1.08, limb: 1.3, shoulder: 1.18, belly: 0 },
  round: { chest: 1.08, waist: 1.25, limb: 1.1, shoulder: 1, belly: 1 },
};

/** Bone lengths and widths in metres for a cast member (same lengths as the stick figure). */
export function dimsOf(cast: Pick<CastMember, "build" | "height" | "scale">): Dims {
  const body = bodyOf(cast);
  const size = sizeOf(cast);
  const m = (px: number) => (px * size) / PX;
  const b = BUILD3D[cast.build];
  return {
    size,
    // a bigger head than the stick figure's: low-poly figures read as toys, and the face has to carry the expression
    headR: m(body.headR) * 1.3,
    neckGap: m(body.neckGap + 4),
    torso: m(body.torso),
    shoulderDrop: m(body.shoulderDrop),
    upperArm: m(body.upperArm),
    foreArm: m(body.foreArm),
    thigh: m(body.thigh),
    shin: m(body.shin),
    foot: m(body.foot + 9),
    shoulderW: m(40) * b.shoulder,
    hipW: m(19) * b.waist,
    chestR: m(41) * b.chest,
    waistR: m(34) * b.waist,
    limbR: m(13.5) * b.limb,
    belly: b.belly,
  };
}

/** The 3D layer an action adds on top of its 2D pose. All optional, degrees. */
export type Tweak3D = {
  /** arms swung out to the side (abduction), front and back arm */
  outF?: number;
  outB?: number;
  /** 0..1: move the hand toward the body's midline (hands to the face, a held book in front) */
  midF?: number;
  midB?: number;
  /** forearm turned inward across the body (folded arms), degrees */
  foldF?: number;
  foldB?: number;
  /** legs apart (a wide stance) */
  stance?: number;
  /** turn of the whole figure toward the camera, overriding the default for the action (degrees off profile) */
  turn?: number;
};

export type Joint = { rot: THREE.Euler };
export type Rig = {
  dims: Dims;
  /** the figure's root in character space: hip height above the ground and squash */
  hipY: number;
  squash: number;
  pelvis: THREE.Euler;
  chest: THREE.Euler;
  head: THREE.Euler;
  shoulderLift: number;
  armF: { side: number; upper: THREE.Euler; fore: THREE.Euler };
  armB: { side: number; upper: THREE.Euler; fore: THREE.Euler };
  legF: { side: number; thigh: THREE.Euler; shin: THREE.Euler; foot: THREE.Euler };
  legB: { side: number; thigh: THREE.Euler; shin: THREE.Euler; foot: THREE.Euler };
  mouth: number;
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * The 3D skeleton for a pose. `camSide` is +1 when the camera is on the
 * figure's local +x side (it faces left), -1 when it faces right, so the
 * front limbs are always the camera's side, as in the stick drawing.
 */
export function rigOf(p: Pose, breath: number, cast: Pick<CastMember, "build" | "height" | "scale">, camSide: 1 | -1, t: Tweak3D = {}): Rig {
  const d = dimsOf(cast);
  const body = bodyOf(cast);
  const j = solve(p, breath, body);
  // 2D: hip at the origin, y down, the lowest point lifted onto the ground by groundOffset (figure px)
  const hipY = (-(j.groundOffset) * d.size) / PX;

  const arm = (sh: number, el: number, side: number, out: number, mid: number, fold: number) => {
    // how far forward the hand reaches from the shoulder, for the move toward the midline
    const a1 = sh * RAD;
    const a2 = (sh + el) * RAD;
    const reach = Math.sin(a1) * d.upperArm + Math.sin(a2) * d.foreArm;
    const yaw = mid > 0 && reach > 0.05 ? Math.asin(Math.min(0.95, (mid * d.shoulderW) / reach)) : 0;
    // A side-on drawing folds the back arm's forearm "backward" (negative elbow) to read as an arm seen from behind
    // (hands on hips, an arm tucked back). A real elbow cannot bend that way: bend it forward and turn the forearm
    // inward instead, so the hand ends up at the hip or behind the back. Small negatives are just a straight arm.
    let bend = el;
    let twist = fold * clamp01(Math.abs(el) / 80);
    if (el < 0) {
      bend = el < -20 ? -el : 0;
      twist = el < -20 ? 115 : 0;
    }
    // yaw turns the arm about the vertical toward the midline (away from its own side)
    return {
      side,
      upper: new THREE.Euler(-sh * RAD, -side * yaw, side * out * RAD, "YXZ"),
      fore: new THREE.Euler(-bend * RAD, -side * twist * RAD, 0, "YXZ"),
    };
  };
  const leg = (hip: number, kn: number, side: number, stance: number) => ({
    side,
    thigh: new THREE.Euler(-hip * RAD, 0, side * stance * RAD, "XZY"),
    shin: new THREE.Euler(kn * RAD, 0, 0),
    // the foot stays roughly level with the ground: it undoes the thigh and knee
    foot: new THREE.Euler((hip - kn) * RAD * 0.6, 0, -side * stance * RAD),
  });

  const F = camSide;
  const B = -camSide as 1 | -1;
  return {
    dims: d,
    hipY,
    squash: p.squash,
    pelvis: new THREE.Euler(p.lean * RAD, 0, 0),
    chest: new THREE.Euler(p.torso * RAD, 0, 0),
    // gaze 1 looks where the figure faces; lower turns the head toward the camera (looking back)
    head: new THREE.Euler(p.head * RAD, -camSide * (1 - p.gaze) * 38 * RAD, 0, "YXZ"),
    shoulderLift: (p.shoulders * d.size) / PX,
    armF: arm(p.shF, p.elF, F, 11 + (t.outF ?? 0), t.midF ?? 0, t.foldF ?? 0),
    armB: arm(p.shB, p.elB, B, 11 + (t.outB ?? 0), t.midB ?? 0, t.foldB ?? 0),
    legF: leg(p.hipF, p.knF, F, 2 + (t.stance ?? 0)),
    legB: leg(p.hipB, p.knB, B, 2 + (t.stance ?? 0)),
    mouth: p.mouth,
  };
}

/** Where the joints are, in character space (metres). Matches the hierarchy Figure3D builds. */
export function jointsOf(r: Rig): { head: THREE.Vector3; handF: THREE.Vector3; handB: THREE.Vector3; chest: THREE.Vector3 } {
  const d = r.dims;
  const m = new THREE.Matrix4();
  const at = (parent: THREE.Matrix4, pos: [number, number, number], rot: THREE.Euler) =>
    parent.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(rot), new THREE.Vector3(1, 1, 1)));
  // squash scales about the ground point, as in the stick figure
  const root = m.clone().makeScale(1 - r.squash * 0.5, 1 + r.squash, 1 - r.squash * 0.5).multiply(new THREE.Matrix4().makeTranslation(0, r.hipY, 0));
  const pelvis = at(root, [0, 0, 0], r.pelvis);
  const chest = at(pelvis, [0, 0, 0], r.chest);
  const neck = at(chest, [0, d.torso, 0], new THREE.Euler());
  const head = at(neck, [0, d.neckGap + d.headR, 0], r.head);
  const hand = (a: Rig["armF"]) => {
    const sh = at(chest, [a.side * d.shoulderW, d.torso - d.shoulderDrop + r.shoulderLift, 0], a.upper);
    const el = at(sh, [0, -d.upperArm, 0], a.fore);
    return new THREE.Vector3(0, -d.foreArm, 0).applyMatrix4(el);
  };
  return {
    head: new THREE.Vector3().setFromMatrixPosition(head),
    handF: hand(r.armF),
    handB: hand(r.armB),
    chest: new THREE.Vector3(0, d.torso * 0.6, 0).applyMatrix4(chest),
  };
}
