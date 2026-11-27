import { C } from "../../theme";
import { G, M, flat, mat, shade } from "../kit";
import { rand } from "../world";
import { Base, LampLight, Sky, TiledFloor, type SetDef, type SetProps } from "./common";

/**
 * A small harbour-town street (background `street`): cobbles, a pavement
 * along a row of narrow painted houses with pitched roofs, a shop with a
 * striped awning, a lamp post, hills and the harbour's masts beyond. Windows
 * light up at dusk and night.
 */

const ROW_Z = -4.6;
const HOUSES = [
  { w: 2.9, h: 4.6, color: "#e8b9a0", roof: C.roofWarm },
  { w: 3.4, h: 5.4, color: "#a9c7d6", roof: C.roof },
  { w: 2.6, h: 4.2, color: "#f0d9a0", roof: C.roofWarm },
  { w: 3.6, h: 3.8, color: "#d9cbb8", roof: "#7a5a4a", shop: true },
  { w: 2.8, h: 5.0, color: "#c9d6b0", roof: C.roof },
  { w: 3.1, h: 4.4, color: "#e6c0c8", roof: C.roofWarm },
  { w: 2.7, h: 5.2, color: "#b8c4e0", roof: "#5b4a6a" },
  { w: 3.3, h: 4.0, color: "#f2e2c8", roof: C.roofWarm },
];

function House({ x, w, h, color, roof, shop, lit, seed }: { x: number; w: number; h: number; color: string; roof: string; shop?: boolean; lit: number; seed: number }) {
  const wall = mat(color);
  const trim = mat(shade(color, 0.78));
  const frame = mat("#f6f1e7");
  const win = (wx: number, wy: number, k: number) => {
    const on = lit > 0.6 && rand(seed, k) < 0.65;
    return (
      <group key={k} position={[wx, wy, 0.16]}>
        <M g={G.box(0.72, 0.95, 0.06)} m={frame} />
        <mesh geometry={G.plane(0.58, 0.8)} material={on ? flat("#ffd68a") : mat("#5d7a94", { rough: 0.3 })} position={[0, 0, 0.035]} />
        <M g={G.box(0.04, 0.8, 0.02)} m={frame} p={[0, 0, 0.045]} />
        <M g={G.box(0.82, 0.07, 0.16)} m={trim} p={[0, -0.5, 0.05]} />
      </group>
    );
  };
  const floors = Math.max(1, Math.floor((h - 1.6) / 1.5));
  return (
    <group position={[x, 0, ROW_Z]}>
      <M g={G.box(w, h, 0.3)} m={wall} p={[0, h / 2, 0]} />
      {/* the roof: a triangular prism along the front, a chimney */}
      <M g={G.cyl(w * 0.62, w * 0.62, 1.4, 3)} m={mat(roof)} p={[0, h + w * 0.28, -0.4]} r={[-Math.PI / 2, 0, 0]} />
      {seed % 2 === 0 && <M g={G.box(0.35, 0.9, 0.35)} m={mat("#8a5a4a")} p={[w * 0.25, h + w * 0.42, -0.5]} />}
      <M g={G.box(w + 0.1, 0.14, 0.4)} m={trim} p={[0, h, 0.05]} />
      {shop ? (
        <group>
          {/* shop front: a big window, a door, a striped awning */}
          <M g={G.box(w - 0.4, 1.9, 0.08)} m={trim} p={[-0.3, 1.25, 0.16]} />
          <mesh geometry={G.plane(w - 1.9, 1.4)} material={lit > 0.6 ? flat("#ffe2a8") : mat("#7a98b0", { rough: 0.2 })} position={[-0.55, 1.3, 0.21]} />
          <M g={G.box(0.8, 1.8, 0.06)} m={mat(C.woodDark)} p={[w / 2 - 0.75, 0.9, 0.2]} />
          {Array.from({ length: 8 }, (_, i) => (
            <M key={i} g={G.box(w / 8, 0.06, 1.1)} m={mat(i % 2 ? "#f6f1e7" : "#c0392b")} p={[-w / 2 + (i + 0.5) * (w / 8), 2.55, 0.65]} r={[0.45, 0, 0]} />
          ))}
          <M g={G.box(w, 0.4, 0.06)} m={mat("#3d4256")} p={[0, 2.95, 0.18]} />
          {Array.from({ length: Math.floor(w / 1.2) }, (_, i) => win(-w / 2 + 0.7 + i * 1.2, 3.4, i + 10))}
        </group>
      ) : (
        <group>
          <M g={G.box(0.8, 1.85, 0.08)} m={mat(rand(seed, 9) > 0.5 ? "#3f6f8a" : "#8a3a3a")} p={[(rand(seed, 3) - 0.5) * (w - 1.2), 0.93, 0.17]} />
          <M g={G.box(1.0, 0.1, 0.4)} m={mat(C.stoneDark)} p={[(rand(seed, 3) - 0.5) * (w - 1.2), 0.05, 0.3]} />
          {Array.from({ length: floors }, (_, f) =>
            Array.from({ length: Math.max(1, Math.floor(w / 1.25)) }, (_, i) => win(-w / 2 + 0.65 + i * ((w - 1.3) / Math.max(1, Math.floor(w / 1.25) - 1 || 1)), 2.4 + f * 1.5, f * 10 + i)),
          )}
        </group>
      )}
    </group>
  );
}

