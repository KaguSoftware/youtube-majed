import type { BeardId, ExpressionId, FaceFeatureId } from "@studio/schema";
import { Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import * as THREE from "three";
import { FACES } from "../rig/faces";
import { Beard, FaceFeatures } from "../rig/head";

/**
 * Faces for the low-poly heads: the 2D face sprites (rig/faces.tsx), with
 * beards and face features (rig/head.tsx), painted onto a canvas texture.
 * Every expression and face feature of the stick style works here unchanged.
 *
 * The 2D faces are React SVG trees made of g/path/ellipse/circle/text. This
 * walks the tree and paints it with Canvas 2D (Path2D takes SVG path data
 * as is), synchronously, so no image has to load before a frame can render.
 *
 * Head space is the 2D one: centre (0, 0), radius 34, y down. The texture
 * covers SPAN units each way; the head's face decal maps it flat onto the
 * front of the head (see Figure3D).
 */

/** Half the width the texture covers, in 2D head units (head radius 34): less than the radius, so the features read larger on the 3D head. */
export const SPAN = 29;
const SIZE = 512;
const K = SIZE / (2 * SPAN);

type Style = {
  fill: string;
  stroke: string;
  strokeWidth: number;
  cap: CanvasLineCap;
  join: CanvasLineJoin;
  opacity: number;
  font: { family: string; weight: string | number; size: number };
};

type Props = Record<string, unknown> & { children?: ReactNode };

function parseTransform(ctx: CanvasRenderingContext2D, t: string) {
  const re = /(translate|scale|rotate)\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const n = m[2]!.split(/[\s,]+/).filter(Boolean).map(Number);
    if (m[1] === "translate") ctx.translate(n[0] ?? 0, n[1] ?? 0);
    else if (m[1] === "scale") ctx.scale(n[0] ?? 1, n[1] ?? n[0] ?? 1);
    else {
      const a = ((n[0] ?? 0) * Math.PI) / 180;
      if (n.length >= 3) {
        ctx.translate(n[1]!, n[2]!);
        ctx.rotate(a);
        ctx.translate(-n[1]!, -n[2]!);
      } else ctx.rotate(a);
    }
  }
}

function paintShape(ctx: CanvasRenderingContext2D, path: Path2D, s: Style) {
  ctx.globalAlpha = s.opacity;
  if (s.fill !== "none") {
    ctx.fillStyle = s.fill;
    ctx.fill(path);
  }
  if (s.stroke !== "none" && s.strokeWidth > 0) {
    ctx.strokeStyle = s.stroke;
    ctx.lineWidth = s.strokeWidth;
    ctx.lineCap = s.cap;
    ctx.lineJoin = s.join;
    ctx.stroke(path);
  }
}

