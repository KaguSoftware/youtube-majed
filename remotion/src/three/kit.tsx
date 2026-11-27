import { createContext, useContext, type ReactNode } from "react";
import * as THREE from "three";
import { rand } from "./world";

/**
 * Low-poly building blocks: cached flat-shaded materials and geometries, and
 * a few shapes every set and prop uses. Flat shading on few faces is the
 * whole look: each facet catches the light on its own.
 *
 * Caches are module-level (one per browser tab), so a material or geometry is
 * made once however many meshes, scenes or frames use it.
 */

type MatOpts = { emissive?: string; glow?: number; rough?: number; metal?: number; opacity?: number; side?: THREE.Side; flat?: boolean; fog?: boolean };
const mats = new Map<string, THREE.Material>();

/** A flat-shaded standard material. `glow` (0..) makes it emissive in its own or the `emissive` colour (lamps, screens, windows). */
export function mat(color: string, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const key = `s|${color}|${JSON.stringify(o)}`;
  let m = mats.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      flatShading: o.flat ?? true,
      roughness: o.rough ?? 0.86,
      metalness: o.metal ?? 0,
      emissive: o.glow ? (o.emissive ?? color) : "#000000",
      emissiveIntensity: o.glow ?? 0,
      transparent: o.opacity !== undefined && o.opacity < 1,
      opacity: o.opacity ?? 1,
      side: o.side ?? THREE.FrontSide,
      fog: o.fog ?? true,
    });
    mats.set(key, m);
  }
  return m;
}

/** Unlit colour: skies, light shafts, glowing bulbs. */
export function flat(color: string, o: { opacity?: number; fog?: boolean; side?: THREE.Side; additive?: boolean } = {}): THREE.MeshBasicMaterial {
  const key = `b|${color}|${JSON.stringify(o)}`;
  let m = mats.get(key) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color,
      transparent: o.opacity !== undefined && o.opacity < 1,
      opacity: o.opacity ?? 1,
      fog: o.fog ?? true,
      side: o.side ?? THREE.FrontSide,
      depthWrite: !(o.opacity !== undefined && o.opacity < 1),
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    mats.set(key, m);
  }
  return m;
}

const geos = new Map<string, THREE.BufferGeometry>();
function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geos.get(key) as T | undefined;
  if (!g) {
    g = make();
    geos.set(key, g);
  }
  return g;
}