function Street({ tod, light }: SetProps) {
  const lit = light.glow;
  let x = -14;
  const row = [...HOUSES, ...HOUSES.slice(0, 3)].map((hh, i) => {
    const h = <House key={i} x={x + hh.w / 2} {...hh} lit={lit} seed={i + 2} />;
    x += hh.w + 0.05;
    return h;
  });
  return (
    <group>
      <Sky tod={tod} z={-120} y={14} w={320} h={110} />
      {/* hills and the harbour beyond the roofs */}
      {[[-30, -60, 18], [5, -70, 24], [40, -62, 16], [-60, -80, 26]].map(([hx, hz, r], i) => (
        <M key={i} g={G.rock(r!, i + 60, 1)} m={mat(tod === "night" ? "#2c3f5a" : tod === "dusk" ? "#8a6a8a" : "#8fb59a")} p={[hx!, -r! * 0.55, hz!]} s={[1.6, 0.6, 1]} cast={false} />
      ))}
      {[-6, -2.5, 3, 7.5].map((mx, i) => <M key={i} g={G.cyl(0.08, 0.1, 9 + i, 5)} m={mat("#5a4a3a")} p={[mx, 4.5, -24]} cast={false} />)}
      <Base w={60} d={30} color="#7d746a" z={3} />
      {/* pavement along the houses, then the cobbled street up to the camera */}
      <TiledFloor w={60} d={2.2} tile={[0.9, 0.7]} colors={["#c9c1b4", "#bfb7aa", "#d2cbbf"]} z={ROW_Z + 1.25} seed={2} />
      <M g={G.box(60, 0.12, 0.2)} m={mat("#9a9184")} p={[0, 0.06, ROW_Z + 2.4]} />
      <TiledFloor w={60} d={15} tile={[0.34, 0.28]} rows colors={[C.cobble, C.cobbleDark, "#b4aa9d", "#9d9386"]} z={ROW_Z + 10} seed={12} />
      {row}
      {/* lamp post, a bench-like low wall, flower boxes */}
      <group position={[4.4, 0, ROW_Z + 1.9]}>
        <M g={G.cyl(0.07, 0.1, 3.3, 6)} m={mat("#2f3344")} p={[0, 1.65, 0]} />
        <M g={G.cyl(0.03, 0.03, 0.6, 5)} m={mat("#2f3344")} p={[0.25, 3.25, 0]} r={[0, 0, Math.PI / 2]} />
        <M g={G.cone(0.2, 0.3, 6)} m={mat("#2f3344")} p={[0.5, 3.15, 0]} />
        <LampLight p={[0.5, 2.98, 0]} light={light} power={1.6} distance={10} bulb={0.1} shadow />
      </group>
      {[-6.8, -1.2, 9.5].map((bx, i) => (
        <group key={i} position={[bx, 0, ROW_Z + 0.45]}>
          <M g={G.box(1.0, 0.3, 0.3)} m={mat(C.woodDark)} p={[0, 1.1, 0]} />
          {[0, 1, 2, 3].map((k) => <M key={k} g={G.ico(0.11, 0)} m={mat(["#d0473d", "#f2c230", "#d04f8a", "#f6f1e7"][(k + i) % 4]!)} p={[-0.36 + k * 0.24, 1.33, 0]} />)}
        </group>
      ))}
      {/* barrels by the shop */}
      {[-0.2, 0.45].map((bx, i) => <M key={i} g={G.cyl(0.3, 0.3, 0.75, 8)} m={mat(C.wood)} p={[bx + 2.4, 0.37, ROW_Z + 0.75]} />)}
    </group>
  );
}

export const street: SetDef = { interior: false, wallZ: ROW_Z + 0.2, skyY: 12, Set: Street };