function paint(ctx: CanvasRenderingContext2D, node: ReactNode, inherited: Style, ink: string) {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (Array.isArray(node)) {
    for (const n of node) paint(ctx, n, inherited, ink);
    return;
  }
  if (!isValidElement(node)) return;
  const el = node as ReactElement<Props>;
  const props = el.props;
  if (el.type === Fragment) return paint(ctx, props.children, inherited, ink);
  if (typeof el.type === "function") return paint(ctx, (el.type as (p: Props) => ReactNode)(props), inherited, ink);

  const color = (v: unknown, fallback: string) => (v === undefined ? fallback : v === "currentColor" ? ink : String(v));
  const s: Style = {
    fill: color(props.fill, inherited.fill),
    stroke: color(props.stroke, inherited.stroke),
    strokeWidth: props.strokeWidth === undefined ? inherited.strokeWidth : Number(props.strokeWidth),
    cap: (props.strokeLinecap as CanvasLineCap | undefined) ?? inherited.cap,
    join: (props.strokeLinejoin as CanvasLineJoin | undefined) ?? inherited.join,
    opacity: inherited.opacity * (props.opacity === undefined ? 1 : Number(props.opacity)),
    font: {
      family: (props.fontFamily as string | undefined) ?? inherited.font.family,
      weight: (props.fontWeight as number | undefined) ?? inherited.font.weight,
      size: props.fontSize === undefined ? inherited.font.size : Number(props.fontSize),
    },
  };

  ctx.save();
  if (typeof props.transform === "string") parseTransform(ctx, props.transform);
  const n = (k: string) => Number(props[k] ?? 0);
  switch (el.type) {
    case "g":
      paint(ctx, props.children, s, ink);
      break;
    case "path":
      paintShape(ctx, new Path2D(String(props.d)), s);
      break;
    case "ellipse": {
      const p = new Path2D();
      p.ellipse(n("cx"), n("cy"), Math.max(0, n("rx")), Math.max(0, n("ry")), 0, 0, Math.PI * 2);
      paintShape(ctx, p, s);
      break;
    }
    case "circle": {
      const p = new Path2D();
      p.arc(n("cx"), n("cy"), Math.max(0, n("r")), 0, Math.PI * 2);
      paintShape(ctx, p, s);
      break;
    }
    case "rect": {
      const p = new Path2D();
      p.rect(n("x"), n("y"), n("width"), n("height"));
      paintShape(ctx, p, s);
      break;
    }
    case "text": {
      ctx.globalAlpha = s.opacity;
      ctx.fillStyle = s.fill;
      ctx.font = `${s.font.weight} ${s.font.size}px ${s.font.family}`;
      ctx.fillText(String(props.children ?? ""), n("x"), n("y"));
      break;
    }
    default:
      // defs, filters and the like have no place on a face texture
      break;
  }
  ctx.restore();
}

export type FaceKey = {
  expr: ExpressionId;
  blink: number;
  mouth: number;
  frame: number;
  ink: string;
  skin: string;
  beard: BeardId;
  features: readonly FaceFeatureId[];
  hair: string;
  neon: boolean;
};

/** Faces whose drawing moves with the frame (tears, sweat, a beating heart); the rest only change with blink and mouth. */
const MOVING: ReadonlySet<ExpressionId> = new Set(["fear", "crying", "laughing", "confused", "embarrassed", "in_love"]);

const cache = new Map<string, THREE.CanvasTexture>();
const MAX = 400;

/**
 * The face texture for a state. States are quantised (blink in quarters,
 * mouth in sixths, moving faces every 2nd frame), so a scene reuses a
 * handful of textures.
 */
export function faceTexture(k: FaceKey): THREE.CanvasTexture {
  const blink = Math.round(k.blink * 4) / 4;
  const mouth = Math.round(k.mouth * 6) / 6;
  const frame = MOVING.has(k.expr) ? k.frame - (k.frame % 2) : 0;
  const key = [k.expr, blink, mouth, frame, k.ink, k.skin, k.beard, k.features.join("+"), k.hair, k.neon].join("|");
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(SIZE / 2, SIZE / 2);
  ctx.scale(K, K);
  // gaze -0.5 puts the 2D face's 3/4-view features in the middle: in 3D the head itself turns
  const gaze = -0.5;
  const base: Style = { fill: "none", stroke: "none", strokeWidth: 1, cap: "butt", join: "miter", opacity: 1, font: { family: "Fredoka, sans-serif", weight: 700, size: 16 } };
  const paintKit = { ink: k.ink, dark: k.ink, accent: k.ink, sil: false, neon: k.neon };
  // the full beard is a 3D shape on the chin (Figure3D); the lighter ones are drawn
  if (k.beard !== "none" && k.beard !== "full") paint(ctx, Beard({ beard: k.beard, gaze, p: { ...paintKit, hair: k.hair } }), base, k.ink);
  paint(ctx, FACES[k.expr]({ gaze, blink, mouth, frame, paper: k.skin }), base, k.ink);
  paint(ctx, FaceFeatures({ features: k.features, gaze, p: paintKit }), base, k.ink);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  if (cache.size >= MAX) {
    const first = cache.keys().next().value!;
    cache.get(first)!.dispose();
    cache.delete(first);
  }
  cache.set(key, tex);
  return tex;
}
