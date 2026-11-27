import { ACTIONS, type ActionId, type ExpressionId, type PropInScene, type Scene } from "@studio/schema";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { ACTION_LIB } from "../library/actions";
import { InteriorContext } from "../library/prop-kit";
import { Stage, placeAll } from "../scene/SceneView";
import { H, PAPER, W } from "../theme";
import { CAST_ENTRIES } from "./CastGallery";
import { Cell, cast } from "./kit";

/**
 * Every action, 20 to a page, each on a different cast member (so builds and
 * outfits get exercised too), with the prop or seat it is meant to be used with.
 * Travelling actions cycle on the spot here; the Travel gallery shows them moving.
 */

const GROUND = 880;
export const ACTION_IDS = Object.keys(ACTIONS) as ActionId[];
export const ACTIONS_PER_PAGE = 20;
export const ACTION_PAGES = Math.ceil(ACTION_IDS.length / ACTIONS_PER_PAGE);

const FACE: Partial<Record<ActionId, ExpressionId>> = {
  panic: "fear", celebrate: "happy", argue: "angry", gasp: "shock", cower: "fear", tremble: "fear", rage: "angry", plead: "sad",
  sigh: "sad", dance: "happy", wave: "happy", clap: "happy", fist_pump: "determined", double_take: "shock", present: "happy",
  shout: "angry", whisper: "smirk", listen: "suspicious", scratch_head: "confused", tap_foot: "deadpan", cross_arms: "deadpan",
  hands_on_hips: "determined", trudge: "sad", march: "determined", skip: "happy", flee: "fear", punch: "angry", kick: "angry",
  fists_up: "determined", dodge: "shock", stumble: "shock", push: "determined", pull: "determined", lift: "determined",
  kneel: "in_love", yawn: "sleepy", drive: "happy", peek: "suspicious", head_shake: "deadpan", nod: "happy", text_phone: "smirk",
  faint: "shock", stop_hand: "angry", beckon: "smirk",
};

const PROPS: Partial<Record<ActionId, PropInScene[]>> = {
  walk: [{ id: "lantern", attach: "a.hand_r" }],
  phone_call: [{ id: "phone", attach: "a.hand_r" }],
  text_phone: [{ id: "phone", attach: "a.hand_r" }],
  read: [{ id: "book", attach: "a.hand_r" }],
  eat: [{ id: "food", attach: "a.hand_r" }],
  drink: [{ id: "mug", attach: "a.hand_r" }],
  carry: [{ id: "box", attach: "a.hand_r" }],
  lift: [{ id: "box", attach: "a.hand_r" }],
  knock: [{ id: "door", pos: "center_right" }],
  peek: [{ id: "door", pos: "center_right" }],
  climb: [{ id: "ladder", pos: "center" }],
  sit_chair: [{ id: "chair", pos: "center" }],
  sit_edge: [{ id: "rock", pos: "center" }],
  type: [{ id: "chair", pos: "center" }, { id: "desk", pos: "center" }],
  drive: [{ id: "car", pos: "center" }],
  present: [{ id: "gift", pos: "center_right" }],
};

/** Scene for one action cell. */
export function actionScene(id: ActionId): Scene {
  return {
    id: "S1", lineIds: ["L1.1"], bg: "street", grade: "day", camera: "static", transitionIn: "cut", caption: "none", sfx: [], overlays: [],
    chars: [{ id: "a", action: id, expr: FACE[id] ?? "neutral", pos: "center" }],
    props: PROPS[id] ?? [],
  };
}

function ActionCell({ id, i, x, y, w, h }: { id: ActionId; i: number; x: number; y: number; w: number; h: number }) {
  const frame = useCurrentFrame();
  const def = ACTION_LIB[id];
  const f = def.loop ? frame : frame % (def.frames + 45);
  const scene = actionScene(id);
  const look = CAST_ENTRIES[i % CAST_ENTRIES.length]!.look;
  const placed = placeAll(scene, { a: cast({ ...look, scale: Math.max(0.85, look.scale ?? 1) }) }, f, GROUND, true);
  const k = 0.37;
  const needs = (ACTIONS[id] as { needs?: string }).needs;
  return (
    <Cell x={x} y={y} w={w} h={h} title={id} sub={ACTIONS[id].travels ? "travels" : needs ? `needs a ${needs}` : ACTIONS[id].kind}>
      <g transform={`translate(${w / 2} ${h - 56}) scale(${k}) translate(${-W / 2} ${-GROUND})`}>
        <InteriorContext.Provider value={false}>
          <Stage scene={scene} placed={placed} groundY={GROUND} horizonY={400} wallY={400} tod="day" frame={frame} />
        </InteriorContext.Provider>
      </g>
    </Cell>
  );
}

export function ActionsGallery({ page }: { page: number }) {
  const ids = ACTION_IDS.slice(page * ACTIONS_PER_PAGE, (page + 1) * ACTIONS_PER_PAGE);
  const cols = 5;
  const w = W / cols;
  const h = H / 4;
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
        {ids.map((id, j) => (
          <ActionCell key={id} id={id} i={page * ACTIONS_PER_PAGE + j} x={(j % cols) * w} y={Math.floor(j / cols) * h} w={w} h={h} />
        ))}
      </svg>
    </AbsoluteFill>
  );
}
