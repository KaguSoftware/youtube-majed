import type { LowPolyPropId } from "@studio/schema";
import * as THREE from "three";
import { ACCENT, C, PAPER } from "../../theme";
import { G, M, flat, mat, shade } from "../kit";
import { PX, rand } from "../world";
import type { Held3DArgs, Placed3DArgs, Prop3D } from "./types";

/**
 * The low-poly props (catalogue LOW_POLY.props; TypeScript checks the
 * Record). Placed props are modelled facing +x at their own origin on the
 * ground (or the wall, the horizon); held props at the hand, in the holder's
 * space (+z ahead of the holder). Things that give light (lantern, fire, a
 * phone screen) are real lights at dusk and night.
 */

const SEAT = { chair: 92 / PX, bench: 84 / PX, car: 72 / PX, bed: 94 / PX };
const wood = mat(C.wood);
const woodDark = mat(C.woodDark);
const woodLight = mat(C.woodLight);
const metal = mat("#8d96a8", { metal: 0.45, rough: 0.45 });
const ink = mat("#2a2838");

const lit = (a: { light: { practical: number } }) => a.light.practical > 0.5;

function Lantern({ frame, swing, light }: Held3DArgs) {
  const on = lit({ light });
  const flick = 0.85 + Math.sin(frame * 1.3) * 0.08 + Math.sin(frame * 0.37) * 0.07;
  return (
    <group rotation={[0, 0, Math.max(-0.5, Math.min(0.5, -swing * 6 + Math.sin(frame / 9) * 0.05))]}>
      <M g={G.torus(0.05, 0.008, 4, 8, Math.PI)} m={ink} p={[0, -0.02, 0]} />
      <group position={[0, -0.16, 0]}>
        <M g={G.cyl(0.05, 0.07, 0.05, 6)} m={mat("#3d4256")} p={[0, 0.08, 0]} />
        <mesh geometry={G.cyl(0.055, 0.055, 0.13, 6)} material={on ? flat(ACCENT) : mat("#fff3cf", { opacity: 0.85 })} />
        <M g={G.cyl(0.075, 0.075, 0.025, 6)} m={mat("#3d4256")} p={[0, -0.075, 0]} />
        {on && <pointLight color="#ffb45a" intensity={light.practical * 3.2 * flick} distance={6} decay={1.7} castShadow shadow-mapSize={[512, 512]} shadow-bias={-0.003} />}
      </group>
    </group>
  );
}

function OilCan({ held }: { held?: boolean }) {
  const red = mat("#c0392b");
  return (
    <group position={held ? [0, -0.14, 0.04] : [0, 0, 0]}>
      <M g={G.cyl(0.11, 0.12, 0.26, 8)} m={red} p={[0, 0.13, 0]} />
      <M g={G.cyl(0.115, 0.115, 0.04, 8)} m={mat("#922b21")} p={[0, 0.2, 0]} />
      <M g={G.cyl(0.015, 0.025, 0.22, 5)} m={metal} p={[0.12, 0.3, 0]} r={[0, 0, -0.9]} />
      <M g={G.torus(0.07, 0.012, 4, 8, Math.PI)} m={ink} p={[0, 0.27, 0]} />
    </group>
  );
}

/** Footprints on the floor: a trail of flat prints walking away from the spot, the way the prop faces. */
function Prints({ small, tod }: { small: boolean; tod: Placed3DArgs["tod"] }) {
  const m = flat(tod === "night" ? "#dfe6f6" : "#fffdf7", { opacity: 0.92 });
  const edge = flat("#7d7891", { opacity: 0.55 });
  const n = small ? 8 : 6;
  const step = small ? 0.32 : 0.45;
  const s = small ? 0.6 : 1;
  return (
    <group position={[0, 0.006, 0.9]}>
      {Array.from({ length: n }, (_, i) => (
        <group key={i} position={[i * step, i * 0.001, i % 2 ? -0.12 * s : 0.12 * s]} rotation={[-Math.PI / 2, 0, 0]} scale={[s, s, 1]}>
          <mesh geometry={G.circle(0.075, 7)} material={edge} scale={[1.6, 0.85, 1]} position={[0.03, 0, -0.001]} />
          <mesh geometry={G.circle(0.065, 7)} material={m} scale={[1.6, 0.8, 1]} position={[0.03, 0, 0]} />
          <mesh geometry={G.circle(0.05, 6)} material={m} position={[-0.13, 0, 0]} />
        </group>
      ))}
    </group>
  );
}

