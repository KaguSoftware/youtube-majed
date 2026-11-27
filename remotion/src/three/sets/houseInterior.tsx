import { C } from "../../theme";
import { G, GradientPlane, M, flat, mat, shade } from "../kit";
import { Base, LampLight, TiledFloor, type SetDef, type SetProps } from "./common";

/**
 * The keeper's cottage (background `house_interior`): plank floor, plaster
 * walls over a wood wainscot, a window with curtains, a shelf of jars and
 * books, a rug, a floor lamp and a small stove. Warm at night (lamp and
 * stove), bright by day.
 */

const WALL_Z = -3.8;
const CEIL = 3.9;
/** The window, shelf and stove stand between and beyond the stage positions, so wall props (which hang at a position's x) never land on them. */
const WINDOW_X = 4.7;

function Window({ tod }: { tod: SetProps["tod"] }) {
  const frame = mat(C.woodDark);
  const sky = tod === "night" ? ["#0b1230", "#26325c"] : tod === "dusk" ? ["#5a4a8a", "#f6b27a"] : ["#7fbde6", "#e6f4f8"];
  return (
    <group position={[WINDOW_X, 1.75, WALL_Z + 0.02]}>
      {/* the view: sky, a far hill line */}
      <GradientPlane w={1.5} h={1.3} top={sky[0]!} bottom={sky[1]!} p={[0, 0, 0]} backdrop={false} />
      <mesh geometry={G.plane(1.5, 0.35)} material={flat(tod === "night" ? "#18243f" : tod === "dusk" ? "#6a4a6a" : "#7fb07a")} position={[0, -0.48, 0.004]} />
      {tod === "night" && <mesh geometry={G.circle(0.09, 12)} material={flat("#f4efd8")} position={[0.35, 0.3, 0.006]} />}
      {/* frame, mullions, sill */}
      {[-0.78, 0.78].map((x) => <M key={x} g={G.box(0.1, 1.45, 0.14)} m={frame} p={[x, 0, 0]} />)}
      {[-0.7, 0.7].map((y) => <M key={y} g={G.box(1.66, 0.1, 0.14)} m={frame} p={[0, y, 0]} />)}
      <M g={G.box(0.05, 1.3, 0.06)} m={frame} p={[0, 0, 0.02]} />
      <M g={G.box(1.5, 0.05, 0.06)} m={frame} p={[0, 0.05, 0.02]} />
      <M g={G.box(1.9, 0.07, 0.3)} m={mat(C.woodLight)} p={[0, -0.78, 0.1]} />
      {/* curtains, tied back */}
      {[-1, 1].map((s) => (
        <M key={s} g={G.cyl(0.12, 0.26, 1.7, 6)} m={mat("#c4584a")} p={[s * 1.02, -0.05, 0.14]} s={[1, 1, 0.45]} />
      ))}
      <M g={G.cyl(0.025, 0.025, 2.5, 5)} m={frame} p={[0, 0.88, 0.16]} r={[0, 0, Math.PI / 2]} />
    </group>
  );
}

function Shelf() {
  const plank = mat(C.wood);
  const jar = (x: number, h: number, color: string) => <M key={x} g={G.cyl(0.07, 0.07, h, 7)} m={mat(color, { rough: 0.4 })} p={[x, h / 2 + 0.03, 0]} />;
  return (
    <group position={[-4.5, 0, WALL_Z + 0.2]}>
      {[1.35, 1.95].map((y) => (
        <group key={y} position={[0, y, 0]}>
          <M g={G.box(1.5, 0.05, 0.3)} m={plank} />
          {[-0.62, 0.62].map((x) => <M key={x} g={G.box(0.04, 0.16, 0.22)} m={mat(C.woodDark)} p={[x, -0.1, -0.02]} />)}
        </group>
      ))}
      <group position={[0, 1.38, 0]}>
        {jar(-0.5, 0.22, "#d9a94e")}
        {jar(-0.3, 0.16, "#7cbf9a")}
        {jar(-0.12, 0.26, "#c97a5a")}
        {[0.12, 0.2, 0.27, 0.34, 0.43].map((x, i) => <M key={x} g={G.box(0.07, 0.25 + (i % 2) * 0.05, 0.2)} m={mat(["#5b6b8c", "#a8352d", "#3f7a5c", "#e0a030", "#7a4a6a"][i]!)} p={[x, 0.15, 0]} r={[0, 0, i === 4 ? -0.25 : 0]} />)}
      </group>
      <group position={[0, 1.98, 0]}>
        <M g={G.ico(0.11, 1)} m={mat("#e6dccb")} p={[-0.45, 0.11, 0]} />
        <M g={G.cyl(0.09, 0.12, 0.2, 7)} m={mat("#b9574a")} p={[0.05, 0.1, 0]} />
        <M g={G.cone(0.1, 0.25, 4)} m={mat("#3f7a5c")} p={[0.05, 0.3, 0]} />
        <M g={G.box(0.3, 0.22, 0.04)} m={mat(C.woodDark)} p={[0.45, 0.13, -0.05]} r={[-0.15, 0, 0]} />
      </group>
    </group>
  );
}

