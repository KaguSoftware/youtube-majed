import type { CameraId } from "@studio/schema";
import { createContext, useContext, type ReactNode } from "react";
import { EASE } from "../rig/pose";
import type { Vec } from "../rig/skeleton";
import { H, W } from "../theme";

/**
 * The camera: a zoom around a focal point, plus a shake offset. Layers with
 * depth < 1 move less than the characters' plane (depth 1), which gives
 * parallax for free on every move.
 */
export type Cam = { zoom: number; f: Vec; shake: Vec };

export const STILL: Cam = { zoom: 1, f: { x: W / 2, y: H / 2 }, shake: { x: 0, y: 0 } };
export const CameraContext = createContext<Cam>(STILL);

export function layerTransform(cam: Cam, depth: number): string {
  const z = 1 + (cam.zoom - 1) * depth;
  const fx = W / 2 + (cam.f.x - W / 2) * depth;
  const fy = H / 2 + (cam.f.y - H / 2) * depth;
  const sx = W / 2 + cam.shake.x * depth;
  const sy = H / 2 + cam.shake.y * depth;
  return `translate(${sx.toFixed(2)} ${sy.toFixed(2)}) scale(${z.toFixed(5)}) translate(${(-fx).toFixed(2)} ${(-fy).toFixed(2)})`;
}

export function Layer({ depth, children }: { depth: number; children: ReactNode }) {
  const cam = useContext(CameraContext);
  return <g transform={layerTransform(cam, depth)}>{children}</g>;
}

/** Keeps the focal point where the frame never shows past the edge of the world. */
function clamp(f: Vec, zoom: number): Vec {
  const hx = W / (2 * zoom);
  const hy = H / (2 * zoom);
  return { x: Math.min(W - hx, Math.max(hx, f.x)), y: Math.min(H - hy, Math.max(hy, f.y)) };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpV = (a: Vec, b: Vec, t: number): Vec => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
const CENTER: Vec = { x: W / 2, y: H / 2 };

export type CamTargets = { chars: Vec; face: Vec };

type Move = (frame: number, duration: number, t: CamTargets) => Cam;

export const CAMERAS: Record<CameraId, Move> = {
  static: () => STILL,

  slow_push: (frame, duration, t) => {
    const k = EASE.inOut(Math.min(1, frame / duration));
    const zoom = lerp(1, 1.15, k);
    return { zoom, f: clamp(lerpV(CENTER, t.chars, k * 0.85), zoom), shake: { x: 0, y: 0 } };
  },

  shake: (frame) => {
    const amp = 24 * Math.exp(-frame / 9) + 3.5;
    const zoom = 1.07;
    return {
      zoom,
      f: CENTER,
      shake: {
        x: amp * 0.5 * (Math.sin(frame * 1.93) + Math.sin(frame * 3.71 + 1.3)),
        y: amp * 0.5 * (Math.sin(frame * 2.37 + 0.6) + Math.sin(frame * 4.13 + 2.1)),
      },
    };
  },

  zoom_face: (frame, duration, t) => {
    const k = EASE.back(Math.min(1, frame / 12));
    const drift = Math.min(1, frame / Math.max(1, duration)) * 0.06;
    const zoom = lerp(1, 2.15, k) + drift;
    return { zoom, f: clamp(lerpV(CENTER, t.face, Math.min(1, k)), zoom), shake: { x: 0, y: 0 } };
  },

  dolly_out: (frame, duration, t) => {
    const k = EASE.out(Math.min(1, frame / duration));
    const zoom = lerp(1.4, 1, k);
    return { zoom, f: clamp(lerpV(t.chars, CENTER, k), zoom), shake: { x: 0, y: 0 } };
  },
};