function Bed({ used }: Placed3DArgs) {
  const top = SEAT.bed;
  const blanket = mat("#5b7fb8");
  return (
    <group>
      {/* frame: headboard at -x (a sleeper facing right lies with the head to the left) */}
      <M g={G.box(2.1, 0.22, 1.0)} m={wood} p={[0, 0.25, 0]} />
      {[-1.02, 1.02].map((x) => [-0.45, 0.45].map((z) => <M key={`${x}${z}`} g={G.box(0.08, 0.2, 0.08)} m={woodDark} p={[x, 0.1, z]} />))}
      <M g={G.box(0.1, 1.0, 1.04)} m={woodDark} p={[-1.08, 0.5, 0]} />
      <M g={G.box(0.1, 0.62, 1.04)} m={woodDark} p={[1.08, 0.31, 0]} />
      <M g={G.box(2.0, 0.09, 0.94)} m={mat("#f1ece2")} p={[0, top - 0.045, 0]} />
      <M g={G.box(0.42, 0.11, 0.62)} m={mat("#fbf8f2")} p={[-0.78, top + 0.05, 0]} r={[0, 0, 0.12]} />
      {/* the blanket: over the sleeper's legs and body when used */}
      <M g={G.box(1.32, used ? 0.2 : 0.08, 0.98)} m={blanket} p={[0.36, top + (used ? 0.1 : 0.03), 0]} />
      <M g={G.box(1.32, 0.03, 0.06)} m={mat("#f0d070")} p={[-0.3, top + (used ? 0.19 : 0.07), 0]} r={[0, Math.PI / 2, 0]} s={[0.05, 1, 16]} />
    </group>
  );
}

function Ship({ frame }: Placed3DArgs) {
  const bob = Math.sin(frame / 18) * 0.08;
  const hull = mat("#30364a");
  return (
    <group position={[0, bob, 0]} rotation={[Math.sin(frame / 22) * 0.02, 0, Math.sin(frame / 25) * 0.03]} scale={2.4}>
      <M g={G.box(4.2, 0.7, 0.9)} m={hull} p={[0, 0.2, 0]} />
      <M g={G.box(4.3, 0.15, 0.95)} m={mat("#c0392b")} p={[0, -0.12, 0]} />
      {[-1.3, -0.4, 0.5].map((x, i) => <M key={x} g={G.box(0.8, 0.5, 0.7)} m={mat(["#d0473d", "#2f9e8f", "#e0a030"][i]!)} p={[x, 0.8, 0]} />)}
      <M g={G.box(0.9, 0.9, 0.7)} m={mat("#e8e4da")} p={[1.4, 1.0, 0]} />
      <M g={G.cyl(0.1, 0.12, 0.6, 6)} m={mat("#d0473d")} p={[1.5, 1.7, 0]} />
    </group>
  );
}

function Clock({ frame }: Placed3DArgs) {
  const face = mat(PAPER);
  return (
    <group rotation={[Math.PI / 2, 0, 0]}>
      <M g={G.cyl(0.25, 0.25, 0.06, 12)} m={woodDark} />
      <M g={G.cyl(0.21, 0.21, 0.07, 12)} m={face} p={[0, 0.005, 0]} />
      <group position={[0, 0.045, 0]}>
        <M g={G.box(0.02, 0.01, 0.12)} m={ink} p={[0, 0, -0.06]} r={[0, -(frame * 0.6 + 120) * (Math.PI / 180), 0]} />
        <group rotation={[0, -frame * 7.5 * (Math.PI / 180), 0]}>
          <M g={G.box(0.014, 0.01, 0.17)} m={mat(C.red)} p={[0, 0.002, -0.085]} />
        </group>
      </group>
    </group>
  );
}

