import type { CameraId } from "@studio/schema";
import { createContext, useContext, type ReactNode } from "react";
import { EASE } from "../rig/pose";
import type { Vec } from "../rig/skeleton";
import { LANDSCAPE, type View } from "../scene/view";
import { H, W } from "../theme";

/**
 * The camera: a zoom around a focal point, plus a shake offset, a roll and a
 * horizontal motion blur. Layers with depth < 1 move less than the
 * characters' plane (depth 1), which gives parallax for free on every move.
 *
 * Every move starts from a base view: the whole frame for a wide shot, or a
 * medium shot framed on the characters (scene `framing`). Moves never touch
 * timing; they only read the scene's own frame and length.
 */
export type Cam = {
  zoom: number;
  f: Vec;
  shake: Vec;
  rot: number;
  blur: number;
  /**
   * Portrait only: the view the scene rests in. Layers share it exactly, so a
   * background's horizon and its parallax layers stay aligned at rest; the
   * camera's move *away* from it is what depth weights (see layerTransform).
   */
  base?: Base;
  view?: View;
};
export type Base = { zoom: number; f: Vec };

export const CENTER: Vec = { x: W / 2, y: H / 2 };
export const WIDE: Base = { zoom: 1, f: CENTER };
export const STILL: Cam = { zoom: 1, f: CENTER, shake: { x: 0, y: 0 }, rot: 0, blur: 0 };
export const CameraContext = createContext<Cam>(STILL);

export function layerTransform(cam: Cam, depth: number): string {
  const view = cam.view ?? LANDSCAPE;
  const rot = cam.rot ? ` rotate(${cam.rot.toFixed(3)})` : "";
  if (view.kind === "portrait" && cam.base) {
    // Rest pose = the base view, the same for every layer. The camera's zoom and pan relative to it are weighted by depth:
    // depth 1 follows the camera exactly, depth 0 stays at the base. (Landscape's base is the whole frame, so this is
    // the same formula with base = {zoom 1, centre}.)
    const b = cam.base;
    const z = b.zoom * (1 + (cam.zoom / b.zoom - 1) * depth);
    const fx = b.f.x + (cam.f.x - b.f.x) * depth;
    const fy = b.f.y + (cam.f.y - b.f.y) * depth;
    const sx = view.width / 2 + cam.shake.x * depth;
    const sy = view.height / 2 + cam.shake.y * depth;
    return `translate(${sx.toFixed(2)} ${sy.toFixed(2)})${rot} scale(${z.toFixed(5)}) translate(${(-fx).toFixed(2)} ${(-fy).toFixed(2)})`;
  }
  const z = 1 + (cam.zoom - 1) * depth;
  const fx = W / 2 + (cam.f.x - W / 2) * depth;
  const fy = H / 2 + (cam.f.y - H / 2) * depth;
  const sx = W / 2 + cam.shake.x * depth;
  const sy = H / 2 + cam.shake.y * depth;
  return `translate(${sx.toFixed(2)} ${sy.toFixed(2)})${rot} scale(${z.toFixed(5)}) translate(${(-fx).toFixed(2)} ${(-fy).toFixed(2)})`;
}

export function Layer({ depth, children }: { depth: number; children: ReactNode }) {
  const cam = useContext(CameraContext);
  return <g transform={layerTransform(cam, depth)}>{children}</g>;
}

/** How far past the frame the backgrounds draw (backgrounds/common.tsx BLEED), which is all the vertical frame may use. */
const WORLD = { x0: -260, x1: W + 260, y0: -260, y1: H + 260 };
const between = (lo: number, hi: number, v: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));

/**
 * Keeps the focal point where the frame never shows past the edge of the world:
 * the 1920×1080 stage for a wide frame, the stage and its bleed for the tall one (whose zoom is always high enough
 * that its window fits the drawn world, see scene/portrait.ts).
 */
