import { LINE } from "../theme";
import type { Pose } from "./pose";

/** Bone lengths at scale 1, in px at 1080p. Total height is about 340 px. */
export const DIM = {
  headR: 34,
  neckGap: 3,
  torso: 116,
  shoulderDrop: 13,
  upperArm: 60,
  foreArm: 56,
  thigh: 72,
  shin: 70,
  foot: 15,
} as const;

/** Bone lengths for one body (cast build and height change them; see rig/look.ts). */
export type Body = { [K in keyof typeof DIM]: number };

export type Vec = { x: number; y: number };

export type Joints = {
  hip: Vec;
  neck: Vec;
  shoulder: Vec;
  head: Vec;
  headAngle: number; // deg, screen rotation of the head
  elbowF: Vec;
  handF: Vec;
  elbowB: Vec;
  handB: Vec;
  kneeF: Vec;
  ankleF: Vec;
  toeF: Vec;
  kneeB: Vec;
  ankleB: Vec;
  toeB: Vec;
  /** Shift that puts the lowest point of the body on the ground (y = 0). */
  groundOffset: number;
};

const RAD = Math.PI / 180;
/** Direction from "straight down", + rotating toward the facing side. */
const down = (deg: number, len: number): Vec => ({ x: Math.sin(deg * RAD) * len, y: Math.cos(deg * RAD) * len });
/** Direction from "straight up", + tipping toward the facing side. */
const up = (deg: number, len: number): Vec => ({ x: Math.sin(deg * RAD) * len, y: -Math.cos(deg * RAD) * len });
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });

/**
 * Forward kinematics: pose → joint positions in the figure's own space
 * (facing right, hip at the origin, y down). `breath` stretches the spine a
 * little for the breathing idle.
 */
export function solve(p: Pose, breath = 1, body: Body = DIM): Joints {
  const D = body;
  const hip: Vec = { x: 0, y: 0 };
  const spine = p.lean + p.torso;
  const neck = add(hip, up(spine, D.torso * breath));
  const shoulder = add(neck, down(-spine, D.shoulderDrop - p.shoulders));
  const headAngle = spine + p.head;
  const head = add(neck, up(headAngle, D.neckGap + D.headR));

  const armF = p.shF - spine;
  const elbowF = add(shoulder, down(armF, D.upperArm));
  const handF = add(elbowF, down(armF + p.elF, D.foreArm));
  const armB = p.shB - spine;
  const elbowB = add(shoulder, down(armB, D.upperArm));
  const handB = add(elbowB, down(armB + p.elB, D.foreArm));

  const thighF = p.hipF - p.lean;
  const kneeF = add(hip, down(thighF, D.thigh));
  const ankleF = add(kneeF, down(thighF - p.knF, D.shin));
  const toeF = add(ankleF, down(thighF - p.knF + 90, D.foot));
  const thighB = p.hipB - p.lean;
  const kneeB = add(hip, down(thighB, D.thigh));
  const ankleB = add(kneeB, down(thighB - p.knB, D.shin));
  const toeB = add(ankleB, down(thighB - p.knB + 90, D.foot));

  // The head may dip up to 20 px past the ground, so a figure lying on its
  // back rests its spine on the floor with the head on an imaginary pillow.
  const lowest = Math.max(
    hip.y, neck.y, head.y + D.headR - 20,
    elbowF.y, handF.y, elbowB.y, handB.y,
    kneeF.y, ankleF.y, toeF.y, kneeB.y, ankleB.y, toeB.y,
  );

  return {
    hip, neck, shoulder, head, headAngle,
    elbowF, handF, elbowB, handB,
    kneeF, ankleF, toeF, kneeB, ankleB, toeB,
    groundOffset: -(lowest + LINE / 2) + p.y,
  };
}
