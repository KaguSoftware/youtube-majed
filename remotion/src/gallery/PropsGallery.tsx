import { PROPS, type ActionId, type PropId, type Scene } from "@studio/schema";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { InteriorContext } from "../library/prop-kit";
import { PROP_IMPL } from "../library/props";
import { Stage, placeAll } from "../scene/SceneView";
import { C, H, PAPER, W, type TimeOfDay } from "../theme";
import { Cell, cast } from "./kit";

/**
 * Every prop. Page 1: things held in the hand (glowing ones on a night card).
 * Page 2: things placed on the ground, wall or sky; seats, beds and the car
 * shown in use.
 */

const GROUND = 880;
const NIGHT = new Set<PropId>(["lantern", "flashlight", "torch", "candle", "phone"]);
const HOLD_ACTION: Partial<Record<PropId, ActionId>> = {
  phone: "phone_call", book: "read", newspaper: "read", map: "read", letter: "read", mug: "drink", food: "eat",
  box: "carry", gift: "carry", money: "talk", cards: "talk", sword: "point", torch: "point", flashlight: "point", magnifier: "point", key: "point",
};
const USE: Partial<Record<PropId, { action: ActionId; extra?: Scene["props"] }>> = {
  chair: { action: "sit_chair" }, stool: { action: "sit_chair" }, bench: { action: "sit_chair" }, sofa: { action: "sit_chair" },
  crate: { action: "sit_edge" }, rock: { action: "sit_edge" }, bed: { action: "sleep" }, car: { action: "drive" },
  desk: { action: "type", extra: [{ id: "chair", pos: "center" }] }, table: { action: "sit_chair", extra: [{ id: "chair", pos: "center" }] },
};

const all = Object.keys(PROPS) as PropId[];
export const HELD_IDS = all.filter((id) => PROPS[id].placement === "hand" || PROPS[id].placement === "hand_or_ground");
export const PLACED_IDS = all.filter((id) => !HELD_IDS.includes(id) || id === "box" || id === "money_bag");

const LOOK = cast({ color: "#2f9e8f", hair: "short", hairColor: "#5a3825" });

function scene(chars: Scene["chars"], props: Scene["props"]): Scene {
  return { id: "S1", lineIds: ["L1.1"], bg: "street", grade: "day", camera: "static", transitionIn: "cut", caption: "none", sfx: [], overlays: [], chars, props };
}

function PropCell({ id, held, x, y, w, h }: { id: PropId; held: boolean; x: number; y: number; w: number; h: number }) {
  const frame = useCurrentFrame();
  const placement = PROPS[id].placement;
  const tod: TimeOfDay = NIGHT.has(id) ? "night" : "day";
  const use = USE[id];
  const k = 0.37;
  const world = (child: React.ReactNode) => (
    <g transform={`translate(${w / 2} ${h - 56}) scale(${k}) translate(${-W / 2} ${-GROUND})`}>
      <InteriorContext.Provider value={false}>{child}</InteriorContext.Provider>
    </g>
  );

  let body: React.ReactNode;
  if (held) {
    const s = scene([{ id: "a", action: HOLD_ACTION[id] ?? "idle", expr: "happy", pos: "center" }], [{ id, attach: "a.hand_r" }]);
    body = world(<Stage scene={s} placed={placeAll(s, { a: LOOK }, frame, GROUND, true)} groundY={GROUND} horizonY={400} wallY={400} tod={tod} frame={frame} />);
  } else if (use) {
    const s = scene([{ id: "a", action: use.action, expr: "happy", pos: "center" }], [{ id, pos: "center" }, ...(use.extra ?? [])]);
    body = world(<Stage scene={s} placed={placeAll(s, { a: LOOK }, frame, GROUND, true)} groundY={GROUND} horizonY={400} wallY={400} tod={tod} frame={frame} />);
  } else {
    const trail = id === "footprints" || id === "small_footprints";
    const args = { x: trail ? W / 2 - 260 : W / 2, groundY: GROUND, horizonY: GROUND - 150, wallY: GROUND - 230, skyY: GROUND - 260, tod, frame, flip: false };
    // Backdrops cover only what the card shows (world coords inside the card's frame).
    const left = W / 2 - (w / 2 - 12) / k;
    const top = GROUND - (h - 70) / k;
    const box = (fill: string, y0 = top) => <rect x={left} y={y0} width={(w - 24) / k} height={GROUND - y0} fill={fill} />;
    const backdrop =
      placement === "wall" ? box(C.wall)
      : placement === "sky" ? box(C.skyDayBottom)
      : placement === "horizon" ? <g>{box(C.skyDayBottom)}{box(C.sea, GROUND - 150)}</g>
      : null;
    body = world(<g>{backdrop}{PROP_IMPL[id].placed?.(args)}</g>);
  }
  const sub = held ? (placement === "hand_or_ground" ? "hand or ground" : "held") : use ? `${placement} · in use` : placement;
  return <Cell x={x} y={y} w={w} h={h} title={id} sub={sub} dark={tod === "night"}>{body}</Cell>;
}

export function PropsGallery({ page }: { page: 0 | 1 }) {
  const ids = page === 0 ? HELD_IDS : PLACED_IDS;
  const cols = 6;
  const rows = Math.ceil(ids.length / cols);
  const w = W / cols;
  const h = H / rows;
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
        {ids.map((id, i) => (
          <PropCell key={id} id={id} held={page === 0} x={(i % cols) * w} y={Math.floor(i / cols) * h} w={w} h={h} />
        ))}
      </svg>
    </AbsoluteFill>
  );
}