export function clamp(f: Vec, zoom: number, view: View = LANDSCAPE): Vec {
  if (view.kind === "portrait") {
    const hx = view.width / (2 * zoom);
    const hy = view.height / (2 * zoom);
    return { x: between(WORLD.x0 + hx, WORLD.x1 - hx, f.x), y: between(WORLD.y0 + hy, WORLD.y1 - hy, f.y) };
  }
  const hx = W / (2 * zoom);
  const hy = H / (2 * zoom);
  return { x: Math.min(W - hx, Math.max(hx, f.x)), y: Math.min(H - hy, Math.max(hy, f.y)) };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpV = (a: Vec, b: Vec, t: number): Vec => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
const NONE = { shake: { x: 0, y: 0 }, rot: 0, blur: 0 };

export type CamTargets = { chars: Vec; face: Vec };

type Move = (frame: number, duration: number, t: CamTargets, base: Base, v?: View) => Cam;

const WHIP = 11; // frames of a whip pan
/** A close-up's zoom: the face fills about a third of the frame's width in the wide frame, and the same in the tall one. */
const FACE_ZOOM = { landscape: 2.15, portrait: 3.4 } as const;

export const CAMERAS: Record<CameraId, Move> = {
  static: (_f, _d, _t, base, v = LANDSCAPE) => ({ zoom: base.zoom, f: clamp(base.f, base.zoom, v), ...NONE }),

  slow_push: (frame, duration, t, base, v = LANDSCAPE) => {
    const k = EASE.inOut(Math.min(1, frame / duration));
    const zoom = base.zoom * lerp(1, 1.15, k);
    return { zoom, f: clamp(lerpV(base.f, t.chars, k * 0.85), zoom, v), ...NONE };
  },

  shake: (frame, _d, _t, base, v = LANDSCAPE) => {
    const amp = 24 * Math.exp(-frame / 9) + 3.5;
    const zoom = base.zoom * 1.07;
    return {
      zoom,
      f: clamp(base.f, zoom, v),
      shake: {
        x: amp * 0.5 * (Math.sin(frame * 1.93) + Math.sin(frame * 3.71 + 1.3)),
        y: amp * 0.5 * (Math.sin(frame * 2.37 + 0.6) + Math.sin(frame * 4.13 + 2.1)),
      },
      rot: 0,
      blur: 0,
    };
  },

  zoom_face: (frame, duration, t, base, v = LANDSCAPE) => {
    const k = EASE.back(Math.min(1, frame / 12));
    const drift = Math.min(1, frame / Math.max(1, duration)) * 0.06;
    const zoom = lerp(base.zoom, Math.max(FACE_ZOOM[v.kind], base.zoom * 1.35), k) + drift;
    return { zoom, f: clamp(lerpV(base.f, t.face, Math.min(1, k)), zoom, v), ...NONE };
  },

  dolly_out: (frame, duration, t, base, v = LANDSCAPE) => {
    const k = EASE.out(Math.min(1, frame / duration));
    const zoom = base.zoom * lerp(1.4, 1, k);
    return { zoom, f: clamp(lerpV(t.chars, base.f, k), zoom, v), ...NONE };
  },

  pan_left: (frame, duration, _t, base, v = LANDSCAPE) => {
    const k = EASE.inOut(Math.min(1, frame / duration));
    const zoom = base.zoom * 1.2;
    return { zoom, f: clamp({ x: base.f.x + lerp(150, -150, k) / base.zoom, y: base.f.y }, zoom, v), ...NONE };
  },

  pan_right: (frame, duration, _t, base, v = LANDSCAPE) => {
    const k = EASE.inOut(Math.min(1, frame / duration));
    const zoom = base.zoom * 1.2;
    return { zoom, f: clamp({ x: base.f.x + lerp(-150, 150, k) / base.zoom, y: base.f.y }, zoom, v), ...NONE };
  },

  whip_pan: (frame, _d, _t, base, v = LANDSCAPE) => {
    const zoom = base.zoom * 1.06;
    const k = EASE.out(Math.min(1, frame / WHIP));
    const kPrev = EASE.out(Math.min(1, Math.max(0, frame - 1) / WHIP));
    const from = base.f.x - 1100;
    const x = lerp(from, base.f.x, k);
    const speed = Math.abs((k - kPrev) * 1100) * zoom;
    return { zoom, f: clamp({ x, y: base.f.y }, zoom, v), shake: { x: 0, y: 0 }, rot: 0, blur: Math.min(46, speed * 0.32) };
  },

  tilt_up: (frame, duration, _t, base, v = LANDSCAPE) => {
    const k = EASE.inOut(Math.min(1, frame / Math.min(duration, 75)));
    const zoom = base.zoom * 1.3;
    return { zoom, f: clamp({ x: base.f.x, y: lerp(base.f.y + 320, base.f.y - 60, k) }, zoom, v), ...NONE };
  },

  handheld: (frame, _d, _t, base, v = LANDSCAPE) => {
    const s = frame / 30;
    const zoom = base.zoom * 1.06;
    return {
      zoom,
      f: clamp(base.f, zoom, v),
      shake: { x: 7 * Math.sin(s * 1.3) + 3 * Math.sin(s * 3.1 + 1), y: 5 * Math.sin(s * 1.7 + 2) + 2 * Math.sin(s * 4.3) },
      rot: 0.5 * Math.sin(s * 0.9 + 0.4),
      blur: 0,
    };
  },

  dutch_angle: (frame, duration, t, base, v = LANDSCAPE) => {
    const k = EASE.out(Math.min(1, frame / 20));
    const push = EASE.inOut(Math.min(1, frame / duration));
    const zoom = base.zoom * lerp(1.14, 1.22, push);
    return { zoom, f: clamp(lerpV(base.f, t.chars, 0.4), zoom, v), shake: { x: 0, y: 0 }, rot: -7 * k, blur: 0 };
  },
};