export const G = {
  box: (w: number, h: number, d: number) => cached(`box${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)),
  /** Cylinder along y, centred. Few sides on purpose. */
  cyl: (rTop: number, rBot: number, h: number, sides = 7, open = false) => cached(`cyl${rTop},${rBot},${h},${sides},${open}`, () => new THREE.CylinderGeometry(rTop, rBot, h, sides, 1, open)),
  cone: (r: number, h: number, sides = 7) => cached(`cone${r},${h},${sides}`, () => new THREE.ConeGeometry(r, h, sides)),
  ico: (r: number, detail = 1) => cached(`ico${r},${detail}`, () => new THREE.IcosahedronGeometry(r, detail)),
  dodeca: (r: number) => cached(`dod${r}`, () => new THREE.DodecahedronGeometry(r, 0)),
  sphere: (r: number, ws: number, hs: number, phi0 = 0, phiL = Math.PI * 2, th0 = 0, thL = Math.PI) =>
    cached(`sph${r},${ws},${hs},${phi0},${phiL},${th0},${thL}`, () => new THREE.SphereGeometry(r, ws, hs, phi0, phiL, th0, thL)),
  plane: (w: number, h: number, ws = 1, hs = 1) => cached(`pl${w},${h},${ws},${hs}`, () => new THREE.PlaneGeometry(w, h, ws, hs)),
  torus: (r: number, tube: number, rs = 5, ts = 10, arc = Math.PI * 2) => cached(`tor${r},${tube},${rs},${ts},${arc}`, () => new THREE.TorusGeometry(r, tube, rs, ts, arc)),
  circle: (r: number, sides = 16) => cached(`cir${r},${sides}`, () => new THREE.CircleGeometry(r, sides)),
  ring: (r0: number, r1: number, sides = 24) => cached(`ring${r0},${r1},${sides}`, () => new THREE.RingGeometry(r0, r1, sides)),
  /** A rock: an icosahedron with its vertices pushed in and out by a seed. */
  rock: (r: number, seed: number, detail = 1) =>
    cached(`rock${r},${seed},${detail}`, () => {
      const g = new THREE.IcosahedronGeometry(r, detail);
      const p = g.attributes.position!;
      const seen = new Map<string, number>();
      for (let i = 0; i < p.count; i++) {
        const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
        let s = seen.get(k);
        if (s === undefined) seen.set(k, (s = 0.78 + rand(seed, i * 7.3, p.getX(i) * 13) * 0.42));
        p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.8, p.getZ(i) * s);
      }
      g.computeVertexNormals();
      return g;
    }),
  /** A ground patch with gentle low-poly bumps (grass, sand, snow). */
  terrain: (w: number, d: number, segs: number, amp: number, seed: number) =>
    cached(`ter${w},${d},${segs},${amp},${seed}`, () => {
      const g = new THREE.PlaneGeometry(w, d, segs, Math.max(1, Math.round((segs * d) / w)));
      g.rotateX(-Math.PI / 2);
      const p = g.attributes.position!;
      for (let i = 0; i < p.count; i++) p.setY(i, (rand(seed, Math.round(p.getX(i) * 10), Math.round(p.getZ(i) * 10)) - 0.5) * amp);
      g.computeVertexNormals();
      return g.toNonIndexed();
    }),
};

type V3 = [number, number, number];
type MeshProps = {
  g: THREE.BufferGeometry;
  m: THREE.Material;
  p?: V3;
  r?: V3;
  s?: V3 | number;
  cast?: boolean;
  receive?: boolean;
  children?: ReactNode;
};

/**
 * The ink line. The stick style draws characters and props with ink outlines
 * and backgrounds without, which keeps figures readable on any background;
 * low poly does the same. Inside an <Ink> every mesh M gets a back-face hull
 * pushed out from its centre by `width` (m): a constant-width dark line round
 * the silhouette and the folds.
 */
export type InkStyle = { width: number; color: string };
const InkContext = createContext<InkStyle | null>(null);
export function Ink({ style, children }: { style: InkStyle | null; children: ReactNode }) {
  return <InkContext.Provider value={style}>{children}</InkContext.Provider>;
}

const inkMats = new Map<string, THREE.MeshBasicMaterial>();
function inkMat(ink: InkStyle): THREE.MeshBasicMaterial {
  const key = `${ink.width}|${ink.color}`;
  let m = inkMats.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: ink.color, side: THREE.BackSide });
    const width = ink.width;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.inkWidth = { value: width };
      shader.vertexShader = `uniform float inkWidth;\n${shader.vertexShader}`.replace(
        "#include <begin_vertex>",
        // push out from the shape's centre, in world units whatever the mesh's own scale
        `vec3 transformed = position;
        vec3 inkDir = length(position) > 1e-5 ? normalize(position) : normal;
        vec3 inkScale = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
        transformed += inkDir * inkWidth / max(inkScale, vec3(1e-4));`,
      );
    };
    m.customProgramCacheKey = () => `ink${width}`;
    inkMats.set(key, m);
  }
  return m;
}

/** A mesh in one line: geometry, material, position, rotation (radians), scale. Casts and receives shadows by default; inside <Ink> it is outlined. */
export function M({ g, m, p, r, s, cast = true, receive = true, children }: MeshProps) {
  const ink = useContext(InkContext);
  return (
    <mesh geometry={g} material={m} position={p} rotation={r} scale={s} castShadow={cast} receiveShadow={receive}>
      {ink && <mesh geometry={g} material={inkMat(ink)} />}
      {children}
    </mesh>
  );
}

/** A vertical gradient backdrop (skies), unlit and unaffected by fog. */
export function GradientPlane({ w, h, top, bottom, p, mid, midAt = 0.5, backdrop = true }: { w: number; h: number; top: string; bottom: string; mid?: string; midAt?: number; p: V3; /** false: an ordinary surface (a window's view), not a sky drawn behind everything */ backdrop?: boolean }) {
  const geo = cached(`grad${w},${h},${top},${bottom},${mid},${midAt}`, () => {
    const g = new THREE.PlaneGeometry(w, h, 1, mid ? 2 : 1);
    const pos = g.attributes.position!;
    const c = new THREE.Color();
    const colors: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) + h / 2) / h;
      if (mid) {
        // a middle row of vertices sits at midAt
        if (t > 0.01 && t < 0.99) pos.setY(i, -h / 2 + midAt * h);
        const tt = t > 0.01 && t < 0.99 ? midAt : t;
        if (tt <= midAt) c.set(bottom).lerp(new THREE.Color(mid), tt / midAt);
        else c.set(mid).lerp(new THREE.Color(top), (tt - midAt) / (1 - midAt));
      } else c.set(bottom).lerp(new THREE.Color(top), t);
      colors.push(c.r, c.g, c.b);
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return g;
  });
  const key = backdrop ? "grad" : "gradSurface";
  const m = mats.get(key) ?? new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, depthWrite: !backdrop });
  mats.set(key, m);
  return <mesh geometry={geo} material={m} position={p} renderOrder={backdrop ? -10 : 0} />;
}

/** Hex colour helpers in linear-safe sRGB space. */
export function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  return `#${c.multiplyScalar(k).getHexString()}`;
}
export function blend(a: string, b: string, t: number): string {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
}
