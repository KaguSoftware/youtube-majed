import { ACTIONS, POSITIONS, PROPS, type CameraId, type CastMember, type OverlayId, type PositionId, type Scene } from "@studio/schema";
import { clamp, type Base } from "../library/camera";
import { PROP_IMPL } from "../library/props";
import { sizeOf } from "../rig/look";
import { W } from "../theme";
import { PORTRAIT } from "./view";

/**
 * The 9:16 re-layout of a scene (docs/PLAN.md section 9: "a re-layout, not a crop").
 *
 * A scene is written for a 1920×1080 stage with nine named positions across
 * it. A tall frame shows a slice of that stage about 600 to 900 px wide, so
 * three things change, and nothing in the scene JSON does:
 *
 * 1. **Spacing.** Characters (and the props that stand at a position) are
 *    pulled toward the middle of the stage, together, so a duo that stood
 *    900 px apart stands about 300 px apart: close enough to share the
 *    frame, far enough not to overlap (`MIN_GAP`). Order and facing are kept.
 * 2. **Framing.** The frame zooms to fit the group: a lone character fills
 *    the frame, a duo shares it, a crowd gets a wider shot. Medium shots are
 *    favoured: a scene written wide is framed at its tallest comfortable size,
 *    and a scene written `medium` is framed waist-up, large.
 * 3. **Where things sit.** The figures sit in the middle band of the frame,
 *    between the top and bottom UI (`SAFE_PORTRAIT`), with the captions below
 *    them. A group that travels is followed by the frame, since a walk across
 *    the whole stage is longer than the frame is wide.
 *
 * The camera moves (library/camera.tsx) then work from this base view, so a
 * push, a pan or a face zoom behaves in the tall frame as it does in the wide one.
 */

const MARGIN = 130; // world px kept clear on each side of the outermost character
const MIN_GAP = 280; // the closest two characters may stand, world px
const K_MIN = 0.5; // the most a spread is pulled in
const K_CROWD = 0.3; // ... and the most, for a crowd
const ZOOM_MIN = 1.2; // the window of this zoom is the whole drawn height of a background (stage + bleed)
const ZOOM_WIDE_SOLO = 1.95;
const ZOOM_WIDE = 1.95;
const ZOOM_MEDIUM = 2.4;
const ZOOM_EMPTY = 1.3;

/** Screen y (of 1920) where the feet of a full-length figure rest, and where the middle of a waist-up figure sits. */
const FEET_Y = 1140;
const MEDIUM_Y = 760;
/** Screen y a head may not rise above (the top UI). */
const HEAD_TOP_Y = 330;

/**
 * How much a camera move zooms in past the base view at its tightest (library/camera.tsx). The base is fitted to the
 * group's width with this much to spare, so a push or a pan never crops a character the frame was fitted to hold.
 * A face zoom is meant to crop, and a dolly out ends on the base.
 */
const MOVE_ZOOM: Record<CameraId, number> = { static: 1, slow_push: 1.15, shake: 1.07, zoom_face: 1, dolly_out: 1, pan_left: 1.2, pan_right: 1.2, whip_pan: 1.06, tilt_up: 1.3, handheld: 1.06, dutch_angle: 1.22 };

/**
 * Screen y a head may not rise above when the scene has this overlay: the overlay sits in the top of the frame
 * (library/overlays.tsx), so the figures are framed lower and a little smaller, and the two never meet.
 */
const OVERLAY_HEADROOM: Record<OverlayId, number> = { title_card: 500, counter: 480, lower_third: 420, map_pin: 620, time_card: 0 };

/** Half the width a prop takes on the stage, for the frame to hold: a bed, a car or a desk is far wider than a door or a calendar. */
const WIDE_PROP_REACH = 320;
const propReach = (id: keyof typeof PROPS): number => {
  const impl = PROP_IMPL[id];
  return impl.vehicle || impl.besideSeat || impl.front || impl.surface ? WIDE_PROP_REACH : MARGIN;
};

const onStage = (pos: PositionId) => POSITIONS[pos].x > 0 && POSITIONS[pos].x < 1;

export type PortraitLayout = {
  /** world x of a named position, after the pull toward the middle */
  xOf: (pos: PositionId) => number;
  /** 1 = positions as written, lower = pulled in */
  k: number;
  /** the group's middle on the stage (the frame is centred on it unless the group travels) */
  centreX: number;
  /** the frame follows the characters instead of resting on `centreX` */
  follow: boolean;
  /** where a following frame may go: the outermost positions of the group (a character entering from off screen does not drag it away) */
  reach: [number, number];
  /** a lone character is followed wherever it goes; a group is followed within `reach` */
  solo: boolean;
  /** the zoom that fits the group's width */
  fit: number;
  /** number of characters */
  n: number;
};

