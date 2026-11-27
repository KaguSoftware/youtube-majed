import * as THREE from "three";
import { C } from "../../theme";
import { G, M, flat, mat } from "../kit";
import { rand } from "../world";
import { Sky, type SetDef, type SetProps } from "./common";

/**
 * The lighthouse on its rocky point (background `lighthouse_exterior`). The
 * characters stand on the grassy cliff top; the red-and-white tower rises
 * behind them on the left, the sea opens out to the right and behind, down
 * below the cliff. At dusk and night the lamp burns and its beam sweeps.
 */

const SEA_Y = -5;

function Tower({ frame, light }: SetProps) {
  const on = light.practical > 0.5;
  const bands = 6;
  const h = 7.2;
  const r0 = 1.25;
  const r1 = 0.9;
  const rAt = (y: number) => r0 + (r1 - r0) * (y / h);
  const beamAngle = (frame / 30) * 1.1;
  return (
    <group position={[-10, -1.2, -24]} scale={0.65}>
      {/* base rock and keeper's hut */}
      <M g={G.rock(1.9, 3)} m={mat(C.rock)} p={[0, 0.2, 0]} s={[1.4, 0.6, 1.3]} />
      <group position={[2.4, 1.85, 0.6]}>
        <M g={G.box(2.2, 1.7, 1.6)} m={mat(C.white)} p={[0, 0.85, 0]} />
        <M g={G.cyl(1.25, 1.25, 2.4, 3)} m={mat(C.redDark)} p={[0, 2.05, 0]} r={[0, 0, Math.PI / 2]} s={[0.6, 1, 1.2]} />
        <M g={G.box(0.5, 0.9, 0.06)} m={mat(C.woodDark)} p={[0.4, 0.45, 0.82]} />
        <mesh geometry={G.plane(0.45, 0.4)} material={on ? flat("#ffd68a") : mat("#bfe0ee")} position={[-0.5, 1.0, 0.81]} />
      </group>
      {/* the tower in bands */}
      {Array.from({ length: bands }, (_, i) => {
        const y0 = (i / bands) * h;
        const y1 = ((i + 1) / bands) * h;
        return <M key={i} g={G.cyl(rAt(y1), rAt(y0), y1 - y0, 10)} m={mat(i % 2 ? C.red : C.white)} p={[0, 0.5 + (y0 + y1) / 2, 0]} />;
      })}
      <group position={[0, 0.5 + h, 0]}>
        {/* gallery with its railing */}
        <M g={G.cyl(r1 + 0.35, r1 + 0.35, 0.14, 12)} m={mat("#3d4256")} />
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return <M key={i} g={G.box(0.04, 0.45, 0.04)} m={mat("#3d4256")} p={[Math.cos(a) * (r1 + 0.3), 0.28, Math.sin(a) * (r1 + 0.3)]} />;
        })}
        <M g={G.torus(r1 + 0.3, 0.025, 4, 16)} m={mat("#3d4256")} p={[0, 0.5, 0]} r={[Math.PI / 2, 0, 0]} />
        {/* lantern room */}
        <mesh geometry={G.cyl(0.62, 0.62, 0.95, 8)} material={on ? flat("#ffe6a0") : mat("#cfe6f2", { opacity: 0.6, rough: 0.1 })} position={[0, 0.6, 0]} />
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return <M key={i} g={G.box(0.05, 0.95, 0.05)} m={mat("#2f3344")} p={[Math.cos(a) * 0.63, 0.6, Math.sin(a) * 0.63]} />;
        })}
        <M g={G.cone(0.85, 0.75, 10)} m={mat(C.redDark)} p={[0, 1.45, 0]} />
        <M g={G.ico(0.1, 0)} m={mat("#3d4256")} p={[0, 1.9, 0]} />
        {on && (
          <>
            <pointLight color="#ffd890" intensity={light.practical * 14} distance={30} decay={1.4} position={[0, 0.6, 0]} />
            {/* the sweeping beam: a long faint cone pointing out from the lamp */}
            <group position={[0, 0.6, 0]} rotation={[0, beamAngle, 0]}>
              <mesh geometry={beamGeo} material={flat("#fff2c0", { opacity: 0.16, additive: true, fog: false, side: THREE.DoubleSide })} rotation={[0, 0, -Math.PI / 2]} position={[13, 0, 0]} />
            </group>
          </>
        )}
      </group>
    </group>
  );
}
const beamGeo = new THREE.ConeGeometry(2.6, 26, 12, 1, true);

