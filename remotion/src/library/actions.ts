import type { ActionId } from "@studio/schema";
import { compile, type ActionDef, type Compiled } from "../rig/animate";
import type { Pose } from "../rig/pose";

/**
 * The action library. Every id in the catalogue (packages/schema) must be
 * here; TypeScript enforces it through Record<ActionId, …>.
 *
 * Angles: see rig/pose.ts. Rules of thumb used throughout:
 * anticipation before big moves, ease-out ("back") for snappy arrivals,
 * squash on landings, arms opposite legs, nothing perfectly symmetric.
 */

const LYING: Partial<Pose> = {
  lean: -90, torso: 0, head: 22, gaze: 1,
  shF: 2, elF: 55, shB: -6, elB: 12,
  hipF: 30, knF: 55, hipB: 2, knB: 6,
};

/** Sitting on a seat: thighs level, shins down. Perched actions start from this. */
const PERCH: Partial<Pose> = {
  lean: 0, torso: -3, head: 2,
  hipF: 88, knF: 86, hipB: 82, knB: 80,
  shF: 18, elF: 34, shB: 10, elB: 30,
};

/** Hands on the hips (elbows out front and back, as seen side-on). */
const AKIMBO: Partial<Pose> = { shF: -22, elF: 62, shB: 22, elB: -62 };
/** Folded arms. */
const FOLDED: Partial<Pose> = { shF: 6, elF: 96, shB: 12, elB: 92 };
/** A hand at the mouth (eating, drinking, whispering). */
const HAND_TO_MOUTH: Partial<Pose> = { shF: 72, elF: 140 };
/** A hand at the ear (phone, listening). */
const HAND_TO_EAR: Partial<Pose> = { shF: 112, elF: 130 };