function Stove({ light, frame }: SetProps) {
  const iron = mat("#3a3640", { metal: 0.3, rough: 0.6 });
  const on = light.practical > 0.5;
  const flick = 0.85 + Math.sin(frame * 0.9) * 0.1 + Math.sin(frame * 2.3) * 0.05;
  return (
    <group position={[-6.2, 0, WALL_Z + 0.55]}>
      <M g={G.box(0.9, 0.8, 0.7)} m={iron} p={[0, 0.5, 0]} />
      <M g={G.box(1.0, 0.06, 0.8)} m={iron} p={[0, 0.92, 0]} />
      {[-0.35, 0.35].map((x) => [-0.25, 0.25].map((z) => <M key={`${x}${z}`} g={G.box(0.06, 0.12, 0.06)} m={iron} p={[x, 0.06, z]} />))}
      <mesh geometry={G.plane(0.4, 0.26)} material={on ? flat("#ff9a4a") : mat("#4a2a20")} position={[0, 0.46, 0.351]} />
      <M g={G.cyl(0.09, 0.09, CEIL - 0.95, 7)} m={iron} p={[0.2, 0.95 + (CEIL - 0.95) / 2, -0.1]} />
      <M g={G.cyl(0.14, 0.12, 0.2, 7)} m={mat("#6a5a50")} p={[-0.2, 1.05, 0.05]} />
      {on && <pointLight color="#ff8a3a" intensity={2.2 * flick * light.practical} distance={6} decay={1.8} position={[0, 0.5, 0.7]} />}
    </group>
  );
}

function FloorLamp({ light }: SetProps) {
  const on = light.practical > 0.5;
  return (
    <group position={[3.0, 0, WALL_Z + 0.7]}>
      <M g={G.cyl(0.2, 0.22, 0.05, 8)} m={mat("#3a3640")} p={[0, 0.025, 0]} />
      <M g={G.cyl(0.025, 0.025, 1.55, 5)} m={mat("#3a3640")} p={[0, 0.8, 0]} />
      <M g={G.cyl(0.18, 0.3, 0.32, 8, true)} m={on ? mat("#f6d9a0", { glow: 0.9, emissive: "#ffcf8a" }) : mat("#efe0bf")} p={[0, 1.68, 0]} />
      <LampLight p={[0, 1.6, 0]} light={light} power={1.6} distance={9} bulb={0.06} shadow />
    </group>
  );
}

function House(p: SetProps) {
  const { tod } = p;
  const plaster = mat("#efe2c8");
  const panel = mat(C.wood);
  return (
    <group>
      <Base w={40} d={22} color={shade(C.woodDark, 0.8)} z={5} />
      <TiledFloor w={40} d={16} tile={[1.7, 0.24]} rows colors={[C.wood, C.woodLight, "#c08f62", "#a9784f"]} z={WALL_Z + 8} seed={6} />
      {/* back wall: plaster over a wainscot, a dado rail */}
      <M g={G.box(40, CEIL, 0.2)} m={plaster} p={[0, CEIL / 2, WALL_Z - 0.1]} />
      <M g={G.box(40, 0.95, 0.06)} m={panel} p={[0, 0.475, WALL_Z + 0.03]} />
      {Array.from({ length: 30 }, (_, i) => -14.5 + i).map((x) => <M key={x} g={G.box(0.03, 0.85, 0.07)} m={mat(C.woodDark)} p={[x, 0.45, WALL_Z + 0.04]} />)}
      <M g={G.box(40, 0.06, 0.1)} m={mat(C.woodDark)} p={[0, 0.97, WALL_Z + 0.05]} />
      {/* ceiling and its beams */}
      <M g={G.plane(40, 18)} m={mat("#e8dcc4")} p={[0, CEIL, WALL_Z + 9]} r={[Math.PI / 2, 0, 0]} />
      {[-0.5, 2.5, 5.5, 8.5].map((z) => <M key={z} g={G.box(40, 0.22, 0.22)} m={mat(C.woodDark)} p={[0, CEIL - 0.11, WALL_Z + 0.4 + z]} />)}
      <Window tod={tod} />
      <Shelf />
      <Stove {...p} />
      <FloorLamp {...p} />
      {/* rug */}
      <mesh geometry={G.circle(1.5, 10)} material={mat("#c4584a")} position={[0, 0.008, -0.6]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.6, 0.85, 1]} receiveShadow />
      <mesh geometry={G.circle(1.2, 10)} material={mat("#e0a24e")} position={[0, 0.011, -0.6]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.6, 0.85, 1]} receiveShadow />
      <mesh geometry={G.circle(0.85, 10)} material={mat("#c4584a")} position={[0, 0.014, -0.6]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.6, 0.85, 1]} receiveShadow />
      {/* a chest under the window, a basket by the stove */}
      <M g={G.box(1.1, 0.5, 0.5)} m={mat(C.woodDark)} p={[WINDOW_X, 0.25, WALL_Z + 0.35]} />
      <M g={G.box(1.14, 0.06, 0.54)} m={mat(C.woodLight)} p={[WINDOW_X, 0.52, WALL_Z + 0.35]} />
      <M g={G.cyl(0.25, 0.2, 0.35, 8, true)} m={mat("#c9995e")} p={[-5.3, 0.18, WALL_Z + 0.5]} />
      {[0, 1, 2].map((i) => <M key={i} g={G.cyl(0.05, 0.05, 0.5, 5)} m={mat(C.woodDark)} p={[-5.3 + (i - 1) * 0.1, 0.38, WALL_Z + 0.5]} r={[0, 0, Math.PI / 2 + (i - 1) * 0.3]} />)}
    </group>
  );
}

export const houseInterior: SetDef = { interior: true, wallZ: WALL_Z + 0.04, Set: House };