/** The positions a scene's framing has to hold, each with how far its occupant reaches to either side: characters (start and end) and the props standing at a position. */
function positionsOf(scene: Scene): Map<PositionId, number> {
  const solo = scene.chars.length === 1;
  const reach = new Map<PositionId, number>();
  const hold = (pos: PositionId, r: number) => reach.set(pos, Math.max(reach.get(pos) ?? 0, r));
  for (const c of scene.chars) {
    hold(c.pos, MARGIN);
    if (c.to && !solo) hold(c.to, MARGIN);
  }
  for (const p of scene.props) {
    const placement = PROPS[p.id].placement;
    if (p.pos && !p.attach && (placement === "ground" || placement === "hand_or_ground")) hold(p.pos, propReach(p.id));
  }
  for (const pos of [...reach.keys()]) if (!onStage(pos)) reach.delete(pos);
  return reach;
}

export function portraitLayout(scene: Scene): PortraitLayout {
  const held = positionsOf(scene);
  const xs = [...held.keys()].map((p) => POSITIONS[p].x * W).sort((a, b) => a - b);
  const spread0 = xs.length ? xs[xs.length - 1]! - xs[0]! : 0;
  const dmin = xs.reduce((m, x, i) => (i ? Math.min(m, x - xs[i - 1]!) : m), Infinity);
  // pulled in by half at most, but never so far that two neighbours stand closer than MIN_GAP ...
  const kPref = xs.length < 2 ? 1 : Math.min(1, Math.max(K_MIN, Number.isFinite(dmin) ? MIN_GAP / dmin : K_MIN));
  // ... unless the group would not fit the narrowest frame (a crowd): then it is pulled in until it does
  const kFit = spread0 > 0 ? Math.max(K_CROWD, (PORTRAIT.width / ZOOM_MIN - 2 * MARGIN) / spread0) : 1;
  const k = Math.min(kPref, kFit);
  const xOf = (pos: PositionId) => W / 2 + (POSITIONS[pos].x - 0.5) * W * k;
  const mapped = xs.map((x) => W / 2 + (x - W / 2) * k);
  // the frame must hold every occupant with its own reach: the group's left and right edges, not just its centres
  const reachOf = (x: number) => [...held].find(([pos]) => POSITIONS[pos].x * W === x)![1];
  const left = mapped.length ? Math.min(...mapped.map((m, i) => m - reachOf(xs[i]!))) : W / 2;
  const right = mapped.length ? Math.max(...mapped.map((m, i) => m + reachOf(xs[i]!))) : W / 2;
  const centreX = mapped.length ? (left + right) / 2 : W / 2;
  const fit = mapped.length ? PORTRAIT.width / (right - left) : 1;
  const follow = scene.chars.some((c) => ACTIONS[c.action].travels);
  const reach: [number, number] = mapped.length ? [mapped[0]!, mapped[mapped.length - 1]!] : [W / 2, W / 2];
  return { xOf, k, centreX, follow, reach, solo: scene.chars.length === 1, fit, n: scene.chars.length };
}

/** The view a scene rests in, before the camera move: zoom for the group, and a focal point that puts the figures in the middle band. */
export function portraitBase(scene: Scene, cast: Record<string, CastMember>, layout: PortraitLayout, placedX: number[], groundY: number): Base {
  const medium = scene.framing === "medium";
  const within = (v: number) => (layout.solo ? v : Math.min(layout.reach[1], Math.max(layout.reach[0], v)));
  const x = layout.follow && placedX.length ? placedX.reduce((s, v) => s + within(v), 0) / placedX.length : layout.centreX;
  if (!scene.chars.length) {
    const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_EMPTY, layout.fit));
    return { zoom, f: clamp({ x, y: groundY - (FEET_Y - PORTRAIT.height / 2) / zoom }, zoom, PORTRAIT) };
  }
  const headTop = Math.max(HEAD_TOP_Y, ...scene.overlays.map((o) => OVERLAY_HEADROOM[o.style]));
  const tallest = Math.max(...scene.chars.map((c) => sizeOf(cast[c.id]!) * 300 * cast[c.id]!.height));
  const topAbove = tallest + 70; // above the ground, hat included
  if (medium) {
    const hipAbove = Math.min(...scene.chars.map((c) => sizeOf(cast[c.id]!) * 185));
    const band = topAbove - hipAbove; // world px of waist-up
    const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MEDIUM, layout.fit / MOVE_ZOOM[scene.camera], (PORTRAIT.height - HEAD_TOP_Y - 480) / band));
    const mid = groundY - (topAbove + hipAbove) / 2;
    const midY = Math.max(MEDIUM_Y, headTop + (band / 2) * zoom); // the head stays under any overlay
    return { zoom, f: clamp({ x, y: mid - (midY - PORTRAIT.height / 2) / zoom }, zoom, PORTRAIT) };
  }
  const cap = layout.n === 1 ? ZOOM_WIDE_SOLO : ZOOM_WIDE;
  const zoom = Math.max(ZOOM_MIN, Math.min(cap, layout.fit / MOVE_ZOOM[scene.camera], (FEET_Y - headTop) / topAbove));
  return { zoom, f: clamp({ x, y: groundY - (FEET_Y - PORTRAIT.height / 2) / zoom }, zoom, PORTRAIT) };
}