const defs: Record<ActionId, ActionDef> = {
  idle: {
    frames: 96,
    loop: true,
    keys: [
      { t: 0, p: { lean: 0, torso: 0, head: 0, shF: 12, elF: 10, shB: -12, elB: -10, hipF: 5, knF: 2, hipB: -5, knB: 2 } },
      { t: 0.5, p: { lean: 1.5, torso: -1.5, head: -2, shF: 14, elF: 14, shB: -10, elB: -8, hipF: 7, knF: 5, hipB: -3, knB: 1 } },
    ],
  },

  talk: {
    frames: 44,
    loop: true,
    keys: [
      { t: 0, p: { shF: 32, elF: 72, head: 0, torso: 1, shB: -12, elB: -14, mouth: 0.1 } },
      { t: 0.18, p: { shF: 46, elF: 88, head: 4, torso: 3, mouth: 0.9 } },
      { t: 0.36, p: { shF: 26, elF: 58, head: -2, torso: 0, mouth: 0.2 } },
      { t: 0.52, p: { mouth: 0.8 } },
      { t: 0.7, p: { shF: 52, elF: 96, head: 3, shB: -18, elB: -30, mouth: 0.15 } },
      { t: 0.86, p: { shF: 40, elF: 80, head: 1, mouth: 0.75 } },
    ],
  },

  think: {
    frames: 26,
    loop: false,
    breath: 1.2,
    keys: [
      { t: 0, p: {} },
      { t: 0.55, p: { shF: 38, elF: 120, shB: 20, elB: 70, head: -4 }, ease: "back" },
      { t: 1, p: { shF: 30, elF: 146, shB: 26, elB: 96, head: -10, torso: -3, gaze: 0.6 } },
    ],
  },

  walk: {
    frames: 32,
    loop: true,
    speed: 210,
    keys: [
      { t: 0, p: { hipF: 25, knF: 4, hipB: -22, knB: 14, shF: -24, elF: 22, shB: 26, elB: 24, torso: 4, head: 1 } },
      { t: 0.25, p: { hipF: 2, knF: 5, hipB: 6, knB: 52, shF: -2, elF: 18, shB: 4, elB: 18, torso: 5, head: -1 } },
      { t: 0.5, p: { hipF: -22, knF: 14, hipB: 25, knB: 4, shF: 26, elF: 24, shB: -24, elB: 22, torso: 4, head: 1 } },
      { t: 0.75, p: { hipF: 6, knF: 52, hipB: 2, knB: 5, shF: 4, elF: 18, shB: -2, elB: 18, torso: 5, head: -1 } },
    ],
  },

  run: {
    frames: 20,
    loop: true,
    speed: 560,
    fx: "speed",
    keys: [
      { t: 0, p: { hipF: 46, knF: 22, hipB: -34, knB: 72, shF: -42, elF: 96, shB: 52, elB: 86, torso: 16, head: -6, y: 0, squash: -0.03 } },
      { t: 0.25, p: { hipF: 6, knF: 18, hipB: 12, knB: 112, shF: 0, shB: 4, y: -16, squash: 0.04 } },
      { t: 0.5, p: { hipF: -34, knF: 72, hipB: 46, knB: 22, shF: 52, elF: 86, shB: -42, elB: 96, y: 0, squash: -0.03 } },
      { t: 0.75, p: { hipF: 12, knF: 112, hipB: 6, knB: 18, shF: 4, shB: 0, y: -16, squash: 0.04 } },
    ],
  },

  sneak: {
    frames: 44,
    loop: true,
    speed: 120,
    base: { torso: 24, head: -14, gaze: 1 },
    keys: [
      { t: 0, p: { hipF: 42, knF: 58, hipB: -8, knB: 62, shF: 44, elF: 104, shB: 62, elB: 112, y: 0 } },
      { t: 0.25, p: { hipF: 22, knF: 52, hipB: 32, knB: 112, shF: 52, elF: 108, shB: 54, elB: 108, y: -6, torso: 26 } },
      { t: 0.5, p: { hipF: -8, knF: 62, hipB: 42, knB: 58, shF: 62, elF: 112, shB: 44, elB: 104, y: 0, torso: 24 } },
      { t: 0.75, p: { hipF: 32, knF: 112, hipB: 22, knB: 52, shF: 54, elF: 108, shB: 52, elB: 108, y: -6, torso: 26 } },
    ],
  },

  sleepwalk: {
    frames: 48,
    loop: true,
    speed: 80,
    face: "sleepy",
    base: { shF: 88, elF: 4, shB: 82, elB: 6, torso: -3, head: 14 },
    keys: [
      { t: 0, p: { hipF: 14, knF: 4, hipB: -12, knB: 6, shF: 86, shB: 84, head: 14 } },
      { t: 0.25, p: { hipF: 2, knF: 4, hipB: 2, knB: 22, shF: 90, shB: 80, head: 18 } },
      { t: 0.5, p: { hipF: -12, knF: 6, hipB: 14, knB: 4, shF: 86, shB: 84, head: 14 } },
      { t: 0.75, p: { hipF: 2, knF: 22, hipB: 2, knB: 4, shF: 82, shB: 88, head: 10 } },
    ],
  },

  look_around: {
    frames: 84,
    loop: true,
    keys: [
      { t: 0, p: { gaze: 1, head: 0, torso: 0, lean: 0, shF: 22, elF: 40, shB: -22, elB: -40 } },
      { t: 0.18, p: { gaze: 1, head: -5 } },
      { t: 0.3, p: { gaze: -1, head: 5, torso: -4, lean: -2 }, ease: "snap" },
      { t: 0.55, p: { gaze: -1, head: 2, torso: -3 } },
      { t: 0.67, p: { gaze: 1, head: -7, torso: 2, lean: 1, shF: 26, elF: 48 }, ease: "snap" },
      { t: 0.9, p: { gaze: 1, head: -2, torso: 0, lean: 0 } },
    ],
  },

  point: {
    frames: 16,
    loop: false,
    keys: [
      { t: 0, p: {} },
      { t: 0.4, p: { shF: 58, elF: 84, torso: -4, head: 2, shB: -16, elB: -16 }, ease: "back" },
      { t: 1, p: { shF: 92, elF: 2, torso: 5, lean: 2, head: -3, shB: -22, elB: -24 } },
    ],
  },

  shrug: {
    frames: 30,
    loop: false,
    keys: [
      { t: 0, p: {} },
      { t: 0.4, p: { shoulders: 13, shF: 34, elF: 104, shB: -34, elB: -104, head: 13, torso: -2 }, ease: "back" },
      { t: 0.75, p: { shoulders: 12, head: 12 } },
      { t: 1, p: { shoulders: 9, shF: 30, elF: 96, shB: -30, elB: -96, head: 10, torso: -1 } },
    ],
  },

  facepalm: {
    frames: 22,
    loop: false,
    keys: [
      { t: 0, p: {} },
      { t: 0.4, p: { shF: 62, elF: 70, head: -4, torso: -2 } },
      { t: 0.68, p: { shF: 40, elF: 152, head: 22, torso: 8, squash: -0.05, shB: -6, elB: -4 }, ease: "back" },
      { t: 1, p: { shF: 38, elF: 150, head: 18, torso: 7, squash: 0 } },
    ],
  },

  panic: {
    frames: 16,
    loop: true,
    fx: "sweat",
    keys: [
      { t: 0, p: { shF: 152, elF: 42, shB: -152, elB: -42, hipF: 22, knF: 32, hipB: -4, knB: 10, head: -6, y: 0, mouth: 1 } },
      { t: 0.25, p: { shF: 122, elF: 82, shB: -170, elB: -22, hipF: 0, knF: 10, hipB: 22, knB: 42, y: -8, head: 6, mouth: 0.6 } },
      { t: 0.5, p: { shF: 170, elF: 22, shB: -122, elB: -82, hipF: -4, knF: 10, hipB: 22, knB: 32, y: 0, head: -6, mouth: 1 } },
      { t: 0.75, p: { shF: 140, elF: 62, shB: -140, elB: -62, hipF: 22, knF: 42, hipB: 0, knB: 10, y: -8, head: 4, mouth: 0.6 } },
    ].map((k) => ({ ...k, ease: "linear" as const })),
  },

  argue: {
    frames: 36,
    loop: true,
    base: { torso: 8, lean: 2, shB: -42, elB: -112, head: -4 },
    keys: [
      { t: 0, p: { shF: 70, elF: 62, torso: 7, mouth: 0.2 } },
      { t: 0.18, p: { shF: 86, elF: 14, head: 2, torso: 12, mouth: 1 }, ease: "snap" },
      { t: 0.42, p: { shF: 64, elF: 72, torso: 7, head: -4, mouth: 0.3 } },
      { t: 0.6, p: { shF: 88, elF: 10, torso: 12, head: 2, mouth: 0.95 }, ease: "snap" },
      { t: 0.82, p: { shF: 60, elF: 80, torso: 6, squash: 0.02, mouth: 0.2 } },
    ],
  },

  celebrate: {
    frames: 26,
    loop: true,
    keys: [
      { t: 0, p: { squash: -0.1, hipF: 22, knF: 42, hipB: -18, knB: 40, shF: 140, elF: 22, shB: -140, elB: -22, y: 0, mouth: 0.5 }, ease: "out" },
      { t: 0.32, p: { y: -64, squash: 0.08, hipF: 8, knF: 10, hipB: -8, knB: 12, shF: 165, elF: 6, shB: -165, elB: -6, mouth: 1 } },
      { t: 0.55, p: { y: -70, squash: 0.02, knF: 30, knB: 52 }, ease: "in" },
      { t: 0.82, p: { y: 0, squash: -0.09, hipF: 18, knF: 36, hipB: -14, knB: 36, shF: 145, shB: -145, mouth: 0.6 } },
    ],
  },

  jump: {
    frames: 32,
    loop: false,
    keys: [
      { t: 0, p: {} },
      { t: 0.22, p: { squash: -0.13, hipF: 32, knF: 62, hipB: 22, knB: 62, torso: 18, shF: -42, elF: 20, shB: -50, elB: 20, head: -4 }, ease: "out" },
      { t: 0.42, p: { y: -150, squash: 0.12, hipF: 6, knF: 6, hipB: -6, knB: 6, torso: 0, shF: 150, elF: 8, shB: 140, elB: 8, head: -6 } },
      { t: 0.6, p: { y: -128, squash: 0, hipF: 52, knF: 72, hipB: 42, knB: 82, shF: 80, elF: 60, shB: 70, elB: 60 }, ease: "in" },
      { t: 0.78, p: { y: 0, squash: -0.15, hipF: 32, knF: 52, hipB: 16, knB: 50, torso: 14, shF: 40, elF: 30, shB: 30, elB: 30, head: 2 }, ease: "back" },
      { t: 1, p: { y: 0, squash: 0, hipF: 5, knF: 2, hipB: -5, knB: 2, torso: 0, shF: 12, elF: 10, shB: -12, elB: -10, head: 0 } },
    ],
  },

  fall: {
    frames: 30,
    loop: false,
    keys: [
      { t: 0, p: {} },
      { t: 0.18, p: { hipF: 62, knF: 4, shF: 70, elF: 30, shB: -90, elB: -30, torso: -12, lean: 4, y: -24, head: -10 }, ease: "out" },
      { t: 0.52, p: { lean: -58, hipF: 88, knF: 20, hipB: 40, knB: 30, shF: 130, elF: 30, shB: -150, elB: -20, x: -30, y: -10 }, ease: "in" },
      { t: 0.74, p: { lean: -92, torso: 0, hipF: 34, knF: 30, hipB: 8, knB: 12, shF: 160, elF: 10, shB: 172, elB: 10, head: 18, x: -60, y: 0, squash: -0.07 }, ease: "out" },
      { t: 1, p: { lean: -90, hipF: 26, knF: 40, hipB: 4, knB: 6, shF: 150, elF: 18, shB: 166, elB: 8, head: 22, squash: 0 } },
    ],
  },

  get_up: {
    frames: 40,
    loop: false,
    base: { ...LYING, x: -60 },
    keys: [
      { t: 0, p: {} },
      { t: 0.32, p: { lean: -32, torso: 10, head: 6, hipF: 84, knF: 118, hipB: 70, knB: 116, shF: 50, elF: 20, shB: -38, elB: 0, x: -40 } },
      { t: 0.62, p: { lean: 0, torso: 32, head: -10, hipF: 72, knF: 112, hipB: 50, knB: 104, shF: 40, elF: 30, shB: 20, elB: 20, squash: -0.05, x: -10 } },
      { t: 1, p: { lean: 0, torso: 0, head: 0, hipF: 5, knF: 2, hipB: -5, knB: 2, shF: 12, elF: 10, shB: -12, elB: -10, squash: 0, x: 0 }, ease: "back" },
    ],
  },

  sit: {
    frames: 24,
    loop: false,
    breath: 0.8,
    keys: [
      { t: 0, p: {} },
      { t: 0.45, p: { torso: 18, hipF: 70, knF: 100, hipB: 60, knB: 96, shF: 30, elF: 20, shB: 10, elB: 10, squash: -0.04 } },
      { t: 1, p: { lean: 0, torso: -10, head: 4, hipF: 140, knF: 168, hipB: 136, knB: 166, shF: 30, elF: 40, shB: 24, elB: 46, squash: 0 }, ease: "out" },
    ],
  },

  sleep: {
    frames: 120,
    loop: true,
    breath: 2.2,
    fx: "zzz",
    face: "sleepy",
    lying: true,
    base: LYING,
    keys: [
      { t: 0, p: { mouth: 0 } },
      { t: 0.5, p: { mouth: 0.6, elF: 60 } },
    ],
  },

  // ---------------------------------------------------------------- gestures

  nod: {
    frames: 24,
    loop: true,
    keys: [
      { t: 0, p: { head: -2, torso: 0 } },
      { t: 0.3, p: { head: 16, torso: 2 }, ease: "out" },
      { t: 0.6, p: { head: -3, torso: 0 } },
    ],
  },

  head_shake: {
    frames: 22,
    loop: true,
    keys: [
      { t: 0, p: { gaze: 1, head: 4, torso: 0, mouth: 0 } },
      { t: 0.25, p: { gaze: -0.7, head: 7, torso: -1 }, ease: "snap" },
      { t: 0.5, p: { gaze: 1, head: 4 }, ease: "snap" },
      { t: 0.75, p: { gaze: -0.7, head: 7, torso: -1 }, ease: "snap" },
    ],
  },

  wave: {
    frames: 22,
    loop: true,
    keys: [
      { t: 0, p: { shF: 150, elF: 8, torso: -2, head: -2 } },
      { t: 0.5, p: { shF: 146, elF: 48, torso: -1 } },
    ],
  },

  clap: {
    frames: 14,
    loop: true,
    keys: [
      { t: 0, p: { shF: 52, elF: 66, shB: 50, elB: 70, head: -2 } },
      { t: 0.45, p: { shF: 40, elF: 44, shB: 34, elB: 40 }, ease: "in" },
    ],
  },

  fist_pump: {
    frames: 24,
    loop: false,
    keys: [
      { t: 0, p: {} },
      { t: 0.35, p: { shF: 150, elF: 30, torso: -6, head: -6, squash: 0.03 }, ease: "out" },
      { t: 0.7, p: { shF: 58, elF: 132, torso: 8, head: 4, hipF: 14, knF: 18, squash: -0.04, mouth: 0.8 }, ease: "snap" },
      { t: 1, p: { shF: 62, elF: 128, torso: 6, head: 2, squash: 0, mouth: 0.5 } },
    ],
  },

  bow: {
    frames: 26,
    loop: false,
    keys: [
      { t: 0, p: {} },
      { t: 0.6, p: { torso: 62, head: 14, shF: 58, elF: 30, shB: 50, elB: 26 }, ease: "inOut" },
      { t: 1, p: { torso: 58, head: 12, shF: 54, elF: 28, shB: 48, elB: 24 } },
    ],
  },

  salute: {
    frames: 14,
    loop: false,
    keys: [
      { t: 0, p: {} },
      { t: 0.6, p: { shF: 122, elF: 104, torso: -3, head: -4, squash: 0.03 }, ease: "back" },
      { t: 1, p: { shF: 118, elF: 108, torso: -3, head: -3, squash: 0 } },
    ],
  },

  beckon: {
    frames: 26,
    loop: true,
    keys: [
      { t: 0, p: { shF: 70, elF: 14, head: -3, torso: 2 } },
      { t: 0.5, p: { shF: 74, elF: 112, head: 2, torso: -1 }, ease: "inOut" },
    ],
  },

  stop_hand: {
    frames: 12,
    loop: false,
    keys: [
      { t: 0, p: {} },
      { t: 0.55, p: { shF: 96, elF: -16, lean: -4, torso: -6, shB: -24, elB: -20, squash: 0.03 }, ease: "back" },
      { t: 1, p: { shF: 92, elF: -10, lean: -3, torso: -5, squash: 0 } },
    ],
  },

  cross_arms: {
    frames: 16,
    loop: false,
    keys: [
      { t: 0, p: {} },
      { t: 1, p: { ...FOLDED, torso: -5, lean: -2, head: -4, hipF: 9, hipB: -9 }, ease: "out" },
    ],
  },

  hands_on_hips: {
    frames: 14,
    loop: false,
    keys: [
      { t: 0, p: {} },
      { t: 1, p: { ...AKIMBO, torso: -6, head: -5, hipF: 12, hipB: -12, knF: 2, knB: 2 }, ease: "back" },
    ],
  },

  scratch_head: {
    frames: 16,
    loop: true,
    base: { shF: 150, elF: 76, head: 6, torso: 1, gaze: 0.4, shB: -14, elB: -12 },
    keys: [
      { t: 0, p: { elF: 72, head: 6 } },
      { t: 0.5, p: { elF: 86, head: 8 } },
    ],
  },

  double_take: {
    frames: 30,
    loop: false,
    keys: [
      { t: 0, p: { gaze: 1 } },
      { t: 0.25, p: { gaze: -1, head: 4, torso: -2 }, ease: "inOut" },
      { t: 0.5, p: { gaze: -1, head: 6 } },
      { t: 0.62, p: { gaze: 1, head: -10, torso: -8, lean: -4, shoulders: 10, shF: 40, elF: 70, shB: 40, elB: 70, squash: 0.06, y: -10 }, ease: "snap" },
      { t: 1, p: { gaze: 1, head: -6, torso: -5, lean: -2, shoulders: 6, squash: 0, y: 0 } },
    ],
  },

  present: {
    frames: 18,
    loop: false,
    keys: [
      { t: 0, p: {} },
      { t: 0.4, p: { shF: 40, elF: 90, torso: 4 } },
      { t: 1, p: { shF: 118, elF: -6, torso: -6, lean: -2, head: -6, shB: 22, elB: -62, mouth: 0.4 }, ease: "back" },
    ],
  },

  whisper: {
    frames: 30,
    loop: true,
    base: { ...HAND_TO_MOUTH, torso: 14, lean: 4, head: 4, gaze: 1 },
    keys: [
      { t: 0, p: { mouth: 0.15 } },
      { t: 0.3, p: { mouth: 0.4 } },
      { t: 0.55, p: { mouth: 0.1 } },
      { t: 0.8, p: { mouth: 0.35 } },
    ],
  },

  shout: {
    frames: 20,
    loop: true,
    base: { shF: 76, elF: 142, shB: 70, elB: 144, torso: 10, lean: 4 },
    keys: [
      { t: 0, p: { mouth: 0.7, head: -4, squash: 0 } },
      { t: 0.4, p: { mouth: 1, head: -8, torso: 13, squash: 0.03 } },
    ],
  },

  listen: {
    frames: 60,
    loop: true,
    base: { ...HAND_TO_EAR, torso: 10, lean: 4, gaze: -0.4 },
    keys: [
      { t: 0, p: { head: -8 } },
      { t: 0.5, p: { head: -12, torso: 13 } },
    ],
  },

  // ---------------------------------------------------------------- feelings

  gasp: {
    frames: 14,
    loop: false,
    keys: [
      { t: 0, p: {} },
      { t: 0.5, p: { lean: -6, torso: -10, head: -8, shoulders: 9, shF: 64, elF: 128, shB: 58, elB: 124, mouth: 1, squash: 0.05, y: -6 }, ease: "snap" },
      { t: 1, p: { lean: -4, torso: -7, head: -5, shoulders: 6, mouth: 0.7, squash: 0, y: 0 } },
    ],
  },

  cower: {
    frames: 6,
    loop: true,
    base: { hipF: 64, knF: 118, hipB: 54, knB: 112, torso: 34, head: 24, shF: 168, elF: 84, shB: 158, elB: 92, gaze: 0.6 },
    keys: [
      { t: 0, p: { x: -1.5, shoulders: 1 } },
      { t: 0.5, p: { x: 1.5, shoulders: 3 } },
    ].map((k) => ({ ...k, ease: "linear" as const })),
  },

  tremble: {
    frames: 4,
    loop: true,
    breath: 1.6,
    base: { hipF: 16, knF: 22, hipB: 6, knB: 20, torso: 10, head: 8, shF: 52, elF: 120, shB: 48, elB: 118, shoulders: 5 },
    keys: [
      { t: 0, p: { x: -2.2 } },
      { t: 0.5, p: { x: 2.2 } },
    ].map((k) => ({ ...k, ease: "linear" as const })),
  },

  cry: {
    frames: 30,
    loop: true,
    face: "crying",
    base: { shF: 62, elF: 146, shB: 56, elB: 142, torso: 14, head: 16 },
    keys: [
      { t: 0, p: { shoulders: 0, torso: 14, y: 0 } },
      { t: 0.2, p: { shoulders: 7, torso: 18, y: -3 }, ease: "out" },
      { t: 0.4, p: { shoulders: 1, torso: 13, y: 0 } },
      { t: 0.55, p: { shoulders: 6, torso: 17, y: -2 }, ease: "out" },
    ],
  },

  laugh: {
    frames: 18,
    loop: true,
    face: "laughing",
    base: { shF: 18, elF: 86, shB: -30, elB: -40 },
    keys: [
      { t: 0, p: { torso: -10, head: -10, lean: -2, y: 0, mouth: 1 } },
      { t: 0.5, p: { torso: 16, head: 6, lean: 2, y: -4, shB: -10, elB: -70, mouth: 0.8 } },
    ],
  },

  sigh: {
    frames: 50,
    loop: false,
    breath: 0.6,
    keys: [
      { t: 0, p: {} },
      { t: 0.3, p: { shoulders: 8, torso: -4, head: -6, mouth: 0.3 }, ease: "inOut" },
      { t: 0.8, p: { shoulders: -6, torso: 12, head: 22, shF: 4, elF: 4, shB: -4, elB: -4, knF: 6, knB: 6, mouth: 0.2 }, ease: "inOut" },
      { t: 1, p: { shoulders: -5, torso: 11, head: 20, mouth: 0 } },
    ],
  },

  rage: {
    frames: 14,
    loop: true,
    fx: "steam",
    keys: [
      { t: 0, p: { shF: 150, elF: 56, shB: 140, elB: 60, hipF: 34, knF: 50, hipB: -6, knB: 4, y: -6, torso: 6, head: -4, mouth: 1 } },
      { t: 0.25, p: { shF: 132, elF: 40, shB: 156, elB: 44, hipF: 6, knF: 4, y: 0, mouth: 0.6 }, ease: "in" },
      { t: 0.5, p: { shF: 150, elF: 56, shB: 140, elB: 60, hipF: -6, knF: 4, hipB: 34, knB: 50, y: -6, mouth: 1 } },
      { t: 0.75, p: { shF: 156, elF: 44, shB: 132, elB: 40, hipB: 6, knB: 4, y: 0, mouth: 0.6 }, ease: "in" },
    ],
  },

  faint: {
    frames: 44,
    loop: false,
    keys: [
      { t: 0, p: {} },
      { t: 0.18, p: { lean: 4, torso: 6, head: 14, shF: 4, elF: 6, shB: -4, elB: -6, knF: 10, knB: 8 } },
      { t: 0.34, p: { lean: -4, torso: -6, head: -16, knF: 18, knB: 20 } },
      { t: 0.5, p: { lean: 2, torso: 2, head: 10, knF: 30, knB: 26, hipF: 18 } },
      { t: 0.78, p: { lean: -88, torso: 0, head: 20, hipF: 30, knF: 26, hipB: 8, knB: 8, shF: 140, elF: 20, shB: 160, elB: 10, x: -60, squash: -0.06 }, ease: "in" },
      { t: 1, p: { ...LYING, x: -60, squash: 0 }, ease: "out" },
    ],
  },

  plead: {
    frames: 36,
    loop: true,
    base: { hipF: 2, knF: 96, hipB: -6, knB: 94, torso: 8, head: -14, gaze: 1, shF: 96, elF: 66, shB: 92, elB: 70 },
    keys: [
      { t: 0, p: { shF: 96, torso: 8, mouth: 0.2 } },
      { t: 0.5, p: { shF: 106, shB: 102, torso: 12, head: -10, mouth: 0.6 } },
    ],
  },

  kneel: {
    frames: 22,
    loop: false,
    keys: [
      { t: 0, p: {} },
      { t: 0.5, p: { hipF: 60, knF: 70, hipB: -10, knB: 60, torso: 14, squash: -0.04 } },
      { t: 1, p: { hipF: 86, knF: 88, hipB: 0, knB: 94, torso: 4, head: 6, shF: 46, elF: 30, shB: 4, elB: -6, squash: 0 }, ease: "out" },
    ],
  },

  yawn: {
    frames: 60,
    loop: false,
    keys: [
      { t: 0, p: {} },
      { t: 0.3, p: { shF: 172, elF: 8, shB: 168, elB: 10, torso: -10, head: -14, mouth: 1, squash: 0.06, y: -6 }, ease: "inOut" },
      { t: 0.6, p: { shF: 176, elF: 4, shB: 174, elB: 4, torso: -12, head: -16, mouth: 1, squash: 0.07, y: -8 } },
      { t: 1, p: { shF: 12, elF: 10, shB: -12, elB: -10, torso: 0, head: 0, mouth: 0, squash: 0, y: 0 }, ease: "inOut" },
    ],
  },

  tap_foot: {
    frames: 14,
    loop: true,
    base: { ...FOLDED, torso: -4, head: 6, hipB: -8, knB: 2 },
    keys: [
      { t: 0, p: { hipF: 10, knF: 4 } },
      { t: 0.4, p: { hipF: 22, knF: 34 }, ease: "out" },
      { t: 0.7, p: { hipF: 10, knF: 4 }, ease: "in" },
    ],
  },

  dance: {
    frames: 32,
    loop: true,
    keys: [
      { t: 0, p: { shF: 160, elF: 10, shB: -40, elB: -30, hipF: 20, knF: 30, hipB: -10, knB: 20, torso: -6, y: 0, head: -6 } },
      { t: 0.25, p: { shF: 40, elF: 60, shB: 30, elB: 60, hipF: 8, knF: 40, hipB: 4, knB: 40, torso: 6, y: -14, head: 6 } },
      { t: 0.5, p: { shF: -40, elF: -30, shB: 160, elB: 10, hipF: -10, knF: 20, hipB: 20, knB: 30, torso: -6, y: 0, head: -6 } },
      { t: 0.75, p: { shF: 30, elF: 60, shB: 40, elB: 60, hipF: 4, knF: 40, hipB: 8, knB: 40, torso: 6, y: -14, head: 6 } },
    ],
  },

  // ---------------------------------------------------------------- everyday

  phone_call: {
    frames: 48,
    loop: true,
    base: { ...HAND_TO_EAR, head: 6, gaze: 0.5, shB: -14, elB: -30 },
    keys: [
      { t: 0, p: { mouth: 0.1, shB: -14, elB: -30 } },
      { t: 0.2, p: { mouth: 0.8 } },
      { t: 0.4, p: { mouth: 0.2, shB: 24, elB: 70 } },
      { t: 0.6, p: { mouth: 0.7 } },
      { t: 0.8, p: { mouth: 0.1, shB: -10, elB: -24 } },
    ],
  },

  text_phone: {
    frames: 16,
    loop: true,
    base: { shF: 26, elF: 112, shB: 24, elB: 106, head: 24, torso: 6, gaze: 0.8 },
    keys: [
      { t: 0, p: { elF: 110 } },
      { t: 0.5, p: { elF: 116 } },
    ],
  },

  read: {
    frames: 90,
    loop: true,
    base: { shF: 32, elF: 100, shB: 28, elB: 104, head: 14, torso: 2 },
    keys: [
      { t: 0, p: { head: 14 } },
      { t: 0.45, p: { head: 18 } },
      { t: 0.7, p: { shB: 46, elB: 90, head: 12 }, ease: "out" },
      { t: 0.8, p: { shB: 28, elB: 104 } },
    ],
  },

  eat: {
    frames: 44,
    loop: true,
    keys: [
      { t: 0, p: { shF: 44, elF: 100, mouth: 0 } },
      { t: 0.3, p: { ...HAND_TO_MOUTH, head: -2, mouth: 0.9 }, ease: "out" },
      { t: 0.42, p: { mouth: 0.1 } },
      { t: 0.6, p: { shF: 44, elF: 100, mouth: 0.5 } },
      { t: 0.75, p: { mouth: 0.1 } },
      { t: 0.88, p: { mouth: 0.4 } },
    ],
  },

  drink: {
    frames: 64,
    loop: true,
    keys: [
      { t: 0, p: { shF: 40, elF: 96, head: 0 } },
      { t: 0.3, p: { ...HAND_TO_MOUTH, shF: 82, head: -14, torso: -4 }, ease: "out" },
      { t: 0.55, p: { shF: 86, head: -16, torso: -5 } },
      { t: 0.8, p: { shF: 40, elF: 96, head: 0, torso: 0 } },
    ],
  },

  knock: {
    frames: 24,
    loop: true,
    base: { torso: 4, shB: -14, elB: -14 },
    keys: [
      { t: 0, p: { shF: 74, elF: 74 } },
      { t: 0.15, p: { shF: 84, elF: 36 }, ease: "snap" },
      { t: 0.3, p: { shF: 74, elF: 74 } },
      { t: 0.45, p: { shF: 84, elF: 36 }, ease: "snap" },
      { t: 0.6, p: { shF: 72, elF: 80 } },
    ],
  },

  peek: {
    frames: 90,
    loop: true,
    keys: [
      { t: 0, p: { lean: 0, torso: 2, head: 0, shF: 30, elF: 60 } },
      { t: 0.35, p: { lean: 12, torso: 22, head: -12, shF: 50, elF: 80, hipB: -16 }, ease: "inOut" },
      { t: 0.65, p: { lean: 12, torso: 22, head: -10 } },
    ],
  },

  climb: {
    frames: 32,
    loop: true,
    keys: [
      { t: 0, p: { shF: 168, elF: 16, shB: 120, elB: 70, hipF: 70, knF: 100, hipB: 4, knB: 6, torso: 4, head: -10, y: 0 } },
      { t: 0.5, p: { shF: 120, elF: 70, shB: 168, elB: 16, hipF: 4, knF: 6, hipB: 70, knB: 100, y: 0 } },
    ],
  },

  sit_chair: {
    frames: 20,
    loop: false,
    perch: true,
    breath: 0.8,
    keys: [
      { t: 0, p: {} },
      { t: 0.5, p: { torso: 18, hipF: 50, knF: 60, hipB: 44, knB: 56, squash: -0.03 } },
      { t: 1, p: { ...PERCH, shF: 36, elF: 40, squash: 0 }, ease: "out" },
    ],
  },

  sit_edge: {
    frames: 40,
    loop: true,
    perch: true,
    base: { ...PERCH, shF: 6, elF: 14, shB: -6, elB: 10, torso: 4, head: 4 },
    keys: [
      { t: 0, p: { knF: 70, knB: 104 } },
      { t: 0.5, p: { knF: 104, knB: 70 } },
    ],
  },

  type: {
    frames: 10,
    loop: true,
    perch: true,
    base: { ...PERCH, shF: 48, elF: 66, shB: 44, elB: 72, torso: 6, head: 8, gaze: 1 },
    keys: [
      { t: 0, p: { elF: 62, elB: 76 } },
      { t: 0.5, p: { elF: 72, elB: 66 } },
    ],
  },

  drive: {
    frames: 30,
    loop: true,
    perch: true,
    speed: 430,
    base: { ...PERCH, shF: 68, elF: 44, shB: 64, elB: 48, torso: 0, head: -2 },
    keys: [
      { t: 0, p: { y: 0, head: -2 } },
      { t: 0.5, p: { y: -2, head: 0 } },
    ],
  },

  // ---------------------------------------------------------------- effort and conflict

  push: {
    frames: 40,
    loop: true,
    base: { lean: 26, torso: 10, head: -16, shF: 96, elF: 8, shB: 90, elB: 12 },
    keys: [
      { t: 0, p: { hipF: 34, knF: 30, hipB: -38, knB: 8, x: 0 } },
      { t: 0.5, p: { hipF: 30, knF: 36, hipB: -42, knB: 6, x: 3, squash: -0.02 } },
    ],
  },

  pull: {
    frames: 36,
    loop: true,
    base: { lean: -18, torso: -12, head: 8, shF: 74, elF: 6, shB: 70, elB: 10 },
    keys: [
      { t: 0, p: { hipF: 38, knF: 8, hipB: -6, knB: 34, x: 0 } },
      { t: 0.5, p: { hipF: 42, knF: 10, hipB: -10, knB: 40, x: -6, lean: -22 } },
    ],
  },

  lift: {
    frames: 44,
    loop: false,
    keys: [
      { t: 0, p: {} },
      { t: 0.3, p: { hipF: 72, knF: 112, hipB: 62, knB: 108, torso: 34, head: -10, shF: 34, elF: 20, shB: 30, elB: 22, squash: -0.05 }, ease: "inOut" },
      { t: 0.55, p: { hipF: 66, knF: 104, torso: 30, squash: -0.07, mouth: 0.6 } },
      { t: 1, p: { hipF: 6, knF: 4, hipB: -6, knB: 4, torso: -6, head: -2, shF: 50, elF: 70, shB: 46, elB: 74, squash: 0, mouth: 0 }, ease: "out" },
    ],
  },

  throw: {
    frames: 26,
    loop: false,
    keys: [
      { t: 0, p: {} },
      { t: 0.4, p: { shF: -70, elF: 50, torso: -12, lean: -5, hipF: 26, knF: 6, hipB: -18, knB: 10, shB: 60, elB: 20 }, ease: "inOut" },
      { t: 0.6, p: { shF: 140, elF: 6, torso: 18, lean: 7, shB: -40, elB: -20 }, ease: "snap" },
      { t: 1, p: { shF: 70, elF: 18, torso: 14, lean: 5 } },
    ],
  },

  punch: {
    frames: 18,
    loop: false,
    base: { shB: 52, elB: 122 },
    keys: [
      { t: 0, p: { shF: 30, elF: 110 } },
      { t: 0.45, p: { shF: 22, elF: 132, torso: -8, lean: -3, hipF: 20, hipB: -16 }, ease: "inOut" },
      { t: 0.7, p: { shF: 90, elF: 0, torso: 14, lean: 6, squash: 0.02 }, ease: "snap" },
      { t: 1, p: { shF: 88, elF: 4, torso: 12, lean: 5, squash: 0 } },
    ],
  },

  kick: {
    frames: 28,
    loop: false,
    keys: [
      { t: 0, p: {} },
      { t: 0.3, p: { hipF: -30, knF: 70, lean: -4, shF: 40, elF: 60, shB: -40, elB: -30 }, ease: "inOut" },
      { t: 0.5, p: { hipF: 96, knF: 0, lean: -14, torso: -10, shF: -30, shB: 50 }, ease: "snap" },
      { t: 0.7, p: { hipF: 90, knF: 6, lean: -12, torso: -8 } },
      { t: 1, p: { hipF: 5, knF: 2, lean: 0, torso: 0, shF: 12, elF: 10, shB: -12, elB: -10 }, ease: "inOut" },
    ],
  },

  dodge: {
    frames: 12,
    loop: false,
    keys: [
      { t: 0, p: {} },
      { t: 0.6, p: { lean: -22, torso: -16, head: 6, hipF: 34, knF: 54, hipB: 20, knB: 64, shF: 104, elF: 96, shB: 96, elB: 100, squash: -0.08, x: -20 }, ease: "snap" },
      { t: 1, p: { lean: -18, torso: -12, squash: -0.04, x: -22 } },
    ],
  },

  fists_up: {
    frames: 22,
    loop: true,
    base: { torso: 8, head: -4, shF: 56, elF: 126, shB: 46, elB: 132 },
    keys: [
      { t: 0, p: { hipF: 22, knF: 26, hipB: -16, knB: 22, y: 0 } },
      { t: 0.5, p: { hipF: 18, knF: 14, hipB: -12, knB: 12, y: -8, shF: 62 } },
    ],
  },

  stumble: {
    frames: 40,
    loop: false,
    keys: [
      { t: 0, p: {} },
      { t: 0.2, p: { lean: 18, torso: 10, hipB: -40, knB: 30, hipF: 20, shF: 150, elF: 20, shB: -120, elB: -10, head: -10 }, ease: "out" },
      { t: 0.45, p: { lean: 22, hipF: 60, knF: 30, hipB: -30, shF: 40, elF: 30, shB: 150, elB: 20, mouth: 0.8 } },
      { t: 0.65, p: { lean: 8, torso: 6, hipF: 30, knF: 20, hipB: -10, knB: 10, shF: 120, shB: 60 } },
      { t: 1, p: { lean: 0, torso: 0, hipF: 5, knF: 2, hipB: -5, knB: 2, shF: 12, elF: 10, shB: -12, elB: -10, head: 0, mouth: 0 }, ease: "back" },
    ],
  },

  // ---------------------------------------------------------------- travel

  trudge: {
    frames: 48,
    loop: true,
    speed: 90,
    base: { torso: 14, head: 22, gaze: 0.8, shoulders: -4 },
    keys: [
      { t: 0, p: { hipF: 16, knF: 4, hipB: -14, knB: 10, shF: -8, elF: 8, shB: 8, elB: 8 } },
      { t: 0.25, p: { hipF: 2, knF: 4, hipB: 4, knB: 30, shF: 0, shB: 0, y: -2 } },
      { t: 0.5, p: { hipF: -14, knF: 10, hipB: 16, knB: 4, shF: 8, elF: 8, shB: -8, elB: 8, y: 0 } },
      { t: 0.75, p: { hipF: 4, knF: 30, hipB: 2, knB: 4, shF: 0, shB: 0, y: -2 } },
    ],
  },

  march: {
    frames: 28,
    loop: true,
    speed: 200,
    base: { torso: -4, head: -4 },
    keys: [
      { t: 0, p: { hipF: 22, knF: 4, hipB: -20, knB: 8, shF: -36, elF: 2, shB: 44, elB: 2 } },
      { t: 0.25, p: { hipF: -4, knF: 6, hipB: 74, knB: 92, shF: 0, shB: 0, y: -4 } },
      { t: 0.5, p: { hipF: -20, knF: 8, hipB: 22, knB: 4, shF: 44, elF: 2, shB: -36, elB: 2, y: 0 } },
      { t: 0.75, p: { hipF: 74, knF: 92, hipB: -4, knB: 6, shF: 0, shB: 0, y: -4 } },
    ],
  },

  skip: {
    frames: 26,
    loop: true,
    speed: 260,
    keys: [
      { t: 0, p: { hipF: 20, knF: 10, hipB: -16, knB: 30, shF: -30, elF: 40, shB: 120, elB: 30, y: 0, squash: -0.05 } },
      { t: 0.25, p: { hipF: -6, knF: 8, hipB: 70, knB: 90, y: -34, squash: 0.04 } },
      { t: 0.5, p: { hipF: -16, knF: 30, hipB: 20, knB: 10, shF: 120, elF: 30, shB: -30, elB: 40, y: 0, squash: -0.05 } },
      { t: 0.75, p: { hipF: 70, knF: 90, hipB: -6, knB: 8, y: -34, squash: 0.04 } },
    ],
  },

  flee: {
    frames: 18,
    loop: true,
    speed: 600,
    fx: "sweat",
    base: { gaze: -1, head: -8 },
    keys: [
      { t: 0, p: { hipF: 46, knF: 22, hipB: -34, knB: 72, shF: 160, elF: 30, shB: 120, elB: 60, torso: 12, y: 0, mouth: 1 } },
      { t: 0.25, p: { hipF: 6, knF: 18, hipB: 12, knB: 112, shF: 130, shB: 160, y: -14 } },
      { t: 0.5, p: { hipF: -34, knF: 72, hipB: 46, knB: 22, shF: 120, elF: 60, shB: 160, elB: 30, y: 0, mouth: 0.7 } },
      { t: 0.75, p: { hipF: 12, knF: 112, hipB: 6, knB: 18, shF: 160, shB: 130, y: -14 } },
    ],
  },

  carry: {
    frames: 34,
    loop: true,
    speed: 170,
    base: { torso: -4, head: -2, shF: 52, elF: 68, shB: 48, elB: 74 },
    keys: [
      { t: 0, p: { hipF: 22, knF: 4, hipB: -20, knB: 14, y: 0 } },
      { t: 0.25, p: { hipF: 2, knF: 5, hipB: 6, knB: 48, y: -3 } },
      { t: 0.5, p: { hipF: -20, knF: 14, hipB: 22, knB: 4, y: 0 } },
      { t: 0.75, p: { hipF: 6, knF: 48, hipB: 2, knB: 5, y: -3 } },
    ],
  },

  crawl: {
    frames: 40,
    loop: true,
    speed: 70,
    base: { lean: 68, torso: 0, head: -58, gaze: 1, hipF: 68, knF: 92, hipB: 68, knB: 92, shF: 68, elF: 0, shB: 68, elB: 0 },
    keys: [
      { t: 0, p: { shF: 84, shB: 54, hipF: 58, hipB: 80 } },
      { t: 0.5, p: { shF: 54, shB: 84, hipF: 80, hipB: 58 } },
    ],
  },
};

export const ACTION_LIB: Record<ActionId, Compiled> = Object.fromEntries(
  Object.entries(defs).map(([id, d]) => [id, compile(d)]),
) as Record<ActionId, Compiled>;
