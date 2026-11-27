import { useMemo } from "react";
import * as THREE from "three";
import { C } from "../../theme";
import { G, M, flat, mat } from "../kit";
import { rand } from "../world";
import { Base, LampLight, TiledFloor, type SetDef, type SetProps } from "./common";

/**
 * Inside the lighthouse (background `lighthouse_stairs`): the curved stone
 * wall of the tower behind the characters, stone steps spiralling up along
 * it, a small round window high up, an iron rail, a wall lamp. Always a
 * little dark: at night the moonlight comes through the window and the lamp
 * (and any lantern a character carries) does the rest.
 */

const R = 6.4; // the tower's inner radius; its centre is in front of the stage, so the far wall curves round behind it
const CZ = 2.2;
const WALL_Z = CZ - R;

/** The stone wall: the inside of a cylinder, built of blocks in a few close greys. */
const wallGeo = (() => {
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const rows = 22;
  const rowH = 0.42;
  const cols = 64;
  const stones = [C.stone, C.stoneDark, "#c4bdb1", "#aba398", "#9c958a"];
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? 0.5 : 0;
    for (let k = 0; k < cols; k++) {
      const a0 = ((k + off) / cols) * Math.PI * 2;
      const a1 = ((k + off + 0.94) / cols) * Math.PI * 2;
      // only the far side of the tower: the near side would stand between the camera and the stage
      if (Math.cos((a0 + a1) / 2) > -0.25) continue;
      const y0 = r * rowH + 0.02;
      const y1 = y0 + rowH - 0.04;
      const inset = R - 0.04 * rand(r, k, 3);
      const p = (a: number, y: number) => [Math.sin(a) * inset, y, Math.cos(a) * inset] as const;
      const q = [p(a0, y0), p(a1, y0), p(a1, y1), p(a0, y1)];
      c.set(stones[Math.floor(rand(r, k) * stones.length)]!);
      for (const i of [0, 2, 1, 0, 3, 2]) {
        pos.push(...q[i]!);
        col.push(c.r, c.g, c.b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
})();
const wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, side: THREE.DoubleSide });

/** Steps hugging the wall, climbing from the left of the stage round to the upper right. */
function Stairs() {
  const step = mat("#a39b8f");
  const edge = mat("#8a8277");
  const iron = mat("#2f3344", { metal: 0.5, rough: 0.5 });
  const n = 26;
  const steps = Array.from({ length: n }, (_, i) => {
    const a = Math.PI + 0.85 - (i / n) * 1.9; // angle round the tower: from back-left to back-right
    const y = 0.2 + i * 0.19;
    return { a, y };
  });
  return (
    <group position={[0, 0, CZ]}>
      {steps.map(({ a, y }, i) => (
        <group key={i} position={[Math.sin(a) * (R - 0.6), y, Math.cos(a) * (R - 0.6)]} rotation={[0, a, 0]}>
          <M g={G.box(0.5, 0.18, 1.15)} m={i % 2 ? step : edge} />
          {/* a post every other step, for the rail */}
          {i % 2 === 0 && <M g={G.cyl(0.025, 0.025, 0.95, 5)} m={iron} p={[0, 0.55, -0.55]} />}
        </group>
      ))}
      {steps.slice(0, -2).map(({ a, y }, i) =>
        i % 2 === 0 ? (
          <M key={`r${i}`} g={G.box(0.05, 0.05, 1.0)} m={iron} p={[Math.sin(a - 0.07) * (R - 1.17), y + 1.12, Math.cos(a - 0.07) * (R - 1.17)]} r={[0.36, a + Math.PI / 2, 0]} />
        ) : null,
      )}
    </group>
  );
}

function RoundWindow({ tod, light }: SetProps) {
  const target = useMemo(() => new THREE.Object3D(), []);
  const glow = tod === "night" ? "#9fb6ff" : tod === "dusk" ? "#ffb88a" : "#e6f4ff";
  const y = 3.4;
  return (
    <group position={[0.4, y, WALL_Z + 0.1]}>
      <mesh geometry={G.circle(0.42, 12)} material={flat(glow)} />
      <M g={G.torus(0.46, 0.08, 4, 12)} m={mat(C.stoneDark)} />
      <M g={G.box(0.05, 0.84, 0.05)} m={mat("#2f3344")} p={[0, 0, 0.02]} />
      <M g={G.box(0.84, 0.05, 0.05)} m={mat("#2f3344")} p={[0, 0, 0.02]} />
      {/* a shaft of light falling from the window to the floor */}
      <mesh geometry={shaftGeo} material={flat(glow, { opacity: tod === "day" ? 0.06 : 0.1, additive: true, fog: false, side: THREE.DoubleSide })} position={[0.6, -1.8, 1.5]} rotation={[-0.55, 0, 0.32]} />
      <primitive object={target} position={[0.9, -y, 3.2]} />
      <spotLight color={glow} intensity={light.practical > 0.5 ? 6 : 10} distance={10} angle={0.42} penumbra={0.6} decay={1.4} position={[0, 0, 0.3]} target={target} castShadow shadow-mapSize={[512, 512]} />
    </group>
  );
}
const shaftGeo = new THREE.CylinderGeometry(0.42, 1.1, 4.2, 10, 1, true);

function Stairwell(p: SetProps) {
  const { light } = p;
  return (
    <group>
      <Base w={40} d={22} color="#5d574e" z={5} />
      <TiledFloor w={30} d={14} tile={0.9} colors={[C.stone, C.stoneDark, "#aaa397", "#bdb6aa"]} z={WALL_Z + 7} seed={9} />
      <group position={[0, 0, CZ]}>
        <mesh geometry={wallGeo} material={wallMat} receiveShadow castShadow />
      </group>
      {/* mortar showing between the stones */}
      <M g={G.plane(30, 10)} m={mat("#5f584f")} p={[0, 4.6, WALL_Z - 0.25]} cast={false} />
      <Stairs />
      <RoundWindow {...p} />
      {/* an iron wall lamp on the left, an old chest and coiled rope on the floor */}
      <group position={[-3.4, 2.1, WALL_Z + 0.95]}>
        <M g={G.box(0.08, 0.3, 0.08)} m={mat("#2f3344")} p={[0, -0.1, -0.1]} />
        <M g={G.cyl(0.1, 0.13, 0.2, 6)} m={mat("#2f3344")} p={[0, 0.1, 0]} />
        <LampLight p={[0, 0.02, 0]} light={light} power={1.2} distance={8} bulb={0.08} color="#ffb860" shadow />
      </group>
      <group position={[3.6, 0, WALL_Z + 1.5]} rotation={[0, -0.4, 0]}>
        <M g={G.box(1.0, 0.5, 0.55)} m={mat(C.woodDark)} p={[0, 0.25, 0]} />
        <M g={G.box(1.04, 0.08, 0.59)} m={mat("#3d4256")} p={[0, 0.3, 0]} />
      </group>
      <group position={[-2.2, 0, WALL_Z + 1.0]}>
        {[0, 1, 2].map((i) => <M key={i} g={G.torus(0.32 - i * 0.04, 0.05, 4, 10)} m={mat("#c9a46a")} p={[0, 0.05 + i * 0.09, 0]} r={[Math.PI / 2, 0, 0]} />)}
      </group>
    </group>
  );
}

export const lighthouseStairs: SetDef = { interior: true, wallZ: WALL_Z + 0.6, Set: Stairwell };
