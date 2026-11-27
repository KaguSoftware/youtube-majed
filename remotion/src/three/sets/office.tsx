import { G, M, flat, mat, shade } from "../kit";
import { Base, LampLight, Sky, Skyline, TiledFloor, type SetDef, type SetProps } from "./common";

/**
 * Open-plan office (background `office`): carpet tiles, a long window band
 * onto the city with half-drawn blinds, desk clusters with glowing monitors,
 * a water cooler, a plant, ceiling light panels. Characters stand in the
 * clear aisle in front of the desks.
 */

const WALL_Z = -4.4;
const CEIL = 4.3;

function Desk({ x, z, flip, glow, seed }: { x: number; z: number; flip?: boolean; glow: number; seed: number }) {
  const top = mat("#d9d2c4");
  const leg = mat("#5d6475", { metal: 0.3, rough: 0.6 });
  const screen = glow > 0.6 ? flat(seed % 2 ? "#9fd4ff" : "#bfe8d8") : mat("#2b3346", { glow: 0.3, emissive: "#6fa8d8" });
  const f = flip ? -1 : 1;
  return (
    <group position={[x, 0, z]}>
      <M g={G.box(1.7, 0.05, 0.8)} m={top} p={[0, 0.74, 0]} />
      {[-0.78, 0.78].map((lx) => (
        <M key={lx} g={G.box(0.05, 0.72, 0.7)} m={leg} p={[lx, 0.36, 0]} />
      ))}
      {/* low partition behind the desk */}
      <M g={G.box(1.8, 0.5, 0.05)} m={mat("#7d8aa3")} p={[0, 1.0, -0.42]} />
      {/* monitor */}
      <group position={[0.25 * f, 0.77, -0.15]}>
        <M g={G.box(0.08, 0.2, 0.08)} m={leg} p={[0, 0.1, 0]} />
        <M g={G.box(0.62, 0.4, 0.04)} m={mat("#22283a")} p={[0, 0.38, 0]} />
        <mesh geometry={G.plane(0.56, 0.34)} material={screen} position={[0, 0.38, 0.021]} />
      </group>
      <M g={G.box(0.42, 0.02, 0.15)} m={mat("#3a4052")} p={[0.2 * f, 0.775, 0.15]} />
      <M g={G.cyl(0.05, 0.04, 0.1, 6)} m={mat(seed % 3 ? "#d0473d" : "#e0a030")} p={[-0.55 * f, 0.82, 0.1]} />
      {/* office chair, pushed in */}
      <group position={[0.15 * f, 0, 0.6]}>
        <M g={G.cyl(0.24, 0.24, 0.07, 8)} m={mat("#2f3547")} p={[0, 0.48, 0]} />
        <M g={G.box(0.44, 0.5, 0.06)} m={mat("#2f3547")} p={[0, 0.8, 0.22]} />
        <M g={G.cyl(0.03, 0.03, 0.42, 5)} m={leg} p={[0, 0.25, 0]} />
        <M g={G.cyl(0.26, 0.26, 0.04, 5)} m={leg} p={[0, 0.03, 0]} />
      </group>
      {glow > 0.6 && <pointLight color="#9fc8ff" intensity={glow * 0.5} distance={2.4} decay={2} position={[0.25 * f, 1.15, 0.2]} />}
    </group>
  );
}

