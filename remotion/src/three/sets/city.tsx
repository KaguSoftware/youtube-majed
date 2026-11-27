import { G, M, flat, mat } from "../kit";
import { rand } from "../world";
import { Base, Building, LampLight, Sky, Skyline, TiledFloor, type SetDef, type SetProps } from "./common";

/**
 * A modern city street (background `city`): the characters on a wide
 * pavement, a road behind them with a crosswalk, a traffic light that cycles,
 * tall buildings with lit windows, a glowing billboard, street lamps, and a
 * skyline beyond. Best at dusk and night.
 */

const CURB_Z = -1.9;
const ROAD_Z0 = CURB_Z - 6.4;

function TrafficLight({ frame, x }: { frame: number; x: number }) {
  const phase = Math.floor(frame / 90) % 3; // green, amber, red, 3 s each
  const lamp = (i: number, on: string, off: string) => <mesh key={i} geometry={G.ico(0.09, 1)} material={phase === i ? flat(on) : mat(off)} position={[0, 0.3 - i * 0.24, 0.12]} />;
  return (
    <group position={[x, 0, CURB_Z + 0.35]}>
      <M g={G.cyl(0.07, 0.09, 3.2, 6)} m={mat("#2f3344")} p={[0, 1.6, 0]} />
      <group position={[0, 3.25, 0]}>
        <M g={G.box(0.32, 0.8, 0.22)} m={mat("#22252f")} />
        {lamp(2, "#4ae07a", "#1d3a2a")}
        {lamp(1, "#ffc23a", "#3a311a")}
        {lamp(0, "#ff4a3a", "#3a1a1a")}
      </group>
    </group>
  );
}

function Billboard({ glow, frame }: { glow: number; frame: number }) {
  const pulse = 1 + Math.sin(frame / 20) * 0.08;
  return (
    <group position={[5.5, 7.2, -15.4]}>
      <M g={G.box(6.4, 3.2, 0.3)} m={mat("#2a2d3e")} />
      <mesh geometry={G.plane(6.0, 2.8)} material={glow > 0.6 ? flat("#2fd8c8") : mat("#3fb8b0", { glow: 0.3 })} position={[0, 0, 0.16]} />
      <mesh geometry={G.circle(0.9, 16)} material={glow > 0.6 ? flat("#ff4fd8") : mat("#e04fb8")} position={[-1.6, 0, 0.17]} scale={[pulse, pulse, 1]} />
      {[0, 1, 2].map((i) => <mesh key={i} geometry={G.plane(2.4 - i * 0.6, 0.28)} material={flat("#fbf4e6")} position={[0.9, 0.6 - i * 0.55, 0.17]} />)}
      {[-2.4, 2.4].map((lx) => <M key={lx} g={G.box(0.15, 2.4, 0.15)} m={mat("#2f3344")} p={[lx, -2.8, -0.2]} />)}
    </group>
  );
}

