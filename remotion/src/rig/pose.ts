/**
 * A pose is a set of joint angles (degrees) plus a few extra channels. The
 * figure faces right; facing left is a mirror of the whole figure.
 *
 * Angle conventions (all in the figure's own plane, + = toward where it faces):
 * - lean:   whole body rotated about the hip (+ = tips forward).
 * - torso:  spine tilt on top of lean (+ = forward).
 * - head:   head tilt on top of torso (+ = nods forward/down).
 * - sh*:    upper arm, measured from "hanging along the spine" (+ = swings forward/up).
 * - el*:    elbow bend (+ = forearm folds forward/up; negative mirrors it, for the back arm).
 * - hip*:   thigh, measured from "straight down the body" (+ = forward).
 * - kn*:    knee bend (+ = shin folds backward, like a real knee).
 * F = front limb (drawn over the body), B = back limb (drawn behind).
 */
export type Pose = {
  x: number; // root offset, px
  y: number; // root offset, px (negative = up, e.g. airborne)
  lean: number;
  torso: number;
  head: number;
  gaze: number; // -1..1: face looks back (-1) or toward facing (1)
  shoulders: number; // px the shoulders rise (shrug)
  shF: number;
  elF: number;
  shB: number;
  elB: number;
  hipF: number;
  knF: number;
  hipB: number;
  knB: number;
  squash: number; // + stretches tall and thin, - squashes short and wide
  mouth: number; // 0..1 open
};

export type Channel = keyof Pose;
export const CHANNELS = [
  "x", "y", "lean", "torso", "head", "gaze", "shoulders",
  "shF", "elF", "shB", "elB", "hipF", "knF", "hipB", "knB", "squash", "mouth",
] as const satisfies readonly Channel[];

export const NEUTRAL: Pose = {
  x: 0, y: 0, lean: 0, torso: 0, head: 0, gaze: 1, shoulders: 0,
  shF: 12, elF: 10, shB: -12, elB: -10,
  hipF: 5, knF: 2, hipB: -5, knB: 2,
  squash: 0, mouth: 0,
};

export type Ease = "linear" | "in" | "out" | "inOut" | "back" | "snap" | "hold";

export const EASE: Record<Ease, (t: number) => number> = {
  linear: (t) => t,
  in: (t) => t * t * t,
  out: (t) => 1 - Math.pow(1 - t, 3),
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  back: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  snap: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  hold: (t) => (t < 1 ? 0 : 1),
};

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const out = { ...a };
  for (const k of CHANNELS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

export function addPose(base: Pose, delta: Partial<Pose>): Pose {
  const out = { ...base };
  for (const k of CHANNELS) out[k] = base[k] + (delta[k] ?? 0);
  return out;
}