function Office({ tod, light }: SetProps) {
  const night = tod === "night";
  const wall = mat("#ece6d8");
  const trim = mat("#9aa3b5");
  const glow = light.glow;
  return (
    <group>
      {/* the city through the window */}
      <Sky tod={tod} z={-120} y={18} w={300} h={110} />
      <group position={[0, -6, 0]}>
        <Skyline z={-40} x0={-60} x1={60} seed={3} glow={glow} hMin={10} hMax={34} lit={night ? 0.5 : 0.25} />
        <Skyline z={-70} x0={-90} x1={90} seed={8} glow={glow * 0.7} hMin={14} hMax={44} colors={["#6a7590", "#5b6680", "#76809a"]} lit={0.35} />
      </group>

      {/* floor and ceiling */}
      <Base w={40} d={22} color="#7d8798" z={5} />
      <TiledFloor w={40} d={15} tile={1.0} colors={["#98a2b1", "#929cac", "#9ea7b5", "#8c97a8"]} z={WALL_Z + 7.5} seed={4} />
      <M g={G.plane(40, 18)} m={mat("#f4f1ea")} p={[0, CEIL, WALL_Z + 9]} r={[Math.PI / 2, 0, 0]} />
      {[-6, -2, 2, 6].map((x) =>
        [-2.6, 0.8].map((z) => (
          <group key={`${x},${z}`}>
            <mesh geometry={G.plane(1.2, 0.6)} material={night || tod === "dusk" ? flat("#fdf8ec") : mat("#f6f2ea", { glow: 0.4 })} position={[x, CEIL - 0.01, z]} rotation={[Math.PI / 2, 0, 0]} />
          </group>
        )),
      )}
      <LampLight p={[-3.5, CEIL - 0.25, -1.4]} light={light} color="#eef2ff" power={1.4} distance={12} bulb={0.01} shadow />
      <LampLight p={[3.5, CEIL - 0.25, -1.4]} light={light} color="#eef2ff" power={1.4} distance={12} bulb={0.01} />

      {/* back wall: a solid feature wall in the middle (wall props hang there), window bands onto the city either side */}
      <group position={[0, 0, WALL_Z]}>
        <M g={G.box(40, 0.95, 0.25)} m={wall} p={[0, 0.475, 0]} />
        <M g={G.box(40, 0.6, 0.25)} m={wall} p={[0, CEIL - 0.3, 0]} />
        <M g={G.box(9.2, CEIL - 1.55, 0.25)} m={mat("#c7d3d6")} p={[0, 0.95 + (CEIL - 1.55) / 2, 0]} />
        <M g={G.box(9.2, 0.12, 0.27)} m={mat("#6f86a6")} p={[0, 1.35, 0.01]} />
        <M g={G.box(40, 0.06, 0.3)} m={trim} p={[0, 0.97, 0.03]} />
        <M g={G.box(40, 0.12, 0.3)} m={mat("#5a6172")} p={[0, 0.06, 0.03]} />
        {[-1, 1].map((side) => (
          <group key={side} position={[side * 10.3, 0, 0]}>
            {Array.from({ length: 7 }, (_, i) => -6 + i * 2).map((x) => (
              <M key={x} g={G.box(0.12, CEIL - 1.5, 0.2)} m={trim} p={[x, 0.95 + (CEIL - 1.5) / 2, 0]} />
            ))}
            <mesh geometry={G.plane(11.4, CEIL - 1.55)} material={flat(night ? "#0a1230" : tod === "dusk" ? "#e0a0a0" : "#cfe6f2", { opacity: 0.16 })} position={[0, 0.95 + (CEIL - 1.55) / 2, -0.02]} />
            {Array.from({ length: 9 }, (_, i) => (
              <M key={i} g={G.box(11.4, 0.035, 0.07)} m={mat(shade("#e2e0d8", night ? 0.75 : 1))} p={[0, CEIL - 0.62 - i * 0.09, 0.08]} r={[0.5, 0, 0]} cast={false} />
            ))}
          </group>
        ))}
      </group>

      {/* desks: a cluster each side, one further back in the middle */}
      <Desk x={-5.2} z={-2.6} glow={glow} seed={1} />
      <Desk x={-3.3} z={-2.6} glow={glow} seed={2} flip />
      <Desk x={3.3} z={-2.6} glow={glow} seed={3} />
      <Desk x={5.2} z={-2.6} glow={glow} seed={4} flip />
      <Desk x={-9} z={-2.4} glow={glow} seed={5} />
      <Desk x={9} z={-2.4} glow={glow} seed={6} flip />

      {/* water cooler */}
      <group position={[2.4, 0, WALL_Z + 0.5]}>
        <M g={G.box(0.36, 0.95, 0.36)} m={mat("#e9ecef")} p={[0, 0.475, 0]} />
        <M g={G.cyl(0.15, 0.17, 0.42, 8)} m={mat("#7cc4ef", { opacity: 0.75, rough: 0.2 })} p={[0, 1.17, 0]} />
        <M g={G.box(0.1, 0.06, 0.05)} m={mat("#3a6fd8")} p={[0, 0.82, 0.2]} />
      </group>
      {/* plant */}
      <group position={[-2.4, 0, WALL_Z + 0.45]}>
        <M g={G.cyl(0.22, 0.17, 0.42, 7)} m={mat("#c4584a")} p={[0, 0.21, 0]} />
        {[0, 1, 2, 3, 4].map((i) => (
          <M key={i} g={G.cone(0.13, 0.75, 4)} m={mat(i % 2 ? "#3f7a5c" : "#4f9468")} p={[Math.sin(i * 1.3) * 0.12, 0.72, Math.cos(i * 1.3) * 0.12]} r={[Math.cos(i * 1.3) * 0.35, 0, -Math.sin(i * 1.3) * 0.35]} />
        ))}
      </group>
      {/* filing cabinet */}
      <group position={[-7, 0, WALL_Z + 0.4]}>
        <M g={G.box(0.5, 1.25, 0.55)} m={mat("#8b93a5", { metal: 0.25, rough: 0.6 })} p={[0, 0.625, 0]} />
        {[0.3, 0.7, 1.05].map((y) => (
          <M key={y} g={G.box(0.16, 0.03, 0.03)} m={mat("#3a4052")} p={[0, y, 0.29]} />
        ))}
      </group>
      {/* columns */}
      {[-12, 12].map((x) => (
        <M key={x} g={G.box(0.6, CEIL, 0.6)} m={wall} p={[x, CEIL / 2, -1]} />
      ))}
    </group>
  );
}

export const office: SetDef = { interior: true, wallZ: WALL_Z + 0.14, Set: Office };