function City({ tod, light, frame }: SetProps) {
  const glow = light.glow;
  const asphalt = mat("#3b3e48");
  const paint = mat("#f2efe6");
  const front = [
    { x: -11, w: 5.2, h: 15, c: "#6a7590" },
    { x: -5.6, w: 5.0, h: 22, c: "#525c75" },
    { x: -0.3, w: 5.4, h: 12, c: "#7a6a68" },
    { x: 5.4, w: 5.8, h: 18, c: "#5d6a80" },
    { x: 11.2, w: 5.4, h: 25, c: "#4a5268" },
    { x: 16.8, w: 5.6, h: 14, c: "#6f6470" },
    { x: -16.4, w: 5.4, h: 20, c: "#58607a" },
  ];
  return (
    <group>
      <Sky tod={tod} z={-150} y={22} w={420} h={140} moonX={-40} />
      <group position={[0, -2, 0]}>
        <Skyline z={-60} x0={-120} x1={120} seed={21} glow={glow * 0.8} hMin={16} hMax={48} colors={["#6a7590", "#5b6680", "#76809a"]} lit={0.35} />
      </group>
      {/* the far side of the street: buildings, their ground floors lit */}
      {front.map((b, i) => (
        <group key={i}>
          <Building p={[b.x, 0, ROAD_Z0 - 4.2]} size={[b.w, b.h, 4]} color={b.c} seed={i + 30} glow={glow} lit={tod === "day" ? 0.2 : 0.55} />
          {/* shop fronts: a dark frame, glass that glows warm or cool at night, an awning band */}
          <M g={G.box(b.w - 0.4, 2.3, 0.1)} m={mat("#2a2d3a")} p={[b.x, 1.4, ROAD_Z0 - 2.17]} />
          <mesh geometry={G.plane(b.w - 1.0, 1.7)} material={mat(rand(i, 4) > 0.5 ? "#c9a46a" : "#7a9ab8", { glow: glow > 0.6 ? 0.9 : 0.05, emissive: rand(i, 4) > 0.5 ? "#ffd08a" : "#a8d8ff", rough: 0.3 })} position={[b.x, 1.3, ROAD_Z0 - 2.1]} />
          <M g={G.box(b.w - 0.2, 0.25, 0.6)} m={mat(["#c0392b", "#2f9e8f", "#e0a030", "#3f6fd8"][i % 4]!)} p={[b.x, 2.65, ROAD_Z0 - 1.9]} />
        </group>
      ))}
      <Billboard glow={glow} frame={frame} />
      {/* far pavement, road, near pavement */}
      <Base w={80} d={40} color="#55565e" z={0} />
      <TiledFloor w={80} d={2.2} tile={1.1} colors={["#a8a8ae", "#9fa0a7", "#b0b0b6"]} z={ROAD_Z0 - 1.1} seed={3} />
      <M g={G.box(80, 0.03, 6.4)} m={asphalt} p={[0, 0.0, (CURB_Z + ROAD_Z0) / 2]} cast={false} />
      {Array.from({ length: 20 }, (_, i) => <M key={i} g={G.box(1.6, 0.012, 0.14)} m={paint} p={[-38 + i * 4, 0.02, (CURB_Z + ROAD_Z0) / 2]} cast={false} />)}
      {/* crosswalk */}
      {Array.from({ length: 8 }, (_, i) => <M key={`z${i}`} g={G.box(0.5, 0.014, 5.4)} m={paint} p={[-4.4 + i * 0.9, 0.022, (CURB_Z + ROAD_Z0) / 2]} cast={false} />)}
      <M g={G.box(80, 0.16, 0.25)} m={mat("#8f9097")} p={[0, 0.08, CURB_Z]} />
      <M g={G.box(80, 0.16, 0.25)} m={mat("#8f9097")} p={[0, 0.08, ROAD_Z0]} />
      <TiledFloor w={80} d={16} tile={1.2} colors={["#b9b9bf", "#b0b1b7", "#c2c2c8", "#a9aab1"]} z={CURB_Z + 8} seed={5} />
      <TrafficLight frame={frame} x={-5.3} />
      {[-9.5, 6.4, 15].map((lx) => (
        <group key={lx} position={[lx, 0, CURB_Z + 0.3]}>
          <M g={G.cyl(0.07, 0.1, 4.2, 6)} m={mat("#2f3344")} p={[0, 2.1, 0]} />
          <M g={G.box(1.0, 0.06, 0.06)} m={mat("#2f3344")} p={[0.45, 4.15, 0]} />
          <M g={G.box(0.45, 0.1, 0.22)} m={mat("#2f3344")} p={[0.9, 4.1, 0]} />
          <LampLight p={[0.9, 4.0, 0]} light={light} color="#ffe0b0" power={2} distance={12} bulb={0.08} shadow={lx === 6.4} />
        </group>
      ))}
      {/* a hydrant and a bin on the pavement */}
      <group position={[3.2, 0, CURB_Z + 0.5]}>
        <M g={G.cyl(0.13, 0.15, 0.6, 7)} m={mat("#d0473d")} p={[0, 0.3, 0]} />
        <M g={G.ico(0.14, 0)} m={mat("#d0473d")} p={[0, 0.62, 0]} />
      </group>
      <M g={G.cyl(0.25, 0.22, 0.85, 8)} m={mat("#3f6f5a")} p={[-7.2, 0.43, CURB_Z + 0.5]} />
    </group>
  );
}

export const city: SetDef = { interior: false, wallZ: ROAD_Z0 - 2.1, skyY: 16, Set: City };