function Phone({ action, light }: Held3DArgs) {
  const atEar = action === "phone_call";
  const glow = light.practical > 0.5;
  return (
    <group position={atEar ? [0, 0.02, -0.03] : [0, 0.05, 0]} rotation={atEar ? [0.1, 0, 0] : [-0.95, 0, 0]}>
      <M g={G.box(0.08, 0.15, 0.012)} m={ink} />
      <mesh geometry={G.plane(0.068, 0.13)} material={glow ? flat("#bfe4ff") : mat("#4a6a8a", { glow: 0.3 })} position={[0, 0, atEar ? -0.007 : 0.007]} rotation={atEar ? [0, Math.PI, 0] : [0, 0, 0]} />
      {glow && !atEar && <pointLight color="#9fd0ff" intensity={0.35} distance={1.2} decay={2} position={[0, 0, 0.08]} />}
    </group>
  );
}

/** An open book or a paper held up in front of the face: pages toward the holder, the cover to the camera. */
function Pages({ w, h, cover, page, spread = 0.35 }: { w: number; h: number; cover: THREE.Material; page: THREE.Material; spread?: number }) {
  return (
    <group position={[0, 0.06, 0.05]} rotation={[-0.25, 0, 0]}>
      {[-1, 1].map((s) => (
        <group key={s} rotation={[0, s * spread, 0]}>
          <M g={G.box(w / 2, h, 0.012)} m={cover} p={[(s * w) / 4, 0, 0]} />
          <M g={G.box(w / 2 - 0.01, h - 0.01, 0.008)} m={page} p={[(s * w) / 4, 0, -0.01]} />
        </group>
      ))}
    </group>
  );
}

function Door() {
  const frame = mat("#7a5638");
  const panel = mat("#9c6b45");
  return (
    <group>
      <M g={G.box(0.12, 2.25, 0.16)} m={frame} p={[-0.52, 1.125, 0]} />
      <M g={G.box(0.12, 2.25, 0.16)} m={frame} p={[0.52, 1.125, 0]} />
      <M g={G.box(1.16, 0.12, 0.16)} m={frame} p={[0, 2.25, 0]} />
      <M g={G.box(0.92, 2.15, 0.07)} m={panel} p={[0, 1.08, 0]} />
      {[0.55, 1.5].map((y) => <M key={y} g={G.box(0.62, 0.62, 0.02)} m={mat(shade("#9c6b45", 0.85))} p={[0, y, 0.045]} />)}
      <M g={G.ico(0.045, 0)} m={mat("#e8c45a", { metal: 0.7, rough: 0.3 })} p={[0.33, 1.02, 0.08]} />
      <M g={G.box(1.3, 0.04, 0.4)} m={mat("#6b5a4a")} p={[0, 0.02, 0.1]} />
    </group>
  );
}

