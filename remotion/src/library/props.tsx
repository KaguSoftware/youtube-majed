import type { AttachPointId, PropId } from "@studio/schema";
import type { ReactNode } from "react";
import type { Vec } from "../rig/skeleton";
import { ACCENT, C, INK, PAPER, mix, tone, type TimeOfDay } from "../theme";

/**
 * Props. Held props draw at a hand in the figure's own space; placed props
 * draw in world space at a position's x, on the ground, the horizon or the wall.
 * Props use the figure's ink outline (thinner) so they read as "things",
 * not scenery.
 */

export type HeldArgs = { at: Vec; swing: number; tod: TimeOfDay; frame: number; point: AttachPointId };
export type PlacedArgs = { x: number; groundY: number; horizonY: number; wallY: number; tod: TimeOfDay; frame: number; flip: boolean };

type PropImpl = {
  held?: (a: HeldArgs) => ReactNode;
  placed?: (a: PlacedArgs) => ReactNode;
  /** Drawn in front of characters (e.g. a blanket over someone in bed). */
  front?: (a: PlacedArgs) => ReactNode;
  /** Height of a surface a character standing at the same pos is lifted onto. */
  surface?: number;
};

const OUT = { stroke: INK, strokeWidth: 4, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

function Lantern({ tod, frame }: { tod: TimeOfDay; frame: number }) {
  const lit = tod !== "day";
  const flicker = lit ? 0.85 + Math.sin(frame * 1.3) * 0.08 + Math.sin(frame * 0.37) * 0.07 : 1;
  return (
    <g>
      <path d="M -9 12 C -9 -2, 9 -2, 9 12" fill="none" {...OUT} strokeWidth={3.5} />
      <path d="M -14 22 L 14 22 L 10 12 L -10 12 Z" fill="#3d4256" {...OUT} />
      <rect x={-15} y={22} width={30} height={36} rx={5} fill={lit ? ACCENT : "#fff3cf"} opacity={flicker} {...OUT} />
      <path d="M 0 30 C -4 38, -3 46, 0 48 C 3 46, 4 38, 0 30 Z" fill={lit ? "#ff9f43" : "#f2c46d"} />
      <path d="M -5 22 L -5 58 M 5 22 L 5 58" stroke={INK} strokeWidth={2.5} opacity={0.6} />
      <rect x={-17} y={57} width={34} height={8} rx={3} fill="#3d4256" {...OUT} />
    </g>
  );
}

function OilCan({ tod }: { tod: TimeOfDay }) {
  const t = (c: string) => tone(c, tod);
  return (
    <g>
      <path d="M -10 2 C -10 -10, 10 -10, 10 2" fill="none" {...OUT} strokeWidth={3.5} />
      <path d="M -22 8 L 22 8 L 24 58 L -24 58 Z" fill={t("#c0392b")} {...OUT} />
      <path d="M -22 22 L 23 22" stroke={t("#922b21")} strokeWidth={6} />
      <path d="M 14 10 L 40 -14 L 44 -10 L 22 16" fill={t("#a7a9ac")} {...OUT} strokeWidth={3} />
      <path d="M -10 34 L 10 34 M -10 44 L 6 44" stroke={t("#f6d6a8")} strokeWidth={3} strokeLinecap="round" />
    </g>
  );
}

function prints(x: number, y: number, flip: boolean, small: boolean, tod: TimeOfDay): ReactNode {
  const dir = flip ? -1 : 1;
  const fill = tod === "night" ? "#e4e9f7" : "#fffdf7";
  const stroke = mix(INK, "#9a96ad", 0.45);
  const n = small ? 8 : 6;
  const step = small ? 70 : 96;
  const s = small ? 0.68 : 1.15;
  return (
    <g>
      {Array.from({ length: n }, (_, i) => {
        const px = x + dir * i * step;
        const py = y + (i % 2 ? 16 : 40);
        return (
          <g key={i} transform={`translate(${px} ${py}) scale(${dir * s} ${s * 0.62})`}>
            {small ? (
              <g fill={fill} stroke={stroke} strokeWidth={3}>
                <path d="M -26 0 C -26 -14, 6 -18, 16 -10 C 24 -4, 24 6, 14 10 C 2 16, -26 14, -26 0 Z" />
                {[0, 1, 2, 3, 4].map((k) => <circle key={k} cx={26 + (k === 0 ? 2 : 0)} cy={-12 + k * 6} r={k === 0 ? 4.6 : 3.4} />)}
              </g>
            ) : (
              <g fill={fill} stroke={stroke} strokeWidth={3}>
                <path d="M -6 -14 L 28 -14 C 40 -14, 40 14, 28 14 L -6 14 Z" />
                <rect x={-34} y={-12} width={20} height={24} rx={7} />
                <path d="M 2 -6 L 24 -6 M 2 6 L 24 6" stroke={stroke} strokeWidth={2.5} opacity={0.6} />
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}

function BedBack({ x, groundY, tod, flip }: PlacedArgs) {
  const t = (c: string) => tone(c, tod);
  const d = flip ? -1 : 1;
  return (
    <g transform={`translate(${x} ${groundY}) scale(${d} 1)`}>
      <rect x={-200} y={-176} width={26} height={176} rx={6} fill={t(C.woodDark)} {...OUT} />
      <rect x={176} y={-112} width={24} height={112} rx={6} fill={t(C.woodDark)} {...OUT} />
      <rect x={-184} y={-70} width={372} height={42} rx={6} fill={t(C.wood)} {...OUT} />
      <rect x={-176} y={-98} width={356} height={30} rx={12} fill={t("#f3eee6")} {...OUT} />
      <rect x={-168} y={-122} width={92} height={32} rx={14} fill={t("#ffffff")} {...OUT} />
    </g>
  );
}

function BedFront({ x, groundY, tod, flip }: PlacedArgs) {
  const t = (c: string) => tone(c, tod);
  const d = flip ? -1 : 1;
  return (
    <g transform={`translate(${x} ${groundY}) scale(${d} 1)`}>
      <path d="M -70 -110 C -40 -122, 120 -122, 182 -104 L 186 -62 L -76 -62 Z" fill={t("#4f7cac")} {...OUT} />
      <path d="M -40 -100 L -40 -64 M 20 -110 L 20 -64 M 80 -112 L 80 -64 M 140 -108 L 140 -64" stroke={t("#3d6590")} strokeWidth={5} />
    </g>
  );
}

export const PROP_IMPL: Record<PropId, PropImpl> = {
  lantern: { held: ({ at, swing, tod, frame }) => <g transform={`translate(${at.x} ${at.y}) rotate(${swing})`}><Lantern tod={tod} frame={frame} /></g> },

  oil_can: {
    held: ({ at, swing, tod }) => <g transform={`translate(${at.x} ${at.y}) rotate(${swing * 0.6})`}><OilCan tod={tod} /></g>,
    placed: ({ x, groundY, tod, flip }) => <g transform={`translate(${x} ${groundY - 58}) scale(${flip ? -1 : 1} 1)`}><OilCan tod={tod} /></g>,
  },

  flour_sack: {
    placed: ({ x, groundY, tod }) => {
      const t = (c: string) => tone(c, tod);
      return (
        <g transform={`translate(${x} ${groundY})`}>
          <ellipse cx={58} cy={-4} rx={58} ry={9} fill={t("#ffffff")} opacity={0.9} />
          <path d="M -46 0 C -54 -60, -40 -100, -28 -112 L 28 -112 C 40 -100, 54 -60, 46 0 Z" fill={t("#e9dcc0")} {...OUT} />
          <path d="M -30 -112 C -20 -126, 20 -126, 30 -112" fill={t("#e9dcc0")} {...OUT} />
          <path d="M -26 -108 L 26 -108" stroke={t("#8a6d4a")} strokeWidth={5} />
          <text x={0} y={-48} textAnchor="middle" fontFamily="Fredoka, sans-serif" fontWeight={700} fontSize={22} fill={t("#8a6d4a")}>FLOUR</text>
        </g>
      );
    },
  },

  footprints: { placed: ({ x, groundY, flip, tod }) => prints(x, groundY, flip, false, tod) },
  small_footprints: { placed: ({ x, groundY, flip, tod }) => prints(x + (flip ? -30 : 30), groundY + 52, flip, true, tod) },

  bed: { placed: BedBack, front: BedFront, surface: 94 },

  ship: {
    placed: ({ x, horizonY, tod, frame }) => {
      const t = (c: string) => tone(c, tod);
      const bob = Math.sin(frame / 22) * 4;
      const roll = Math.sin(frame / 31) * 1.6;
      const lit = tod !== "day";
      return (
        <g transform={`translate(${x} ${horizonY + 6 + bob}) rotate(${roll}) scale(0.8)`}>
          <path d="M -150 -30 L 150 -30 L 120 12 L -130 12 Z" fill={t("#34495e")} />
          <path d="M -150 -30 L 150 -30 L 146 -20 L -146 -20 Z" fill={t(C.red)} />
          {[-110, -70, -30, 10].map((cx, i) => (
            <rect key={cx} x={cx} y={-62} width={36} height={32} fill={t(["#e67e22", "#2e86c1", "#27ae60", "#e67e22"][i]!)} />
          ))}
          <rect x={70} y={-84} width={50} height={54} fill={t("#ecf0f1")} />
          <rect x={92} y={-110} width={10} height={28} fill={t("#7f8c8d")} />
          {[78, 96].map((cx) => <rect key={cx} x={cx} y={-74} width={12} height={9} fill={lit ? ACCENT : t("#9ec6dd")} />)}
          {lit && <circle cx={97} cy={-112} r={4} fill="#ff6b6b" opacity={0.6 + 0.4 * Math.sin(frame / 6)} />}
        </g>
      );
    },
  },

  clock: {
    placed: ({ x, wallY, tod, frame }) => {
      const t = (c: string) => tone(c, tod);
      const minute = frame * 7.5;
      const hour = frame * 0.6 + 120;
      return (
        <g transform={`translate(${x} ${wallY})`}>
          <circle r={50} fill={t(C.woodDark)} {...OUT} />
          <circle r={40} fill={t(PAPER)} stroke={INK} strokeWidth={3} />
          {Array.from({ length: 12 }, (_, i) => (
            <path key={i} d="M 0 -34 L 0 -29" stroke={INK} strokeWidth={i % 3 ? 2.5 : 4} transform={`rotate(${i * 30})`} strokeLinecap="round" />
          ))}
          <path d="M 0 0 L 0 -20" stroke={INK} strokeWidth={5} strokeLinecap="round" transform={`rotate(${hour})`} />
          <path d="M 0 0 L 0 -31" stroke={C.red} strokeWidth={3.5} strokeLinecap="round" transform={`rotate(${minute})`} />
          <circle r={4} fill={INK} />
        </g>
      );
    },
  },
};

export const HELD: Partial<Record<PropId, (a: HeldArgs) => ReactNode>> = Object.fromEntries(
  Object.entries(PROP_IMPL).flatMap(([id, p]) => (p.held ? [[id, p.held]] : [])),
);
