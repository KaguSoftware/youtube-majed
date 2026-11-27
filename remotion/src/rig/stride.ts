import type { Compiled } from "./animate";
import { sample } from "./animate";
import { solve, type Body } from "./skeleton";
import { FPS } from "../theme";

/**
 * Travel that matches the legs, so feet don't slide. For each frame of a
 * travelling action's cycle, the foot nearest the ground is the planted one;
 * the body moves forward by exactly as much as that foot sweeps backward
 * relative to the hip. Summed over the cycle this gives the stride, and the
 * distance travelled at any frame. Actions whose legs barely move (driving)
 * fall back to their fixed `speed`.
 */

type Table = { cum: number[]; perCycle: number };
const cache = new WeakMap<Compiled, Map<string, Table>>();

function table(a: Compiled, body: Body): Table {
  const key = `${body.torso.toFixed(2)}|${body.thigh.toFixed(2)}|${body.shin.toFixed(2)}`;
  let byBody = cache.get(a);
  if (!byBody) cache.set(a, (byBody = new Map()));
  const hit = byBody.get(key);
  if (hit) return hit;

  const cum = [0];
  const foot = (f: number) => {
    const j = solve(sample(a, f), 1, body);
    const front = Math.max(j.ankleF.y, j.toeF.y);
    const back = Math.max(j.ankleB.y, j.toeB.y);
    return { front, back, j };
  };
  for (let f = 0; f < a.frames; f++) {
    const now = foot(f);
    const next = foot(f + 1);
    const planted = now.front >= now.back ? "F" : "B";
    const dx = planted === "F" ? next.j.ankleF.x - now.j.ankleF.x : next.j.ankleB.x - now.j.ankleB.x;
    cum.push(cum[f]! + Math.max(0, -dx));
  }
  const t = { cum, perCycle: cum[a.frames]! };
  byBody.set(key, t);
  return t;
}

/** Screen px travelled after `frame` frames (frame 0 = 0). `size` = figure screen scale. */
export function travelled(a: Compiled, body: Body, size: number, frame: number, phase: number): number {
  const f = Math.max(0, frame);
  const { cum, perCycle } = table(a, body);
  if (perCycle < 4 || !a.loop) return ((a.speed ?? 200) * f) / FPS;
  const offset = Math.round(phase * a.frames);
  const at = (n: number) => {
    const whole = Math.floor(n / a.frames);
    const i = Math.floor(n - whole * a.frames);
    return whole * perCycle + cum[i]!;
  };
  return (at(f + offset) - at(offset)) * size;
}

/** First frame at which `distance` px has been covered (Infinity if never). */
export function arrivalFrame(a: Compiled, body: Body, size: number, distance: number, phase: number): number {
  if (!Number.isFinite(distance)) return Infinity;
  if (distance <= 0) return 0;
  let lo = 0;
  let hi = 1;
  while (travelled(a, body, size, hi, phase) < distance) {
    hi *= 2;
    if (hi > 1e6) return Infinity;
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (travelled(a, body, size, mid, phase) >= distance) hi = mid;
    else lo = mid;
  }
  return hi;
}