function Car({ used, frame }: Placed3DArgs) {
  const body = mat("#d0473d");
  const dark = mat("#2a2838");
  const glass = mat("#bfe0ee", { opacity: 0.35, rough: 0.1 });
  const wheel = (x: number) => (
    <group key={x} position={[x, 0.3, 0]} rotation={[Math.PI / 2, 0, used ? -frame * 0.25 : 0]}>
      <M g={G.cyl(0.3, 0.3, 1.25, 10)} m={dark} />
      <M g={G.cyl(0.14, 0.14, 1.27, 6)} m={mat("#c8ccd6", { metal: 0.6 })} />
    </group>
  );
  return (
    <group position={[0.15, 0, 0]}>
      {wheel(-1.1)}
      {wheel(1.15)}
      {/* lower body with a rounded nose and tail; the cabin is glass on all sides so the driver shows */}
      <M g={G.box(3.3, 0.6, 1.4)} m={body} p={[0, 0.62, 0]} />
      <M g={G.cyl(0.3, 0.3, 1.4, 6)} m={body} p={[1.62, 0.62, 0]} r={[Math.PI / 2, 0, 0]} s={[0.55, 1, 1]} />
      <M g={G.cyl(0.3, 0.3, 1.4, 6)} m={body} p={[-1.62, 0.62, 0]} r={[Math.PI / 2, 0, 0]} s={[0.45, 1, 1]} />
      <M g={G.box(3.36, 0.1, 1.44)} m={mat("#a8352d")} p={[0, 0.34, 0]} />
      <M g={G.box(1.9, 0.08, 1.32)} m={body} p={[-0.35, 1.62, 0]} />
      {/* pillars: rear upright, front raked over the windscreen */}
      {[-0.55, 0.55].map((z) => <M key={`rp${z}`} g={G.box(0.1, 0.72, 0.08)} m={body} p={[-1.25, 1.27, z]} />)}
      {[-0.55, 0.55].map((z) => <M key={`fp${z}`} g={G.box(0.1, 0.8, 0.08)} m={body} p={[0.78, 1.25, z]} r={[0, 0, -0.55]} />)}
      <mesh geometry={G.plane(1.32, 0.82)} material={glass} position={[0.78, 1.25, 0]} rotation={[0, Math.PI / 2, -0.55]} />
      <mesh geometry={G.plane(1.95, 0.66)} material={glass} position={[-0.25, 1.27, 0.68]} />
      <mesh geometry={G.plane(1.95, 0.66)} material={glass} position={[-0.25, 1.27, -0.68]} rotation={[0, Math.PI, 0]} />
      <M g={G.box(0.6, 0.12, 1.1)} m={mat("#3b3a48")} p={[-0.25, SEAT.car, 0]} />
      <M g={G.box(0.12, 0.62, 1.1)} m={mat("#3b3a48")} p={[-0.62, SEAT.car + 0.3, 0]} />
      <M g={G.torus(0.17, 0.025, 4, 10)} m={dark} p={[0.45, 1.05, 0.2]} r={[0, Math.PI / 2, 0.6]} />
      <M g={G.box(0.06, 0.16, 0.28)} m={flat("#fff6c8")} p={[1.79, 0.72, 0.45]} />
      <M g={G.box(0.06, 0.16, 0.28)} m={flat("#fff6c8")} p={[1.79, 0.72, -0.45]} />
      <M g={G.box(0.06, 0.14, 0.24)} m={flat("#ff5a4a")} p={[-1.77, 0.74, 0.45]} />
    </group>
  );
}

function Table() {
  return (
    <group>
      <M g={G.box(1.2, 0.07, 0.8)} m={wood} p={[0, 0.74, 0]} />
      {[-0.52, 0.52].map((x) => [-0.32, 0.32].map((z) => <M key={`${x}${z}`} g={G.box(0.07, 0.72, 0.07)} m={woodDark} p={[x, 0.36, z]} />))}
    </group>
  );
}

function Desk3D({ light }: Placed3DArgs) {
  const on = light.glow > 0.6;
  return (
    <group>
      <M g={G.box(1.3, 0.06, 0.7)} m={mat("#d9d2c4")} p={[0, 0.74, 0]} />
      <M g={G.box(0.5, 0.7, 0.66)} m={mat("#a9a49a")} p={[0.38, 0.36, 0]} />
      <M g={G.box(0.05, 0.72, 0.6)} m={metal} p={[-0.6, 0.36, 0]} />
      <group position={[-0.05, 0.77, -0.05]} rotation={[0, -Math.PI / 2, 0]}>
        <M g={G.box(0.07, 0.18, 0.07)} m={metal} p={[0, 0.09, 0]} />
        <M g={G.box(0.6, 0.4, 0.04)} m={ink} p={[0, 0.36, 0]} />
        <mesh geometry={G.plane(0.54, 0.34)} material={on ? flat("#a8d8ff") : mat("#2b3346", { glow: 0.3, emissive: "#6fa8d8" })} position={[0, 0.36, 0.021]} />
      </group>
      <M g={G.box(0.15, 0.02, 0.42)} m={mat("#3a4052")} p={[-0.32, 0.775, 0]} />
    </group>
  );
}

