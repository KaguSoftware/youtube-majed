import * as THREE from "three";
import { G, M, flat, mat } from "../kit";
import { Base, LampLight, TiledFloor, type SetDef, type SetProps } from "./common";

/**
 * A hospital room (background `hospital`): pale walls with a mint band, a
 * vinyl floor, a heart monitor whose trace runs across its screen, a curtain
 * on a ceiling rail, a window with blinds, a medical panel with sockets and
 * an oxygen outlet, and a ceiling light. The bed is a prop (`bed`), as in 2D.
 */

const WALL_Z = -3.8;
const CEIL = 3.6;
const WINDOW_X = 4.8;

function Monitor({ frame, light }: SetProps) {
  const on = light.glow > 0.6;
  // the trace: a heartbeat every 24 frames, scrolling
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 40; i++) {
    const u = i / 40;
    const ph = (u * 2 + frame / 24) % 1;
    const y = ph > 0.42 && ph < 0.46 ? 0.07 : ph > 0.46 && ph < 0.5 ? -0.05 : ph > 0.5 && ph < 0.53 ? 0.02 : 0;
    pts.push(new THREE.Vector3(-0.22 + u * 0.44, y, 0));
  }
  const trace = new THREE.BufferGeometry().setFromPoints(pts);
  return (
    <group position={[2.9, 0, WALL_Z + 0.7]}>
      <M g={G.cyl(0.25, 0.28, 0.05, 6)} m={mat("#8a93a3")} p={[0, 0.04, 0]} />
      <M g={G.cyl(0.025, 0.025, 1.3, 5)} m={mat("#8a93a3", { metal: 0.4 })} p={[0, 0.7, 0]} />
      <group position={[0, 1.42, 0]}>
        <M g={G.box(0.62, 0.44, 0.16)} m={mat("#e9ecef")} />
        <mesh geometry={G.plane(0.52, 0.32)} material={flat("#0d1a1e")} position={[0, 0, 0.081]} />
        <lineSegments geometry={trace} material={traceMat} position={[0, 0.02, 0.083]} />
        <mesh geometry={G.plane(0.08, 0.04)} material={flat("#ff6a5a")} position={[0.18, -0.11, 0.083]} />
        {on && <pointLight color="#7fffb0" intensity={0.35} distance={1.6} decay={2} position={[0, 0, 0.3]} />}
      </group>
    </group>
  );
}
const traceMat = new THREE.LineBasicMaterial({ color: "#5aff9a" });

function Curtain() {
  const cloth = mat("#9fc7c4");
  return (
    <group position={[-4.6, 0, WALL_Z + 1.4]}>
      <M g={G.cyl(0.02, 0.02, 4, 5)} m={mat("#b9c0cc", { metal: 0.5 })} p={[0.8, CEIL - 0.25, 0]} r={[0, 0, Math.PI / 2]} />
      {Array.from({ length: 7 }, (_, i) => (
        <M key={i} g={G.cyl(0.11, 0.13, CEIL - 0.6, 5)} m={cloth} p={[-0.6 + i * 0.2, (CEIL - 0.6) / 2 + 0.18, (i % 2) * 0.08]} />
      ))}
    </group>
  );
}

function Window({ tod }: { tod: SetProps["tod"] }) {
  const view = tod === "night" ? "#152448" : tod === "dusk" ? "#e8a080" : "#bfe2f2";
  return (
    <group position={[WINDOW_X, 1.8, WALL_Z + 0.02]}>
      <mesh geometry={G.plane(1.7, 1.4)} material={flat(view)} />
      {Array.from({ length: 11 }, (_, i) => <M key={i} g={G.box(1.7, 0.03, 0.05)} m={mat("#eef1f3")} p={[0, 0.62 - i * 0.1, 0.04]} r={[0.6, 0, 0]} cast={false} />)}
      {[-0.88, 0.88].map((x) => <M key={x} g={G.box(0.08, 1.5, 0.1)} m={mat("#d9dee4")} p={[x, 0, 0.03]} />)}
      {[-0.74, 0.74].map((y) => <M key={y} g={G.box(1.84, 0.08, 0.1)} m={mat("#d9dee4")} p={[0, y, 0.03]} />)}
    </group>
  );
}

function Hospital(p: SetProps) {
  const wall = mat("#e9eff0");
  return (
    <group>
      <Base w={40} d={22} color="#a9b4b8" z={5} />
      <TiledFloor w={40} d={16} tile={0.6} colors={["#d6dcd8", "#cfd6d2", "#dbe1dd", "#c9d1cc"]} z={WALL_Z + 8} seed={14} />
      <M g={G.box(40, CEIL, 0.2)} m={wall} p={[0, CEIL / 2, WALL_Z - 0.1]} />
      <M g={G.box(40, 0.18, 0.04)} m={mat("#9fd2c4")} p={[0, 1.05, WALL_Z + 0.02]} />
      <M g={G.box(40, 0.1, 0.05)} m={mat("#b9c4c8")} p={[0, 0.05, WALL_Z + 0.03]} />
      <M g={G.plane(40, 18)} m={mat("#f2f4f4")} p={[0, CEIL, WALL_Z + 9]} r={[Math.PI / 2, 0, 0]} />
      <mesh geometry={G.plane(1.4, 0.6)} material={p.light.practical > 0.5 ? flat("#fbfbf6") : mat("#f6f6f0", { glow: 0.4 })} position={[0, CEIL - 0.01, -0.8]} rotation={[Math.PI / 2, 0, 0]} />
      <LampLight p={[0, CEIL - 0.9, -0.8]} light={p.light} color="#eef6ff" power={0.8} distance={11} bulb={0.01} shadow />
      {/* the medical panel above where a bed would go: sockets, an oxygen outlet, a call button */}
      <group position={[0, 1.55, WALL_Z + 0.03]}>
        <M g={G.box(2.6, 0.22, 0.06)} m={mat("#dfe5e8")} />
        {[-1, -0.7, 0.7, 1].map((x) => <M key={x} g={G.box(0.1, 0.1, 0.02)} m={mat("#f8f8f8")} p={[x, 0, 0.04]} />)}
        <M g={G.cyl(0.04, 0.04, 0.05, 6)} m={mat("#2f9e5a")} p={[-0.3, 0, 0.05]} r={[Math.PI / 2, 0, 0]} />
        <M g={G.cyl(0.035, 0.035, 0.05, 6)} m={mat("#d0473d")} p={[0.3, 0, 0.05]} r={[Math.PI / 2, 0, 0]} />
      </group>
      <Monitor {...p} />
      <Curtain />
      <Window tod={p.tod} />
      {/* a visitor's chair and a bin */}
      <group position={[-2.9, 0, WALL_Z + 0.6]}>
        <M g={G.box(0.5, 0.06, 0.5)} m={mat("#5d8aa8")} p={[0, 0.45, 0]} />
        <M g={G.box(0.5, 0.5, 0.06)} m={mat("#5d8aa8")} p={[0, 0.75, -0.22]} />
        {[-0.2, 0.2].map((x) => <M key={x} g={G.box(0.04, 0.45, 0.45)} m={mat("#8a93a3", { metal: 0.4 })} p={[x, 0.22, 0]} />)}
      </group>
      <M g={G.cyl(0.18, 0.15, 0.45, 8)} m={mat("#c9d1d6")} p={[-1.9, 0.22, WALL_Z + 0.4]} />
    </group>
  );
}

export const hospital: SetDef = { interior: true, wallZ: WALL_Z + 0.04, Set: Hospital };
