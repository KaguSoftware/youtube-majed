import type { ExpressionId } from "@studio/schema";
import { FPS } from "../theme";
import { EASE, NEUTRAL, lerpPose, type Ease, type Pose } from "./pose";

/**
 * An action is a short clip of pose keyframes. `t` runs 0..1 over `frames`.
 * Channels a key leaves out carry over from the previous key (the first key
 * falls back to `base`, then to the neutral pose). The `ease` on a key shapes
 * the move *from* that key to the next.
 */
export type Key = { t: number; p: Partial<Pose>; ease?: Ease };

export type ActionDef = {
  frames: number;
  loop: boolean;
  keys: Key[];
  base?: Partial<Pose>;
  /** px per second of travel, for walk/run/sneak/sleepwalk. */
  speed?: number;
  /** Breathing strength (1 = normal). */
  breath?: number;
  /** Extra drawn effect. */
  fx?: "zzz" | "sweat" | "speed";
  /** Forces a face regardless of the scene's expr (e.g. eyes shut while asleep). */
  face?: ExpressionId;
  /** The character is lying down: props it shares a pos with are a bed to lie on. */
  lying?: boolean;
};

export type Compiled = ActionDef & { poses: Pose[] };

export function compile(def: ActionDef): Compiled {
  const start: Pose = { ...NEUTRAL, ...def.base };
  const keys = [...def.keys];
  if (keys[0]?.t !== 0) throw new Error("action keys must start at t = 0");
  const poses: Pose[] = [];
  let prev = start;
  for (const k of keys) {
    prev = { ...prev, ...k.p };
    poses.push(prev);
  }
  if (def.loop && keys[keys.length - 1]!.t < 1) {
    keys.push({ t: 1, p: {} });
    poses.push(poses[0]!);
  }
  return { ...def, keys, poses };
}

/** The action's pose at a frame. Loops wrap; one-shots hold their last pose. */
export function sample(a: Compiled, frame: number): Pose {
  const u = a.loop ? (((frame / a.frames) % 1) + 1) % 1 : Math.min(1, Math.max(0, frame / a.frames));
  const { keys, poses } = a;
  if (u >= keys[keys.length - 1]!.t) return poses[poses.length - 1]!;
  let i = 0;
  while (i < keys.length - 2 && u >= keys[i + 1]!.t) i++;
  const k0 = keys[i]!;
  const k1 = keys[i + 1]!;
  const local = (u - k0.t) / (k1.t - k0.t);
  return lerpPose(poses[i]!, poses[i + 1]!, EASE[k0.ease ?? "inOut"](local));
}

/**
 * The action plus the life layered on top of it, so a figure never looks frozen:
 * - follow-through: forearms trail the upper arms by 2 frames, the head by 3;
 * - breathing: the spine stretches, the shoulders and arms lift a little;
 * - a slow head drift.
 * `phase` (0..1) desynchronises characters sharing a scene.
 */
export function alive(a: Compiled, frame: number, phase: number): { pose: Pose; breath: number } {
  const offset = a.loop ? Math.round(phase * a.frames) : 0;
  const f = frame + offset;
  const pose = { ...sample(a, f) };
  const lagArms = sample(a, f - 2);
  const lagHead = sample(a, f - 3);
  pose.elF = lagArms.elF;
  pose.elB = lagArms.elB;
  pose.head = lagHead.head;

  const s = frame / FPS;
  const amp = a.breath ?? 1;
  const b = Math.sin(((s / 3.4) + phase) * Math.PI * 2);
  pose.shoulders += 1.3 * b * amp;
  pose.shF += 1.6 * b * amp;
  pose.shB -= 1.6 * b * amp;
  pose.head += 1.4 * Math.sin(((s / 4.7) + phase * 1.7) * Math.PI * 2);
  return { pose, breath: 1 + 0.016 * b * amp };
}

/** 0..1 eye closure: a quick blink every 2.5–4 s, per character. */
export function blink(frame: number, phase: number): number {
  const period = Math.round(FPS * (2.6 + phase * 1.4));
  const f = (frame + Math.round(phase * 211)) % period;
  if (f > 5) return 0;
  return [0.5, 1, 1, 0.6, 0.2, 0][f] ?? 0;
}