function Chair() {
  const s = SEAT.chair;
  return (
    <group>
      <M g={G.box(0.46, 0.05, 0.46)} m={wood} p={[0, s - 0.025, 0]} />
      {[-0.19, 0.19].map((x) => [-0.19, 0.19].map((z) => <M key={`${x}${z}`} g={G.box(0.045, s - 0.05, 0.045)} m={woodDark} p={[x, (s - 0.05) / 2, z]} />))}
      {/* the back is behind the sitter (-x) */}
      <M g={G.box(0.05, 0.5, 0.44)} m={wood} p={[-0.21, s + 0.27, 0]} />
      <M g={G.box(0.04, 0.06, 0.44)} m={woodLight} p={[-0.21, s + 0.5, 0]} />
    </group>
  );
}

function Bench() {
  const s = SEAT.bench;
  const slat = mat("#a8743f");
  return (
    <group>
      {[-0.12, 0, 0.12].map((x) => <M key={x} g={G.box(0.1, 0.04, 1.7)} m={slat} p={[x, s - 0.02, 0]} />)}
      {[-0.26, -0.14].map((x, i) => <M key={x} g={G.box(0.04, 0.1, 1.7)} m={slat} p={[x - 0.02, s + 0.25 + i * 0.16, 0]} r={[0, 0, 0.18]} />)}
      {[-0.75, 0.75].map((z) => (
        <group key={z} position={[0, 0, z]}>
          <M g={G.box(0.4, 0.05, 0.05)} m={ink} p={[0, s - 0.06, 0]} />
          <M g={G.box(0.05, s, 0.05)} m={ink} p={[0.15, s / 2, 0]} />
          <M g={G.box(0.05, s + 0.5, 0.05)} m={ink} p={[-0.2, (s + 0.5) / 2, 0]} r={[0, 0, 0.12]} />
        </group>
      ))}
    </group>
  );
}

function WallFrame({ w, h, color, children }: { w: number; h: number; color: string; children?: React.ReactNode }) {
  return (
    <group>
      <M g={G.box(w, h, 0.04)} m={mat(color)} />
      <group position={[0, 0, 0.025]}>{children}</group>
    </group>
  );
}

const textTex = new Map<string, THREE.CanvasTexture>();
/** A small canvas texture with text (calendar pages, posters). */
function labelTexture(lines: { text: string; size: number; color: string; y: number }[], w = 256, h = 256, bg = "#fbf4e6"): THREE.CanvasTexture {
  const key = JSON.stringify([lines, w, h, bg]);
  let t = textTex.get(key);
  if (t) return t;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const l of lines) {
    ctx.fillStyle = l.color;
    ctx.font = `700 ${l.size}px Fredoka, sans-serif`;
    ctx.fillText(l.text, w / 2, l.y);
  }
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  textTex.set(key, t);
  return t;
}
const texMat = (t: THREE.Texture) => {
  const k = `tex${t.id}`;
  let m = texMats.get(k);
  if (!m) texMats.set(k, (m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 })));
  return m;
};
const texMats = new Map<string, THREE.Material>();

function Calendar({ frame, flip }: Placed3DArgs) {
  const day = 1 + Math.floor(frame / 12) % 28;
  const t = labelTexture([
    { text: "NOV", size: 46, color: "#fbf4e6", y: 34 },
    { text: String(day), size: 120, color: "#1d1b29", y: 150 },
  ]);
  return (
    <group scale={[flip ? -1 : 1, 1, 1]}>
      <WallFrame w={0.46} h={0.58} color="#c0392b">
        <mesh geometry={G.plane(0.42, 0.42)} material={texMat(t)} position={[0, -0.05, 0]} />
      </WallFrame>
      {/* a page flipping over every 12 frames */}
      <mesh geometry={G.plane(0.42, 0.42)} material={mat(PAPER, { side: THREE.DoubleSide })} position={[0, 0.16, 0.04]} rotation={[-((frame % 12) / 12) * Math.PI * 0.9, 0, 0]} scale={[1, (frame % 12) / 12 < 0.9 ? 1 : 0.001, 1]}>
        <group />
      </mesh>
    </group>
  );
}

