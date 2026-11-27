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
};

export const ACTION_LIB: Record<ActionId, Compiled> = Object.fromEntries(
  Object.entries(defs).map(([id, d]) => [id, compile(d)]),
) as Record<ActionId, Compiled>;
