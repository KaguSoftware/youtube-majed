import type { GradeId } from "@studio/schema";
import type { ReactNode } from "react";
import * as THREE from "three";
import { C, type TimeOfDay } from "../../theme";
import { G, GradientPlane, M, flat, mat } from "../kit";
import type { LightRig } from "../lighting";
import { rand } from "../world";

/**
 * What every low-poly set shares: the set's contract, skies, tiled floors,
 * a skyline of lit windows, lamps that are real lights at night.
 */

export type SetProps = { tod: TimeOfDay; grade: GradeId; frame: number; light: LightRig };

export type SetDef = {
  interior: boolean;
  /** z of the back wall: wall props (clock, calendar, poster) hang on it */
  wallZ: number;
  /** where ships sit on a sea horizon */
  horizon?: { z: number; y: number };
  /** height of sky props (plane, birds) */
  skyY?: number;
  Set: (p: SetProps) => ReactNode;
};

const SKY: Record<TimeOfDay, { top: string; mid?: string; bottom: string }> = {
  day: { top: "#5fa8de", bottom: "#d6eef6" },
  dusk: { top: "#3b3f78", mid: "#c9708a", bottom: "#f6b27a" },
  night: { top: "#070c24", bottom: "#26325c" },
};

/** A sky backdrop far behind the set, with stars and a moon at night and a low sun at dusk. */
export function Sky({ tod, z = -90, y = 20, w = 260, h = 90, moonX = 22 }: { tod: TimeOfDay; z?: number; y?: number; w?: number; h?: number; moonX?: number }) {
  const s = SKY[tod];
  return (
    <group>
      <GradientPlane w={w} h={h} top={s.top} bottom={s.bottom} mid={s.mid} midAt={0.35} p={[0, y, z]} />
      {tod === "night" && <Stars z={z + 1} y={y} w={w} h={h} />}
      {tod === "night" && (
        <group position={[moonX, y + h * 0.22, z + 2]}>
          <mesh geometry={G.circle(3.2, 18)} material={flat("#f4efd8", { fog: false })} />
          <mesh geometry={G.circle(5.5, 18)} material={flat("#9fb2ff", { fog: false, opacity: 0.12 })} position={[0, 0, -0.1]} />
        </group>
      )}
      {tod === "dusk" && <mesh geometry={G.circle(5, 20)} material={flat("#ffd48a", { fog: false })} position={[-moonX * 1.2, y - h * 0.28, z + 2]} />}
    </group>
  );
}

const starGeos = new Map<string, THREE.BufferGeometry>();
function Stars({ z, y, w, h }: { z: number; y: number; w: number; h: number }) {
  const key = `${z},${y},${w},${h}`;
  let g = starGeos.get(key);
  if (!g) {
    const pts: number[] = [];
    for (let i = 0; i < 260; i++) {
      const sy = y - h * 0.1 + rand(i, 2) * h * 0.6;
      pts.push((rand(i, 1) - 0.5) * w, sy, z);
    }
    g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    starGeos.set(key, g);
  }
  return <points geometry={g} material={starMat} />;
}
const starMat = new THREE.PointsMaterial({ color: "#f6f3e0", size: 2.2, sizeAttenuation: false, fog: false });