function Poster({ flip }: Placed3DArgs) {
  const t = labelTexture([
    { text: "WANTED", size: 44, color: "#5a2a1a", y: 34 },
    { text: "?", size: 120, color: "#3a2a22", y: 140 },
    { text: "$500", size: 38, color: "#5a2a1a", y: 226 },
  ], 256, 256, "#e8d4a8");
  return (
    <group scale={[flip ? -1 : 1, 1, 1]}>
      <WallFrame w={0.5} h={0.66} color="#cdb48a">
        <mesh geometry={G.plane(0.46, 0.62)} material={texMat(t)} />
      </WallFrame>
    </group>
  );
}

function Fire({ frame, light }: Placed3DArgs) {
  const flame = (i: number, r: number, h: number, color: string) => {
    const k = 1 + Math.sin(frame * 0.6 + i * 2.1) * 0.15 + Math.sin(frame * 1.7 + i) * 0.08;
    return <mesh key={`${color}${i}`} geometry={G.cone(r, h, 5)} material={flat(color)} position={[Math.sin(i * 2.4) * 0.08, (h * k) / 2 + 0.08, Math.cos(i * 2.4) * 0.08]} scale={[1, k, 1]} rotation={[0, frame * 0.05 + i, Math.sin(frame * 0.3 + i) * 0.08]} />;
  };
  return (
    <group>
      {[0, 1, 2, 3].map((i) => <M key={i} g={G.cyl(0.05, 0.06, 0.7, 5)} m={woodDark} p={[0, 0.06, 0]} r={[Math.PI / 2, (i * Math.PI) / 4, 0]} />)}
      {Array.from({ length: 7 }, (_, i) => <M key={`s${i}`} g={G.rock(0.09, i + 40, 0)} m={mat("#8f96a3")} p={[Math.cos((i / 7) * Math.PI * 2) * 0.42, 0.04, Math.sin((i / 7) * Math.PI * 2) * 0.42]} />)}
      {[0, 1, 2].map((i) => flame(i, 0.16, 0.5, "#ff8a3a"))}
      {[0, 1].map((i) => flame(i + 5, 0.09, 0.32, "#ffd36a"))}
      <pointLight color="#ff9a4a" intensity={(1.4 + Math.sin(frame * 0.7) * 0.25) * Math.max(1, light.practical * 2.2)} distance={7} decay={1.6} position={[0, 0.5, 0]} castShadow shadow-mapSize={[512, 512]} />
    </group>
  );
}

function BoxProp({ held }: { held?: boolean }) {
  const card = mat("#c9995e");
  return (
    <group position={held ? [0, -0.05, 0.18] : [0, 0, 0]}>
      <M g={G.box(0.5, 0.38, 0.4)} m={card} p={[0, 0.19, 0]} />
      <M g={G.box(0.51, 0.02, 0.08)} m={mat("#e6d29a")} p={[0, 0.385, 0]} />
    </group>
  );
}

function Suitcase({ held }: { held?: boolean }) {
  const shell = mat("#2f9e8f");
  return (
    <group position={held ? [0, -0.5, 0] : [0, 0, 0]}>
      <M g={G.box(0.2, 0.5, 0.62)} m={shell} p={[0, 0.27, 0]} />
      <M g={G.box(0.21, 0.04, 0.63)} m={mat("#22766b")} p={[0, 0.3, 0]} />
      <M g={G.box(0.06, 0.05, 0.2)} m={ink} p={[0, 0.55, 0]} />
      <M g={G.box(0.205, 0.12, 0.14)} m={mat("#e0a030")} p={[0.002, 0.18, 0.12]} />
      {[-0.22, 0.22].map((z) => <M key={z} g={G.cyl(0.03, 0.03, 0.04, 6)} m={ink} p={[0, 0.02, z]} r={[0, 0, Math.PI / 2]} />)}
    </group>
  );
}