function Sea({ frame, tod }: SetProps) {
  const color = tod === "night" ? "#1d3560" : tod === "dusk" ? "#5a6a9a" : C.sea;
  const bob = Math.sin(frame / 25) * 0.06;
  return (
    <group position={[0, SEA_Y + bob, 0]}>
      <mesh geometry={G.terrain(400, 260, 120, 0.35, 11)} material={mat(color, { rough: 0.35, metal: 0.1 })} position={[0, 0, -100]} receiveShadow />
      {/* foam where the sea meets the cliff */}
      {Array.from({ length: 14 }, (_, i) => (
        <mesh key={i} geometry={G.ico(0.5 + rand(i, 5) * 0.5, 0)} material={mat(C.foam)} position={[7.5 + rand(i, 1) * 2, 0.05 + Math.sin(frame / 12 + i) * 0.06, -29 + i * 3]} scale={[1.6, 0.25, 1.2]} />
      ))}
    </group>
  );
}

function Cliff({ tod }: SetProps) {
  const grass = mat(tod === "night" ? "#4a7a5a" : C.grass);
  const grassDark = mat(C.grassDark);
  const rock = mat(C.rock);
  const rockDark = mat(C.rockDark);
  return (
    <group>
      {/* the cliff top: grass over a block of rock, its right edge and its back edge falling to the sea */}
      <mesh geometry={G.terrain(32, 42, 34, 0.18, 4)} material={grass} position={[-9, 0, -9]} receiveShadow />
      <M g={G.box(32, 5.2, 42)} m={rockDark} p={[-9, -2.65, -9]} />
      {/* the point dips toward the tower */}
      <M g={G.rock(5, 77)} m={rockDark} p={[-10, -2.2, -24]} s={[1.4, 0.5, 1.1]} />
      {/* a worn path of flat stones across the stage */}
      {Array.from({ length: 16 }, (_, i) => (
        <mesh key={i} geometry={G.dodeca(0.32)} material={mat(C.stone)} position={[-7 + i * 0.85, 0.02, 0.6 + Math.sin(i * 1.7) * 0.25]} scale={[1, 0.12, 0.8]} rotation={[0, i, 0]} receiveShadow />
      ))}
      {/* rocks along the cliff edge, big ones down the face */}
      {Array.from({ length: 28 }, (_, i) => {
        const z = -29 + i * 1.45;
        return <M key={i} g={G.rock(0.7 + rand(i, 2) * 0.9, i)} m={i % 3 ? rock : rockDark} p={[7.1 + rand(i, 3) * 0.6, -0.3 - rand(i, 4) * 1.5, z]} />;
      })}
      {Array.from({ length: 10 }, (_, i) => (
        <M key={`b${i}`} g={G.rock(1.4 + rand(i, 7), i + 20)} m={rockDark} p={[8 + rand(i, 8), -3.2, -28 + i * 4.2]} />
      ))}
      {/* tufts and a few stones on the grass */}
      {Array.from({ length: 30 }, (_, i) => {
        const x = -14 + rand(i, 11) * 20;
        const z = -12 + rand(i, 12) * 13;
        if (Math.abs(z - 0.3) < 1.4 && x > -7 && x < 6.5) return null; // keep the stage clear
        return <M key={`t${i}`} g={G.cone(0.12, 0.35, 4)} m={i % 2 ? grassDark : grass} p={[x, 0.15, z]} r={[0, i, 0]} />;
      })}
      {[[-3.2, -5.5, 0.55], [4.6, -2.6, 0.45], [-9.5, -3, 0.8], [3, -9, 0.7]].map(([x, z, r], i) => (
        <M key={`r${i}`} g={G.rock(r!, i + 50)} m={rock} p={[x!, r! * 0.35, z!]} />
      ))}
      {/* a short wooden fence by the edge */}
      {Array.from({ length: 6 }, (_, i) => <M key={`f${i}`} g={G.box(0.1, 0.95, 0.1)} m={mat(C.woodDark)} p={[6.2, 0.47, -7 + i * 1.3]} />)}
      {[0.45, 0.8].map((y) => <M key={y} g={G.box(0.06, 0.08, 6.6)} m={mat(C.wood)} p={[6.2, y, -3.75]} />)}
    </group>
  );
}

function Exterior(p: SetProps) {
  return (
    <group>
      <Sky tod={p.tod} z={-180} y={10} w={520} h={160} moonX={60} />
      <Sea {...p} />
      <Cliff {...p} />
      <Tower {...p} />
    </group>
  );
}

export const lighthouseExterior: SetDef = { interior: false, wallZ: -3, horizon: { z: -70, y: SEA_Y }, skyY: 12, Set: Exterior };