/** A floor of square tiles (boards, carpet, flagstones) in a few close colours, one flat-shaded mesh. */
export function TiledFloor({ w, d, tile, colors, z = 0, seed = 1, rows }: { w: number; d: number; tile: number | [number, number]; colors: string[]; z?: number; seed?: number; rows?: boolean }) {
  const [tw, td] = typeof tile === "number" ? [tile, tile] : tile;
  const geo = floorGeo(w, d, tw, td, colors, seed, !!rows);
  return <mesh geometry={geo} material={vcMat} position={[0, 0, z]} receiveShadow />;
}
const vcMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
const floorGeos = new Map<string, THREE.BufferGeometry>();
function floorGeo(w: number, d: number, tw: number, td: number, colors: string[], seed: number, rows: boolean) {
  const key = `${w},${d},${tw},${td},${colors.join()},${seed},${rows}`;
  const hit = floorGeos.get(key);
  if (hit) return hit;
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const nx = Math.ceil(w / tw);
  const nz = Math.ceil(d / td);
  const gap = Math.min(tw, td) * 0.025;
  for (let iz = 0; iz < nz; iz++) {
    // boards: each row offset by a random amount
    const off = rows ? rand(seed, iz) * tw : 0;
    for (let ix = -1; ix < nx; ix++) {
      const x0 = -w / 2 + ix * tw + off + gap;
      const x1 = x0 + tw - 2 * gap;
      const z0 = -d / 2 + iz * td + gap;
      const z1 = z0 + td - 2 * gap;
      const a = Math.max(-w / 2, x0);
      const b = Math.min(w / 2, x1);
      if (b <= a) continue;
      c.set(colors[Math.floor(rand(seed, ix * 31 + 7, iz * 17 + 3) * colors.length)]!);
      for (const [x, zz] of [[a, z0], [a, z1], [b, z1], [a, z0], [b, z1], [b, z0]] as const) {
        pos.push(x, 0, zz);
        col.push(c.r, c.g, c.b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  floorGeos.set(key, g);
  return g;
}

/** Grout/gaps under a tiled floor. */
export function Base({ w, d, color, y = -0.005, z = 0 }: { w: number; d: number; color: string; y?: number; z?: number }) {
  return <M g={G.plane(w, d)} m={mat(color)} p={[0, y, z]} r={[-Math.PI / 2, 0, 0]} cast={false} />;
}

/**
 * Window grids: rows and columns of windows, some lit. Two textures from the same pattern: the colour map (the
 * wall shows its own colour, windows dark glass with a sill) and the glow map (only the lit windows). Shared.
 */
const winTex = new Map<string, { map: THREE.CanvasTexture; glow: THREE.CanvasTexture }>();
export function windowTextures(lit: number, seed: number, cols = 6, rowsN = 10) {
  const key = `${lit},${seed},${cols},${rowsN}`;
  const hit = winTex.get(key);
  if (hit) return hit;
  const make = (glow: boolean) => {
    const cv = document.createElement("canvas");
    cv.width = cols * 16;
    cv.height = rowsN * 16;
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = glow ? "#000000" : "#ffffff";
    ctx.fillRect(0, 0, cv.width, cv.height);
    for (let r = 0; r < rowsN; r++) {
      for (let c = 0; c < cols; c++) {
        const on = rand(seed, r * 13 + c * 7) < lit;
        const warm = rand(seed + 3, r, c) < 0.7;
        if (glow) {
          if (!on) continue;
          ctx.fillStyle = warm ? "#ffd68a" : "#cfe6ff";
        } else ctx.fillStyle = on ? (warm ? "#f2dcae" : "#d6e6f2") : "#3a4a62";
        ctx.fillRect(c * 16 + 5, r * 16 + 4, 6, 8);
        if (!glow) {
          ctx.fillStyle = "#8a8a90";
          ctx.fillRect(c * 16 + 4, r * 16 + 12, 8, 1);
        }
      }
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    return t;
  };
  const out = { map: make(false), glow: make(true) };
  winTex.set(key, out);
  return out;
}

const bldMats = new Map<string, THREE.Material>();
/** A building block whose faces carry lit windows (emissive at night). */
export function Building({ p, size, color, seed, glow, lit = 0.45 }: { p: [number, number, number]; size: [number, number, number]; color: string; seed: number; glow: number; lit?: number }) {
  const [w, h, d] = size;
  const cols = Math.max(2, Math.round(w / 0.9));
  const rowsN = Math.max(2, Math.round(h / 1.15));
  const key = `${color},${seed % 5},${cols},${rowsN},${glow.toFixed(2)},${lit}`;
  let m = bldMats.get(key);
  if (!m) {
    const tex = windowTextures(lit, seed % 5, cols, rowsN);
    // the wall in its colour with dark glass windows; at night the lit ones glow
    m = new THREE.MeshStandardMaterial({ color: blendHex(color, "#ffffff", 0.2), map: tex.map, emissive: "#ffffff", emissiveMap: tex.glow, emissiveIntensity: glow * 0.8, flatShading: true, roughness: 0.9 });
    bldMats.set(key, m);
  }
  return <mesh geometry={G.box(w, h, d)} material={m} position={[p[0], p[1] + h / 2, p[2]]} castShadow receiveShadow />;
}

/** A row of buildings for a skyline: heights and colours from a seed. */
export function Skyline({ z, x0, x1, seed, glow, hMin = 6, hMax = 22, depth = 4, colors = ["#56607a", "#4a5268", "#606a82", "#3f4659"], lit = 0.45 }: { z: number; x0: number; x1: number; seed: number; glow: number; hMin?: number; hMax?: number; depth?: number; colors?: string[]; lit?: number }) {
  const out: ReactNode[] = [];
  let x = x0;
  let i = 0;
  while (x < x1) {
    const w = 2.6 + rand(seed, i, 1) * 3.2;
    const h = hMin + rand(seed, i, 2) * (hMax - hMin);
    out.push(<Building key={i} p={[x + w / 2, 0, z - rand(seed, i, 3) * 2]} size={[w, h, depth]} color={colors[i % colors.length]!} seed={seed * 7 + i} glow={glow} lit={lit} />);
    x += w + 0.2 + rand(seed, i, 4) * 0.8;
    i++;
  }
  return <>{out}</>;
}

/** A warm lamp: a glowing bulb and, at dusk and night, a real light. */
export function LampLight({ p, light, color = "#ffcf8a", power = 1, distance = 9, bulb = 0.12, shadow = false }: { p: [number, number, number]; light: LightRig; color?: string; power?: number; distance?: number; bulb?: number; shadow?: boolean }) {
  const on = light.practical > 0.5;
  return (
    <group position={p}>
      <mesh geometry={G.ico(bulb, 1)} material={on ? flat(color) : mat("#f2ead8")} />
      {on && <pointLight color={color} intensity={power * light.practical * 6} distance={distance} decay={1.6} castShadow={shadow} shadow-mapSize={[512, 512]} shadow-bias={-0.002} />}
    </group>
  );
}

function blendHex(a: string, b: string, t: number) {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
}

export const WOOD = C.wood;
export const WOOD_DARK = C.woodDark;
export const WOOD_LIGHT = C.woodLight;