function FlourSack() {
  return (
    <group>
      <M g={G.ico(0.3, 1)} m={mat("#efe6d2")} p={[0, 0.27, 0]} s={[1, 1.05, 0.8]} />
      <M g={G.cone(0.13, 0.2, 6)} m={mat("#e6dcc4")} p={[0, 0.62, 0]} r={[Math.PI, 0, 0]} />
      <M g={G.torus(0.09, 0.02, 4, 8)} m={mat("#b5835a")} p={[0, 0.55, 0]} r={[Math.PI / 2, 0, 0]} />
      {/* the spill */}
      <mesh geometry={G.circle(0.35, 9)} material={mat("#f6f1e6")} position={[0.38, 0.004, 0.25]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.3, 0.8, 1]} receiveShadow />
    </group>
  );
}

function Money() {
  const bill = mat("#7fbf7a");
  return (
    <group position={[0, 0.06, 0.03]}>
      {[-0.3, 0, 0.3].map((a, i) => <M key={a} g={G.box(0.15, 0.08, 0.004)} m={bill} p={[0, 0.02, i * 0.003]} r={[0, 0, a]} />)}
    </group>
  );
}

function Food() {
  return (
    <group position={[0, 0.04, 0.04]} rotation={[0.3, 0, 0.2]}>
      <M g={G.box(0.14, 0.03, 0.12)} m={mat("#e8c48a")} p={[0, 0.035, 0]} />
      <M g={G.box(0.15, 0.025, 0.13)} m={mat("#6fb05a")} p={[0, 0.01, 0]} />
      <M g={G.box(0.14, 0.03, 0.12)} m={mat("#e8c48a")} p={[0, -0.015, 0]} />
    </group>
  );
}

const placedOnly = (fn: (a: Placed3DArgs) => React.ReactNode): Prop3D => ({ placed: fn });

export const PROPS3D: Record<LowPolyPropId, Prop3D> = {
  lantern: { held: (a) => <Lantern {...a} /> },
  oil_can: { held: () => <OilCan held />, placed: () => <OilCan /> },
  flour_sack: placedOnly(() => <FlourSack />),
  footprints: { placed: (a) => <Prints small={false} tod={a.tod} />, z: 0 },
  small_footprints: { placed: (a) => <Prints small tod={a.tod} />, z: 0.1 },
  bed: placedOnly((a) => <Bed {...a} />),
  ship: placedOnly((a) => <Ship {...a} />),
  clock: placedOnly((a) => <Clock {...a} />),
  phone: { held: (a) => <Phone {...a} /> },
  book: { held: () => <Pages w={0.3} h={0.22} cover={mat("#8a3a3a")} page={mat("#f6f1e6")} /> },
  newspaper: { held: () => <Pages w={0.62} h={0.42} cover={mat("#e9e6dc")} page={mat("#d8d4c8")} spread={0.18} /> },
  money: { held: () => <Money /> },
  food: { held: () => <Food /> },
  door: placedOnly(() => <Door />),
  car: { placed: (a) => <Car {...a} />, z: -1.1 },
  table: placedOnly(() => <Table />),
  desk: placedOnly((a) => <Desk3D {...a} />),
  chair: placedOnly(() => <Chair />),
  bench: placedOnly(() => <Bench />),
  calendar: placedOnly((a) => <Calendar {...a} />),
  wanted_poster: placedOnly((a) => <Poster {...a} />),
  fire: { placed: (a) => <Fire {...a} />, z: 0.3 },
  box: { held: () => <BoxProp held />, placed: () => <BoxProp /> },
  suitcase: { held: () => <Suitcase held />, placed: () => <Suitcase /> },
};

void rand;
