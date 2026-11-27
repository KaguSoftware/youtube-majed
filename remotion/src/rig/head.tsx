import type { BeardId, FaceFeatureId, HairId } from "@studio/schema";
import type { ReactNode } from "react";
import { INK, mix } from "../theme";
import { layout } from "./faces";
import type { Paint } from "./hats";

/**
 * Hair, beards and face features, in head space (head centre 0,0, radius 34,
 * facing right; the back of the head is -x). Hair has a part drawn behind the
 * head (long hair, buns, curls) and a part drawn over it (the top and fringe).
 */

/** Point on a circle: angle in degrees from +x, y down (so -90 is the top). */
const P = (r: number, deg: number) => `${(r * Math.cos((deg * Math.PI) / 180)).toFixed(1)} ${(r * Math.sin((deg * Math.PI) / 180)).toFixed(1)}`;

export type HairPaint = Paint & { hair: string };
const hairFill = (p: HairPaint) => (p.sil ? INK : p.neon ? p.dark : p.hair);
const S = (p: Paint) => ({ stroke: p.ink, strokeWidth: 3.6, strokeLinejoin: "round" as const });

/** The cap of hair over the top and back of the head. */
const cap = (front = -52, back = 172) => `M ${P(33, front)} A 38 38 0 0 0 ${P(36, back)} Q -26 -4 -18 -18 Q -2 -29 ${P(33, front)} Z`;

function spikes(): string {
  const pts: string[] = [];
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const a = -48 - (i / n) * 222;
    pts.push(P(i % 2 ? 46 : 36, a));
  }
  return `M ${P(33, -45)} L ${pts.join(" L ")} Q -26 -2 -18 -18 Q -2 -29 ${P(33, -45)} Z`;
}

export function HairBack({ hair, p, frame }: { hair: HairId; p: HairPaint; frame: number }): ReactNode {
  const fill = hairFill(p);
  const s = S(p);
  switch (hair) {
    case "long":
      return <path d={`M ${P(36, -70)} A 39 39 0 0 0 ${P(39, 175)} C -44 30, -46 56, -36 74 C -24 80, -12 76, -6 64 C -4 44, -2 20, 4 6 Z`} fill={fill} {...s} />;
    case "bob":
      return <path d={`M ${P(36, -70)} A 39 39 0 0 0 ${P(39, 175)} C -42 18, -40 32, -30 38 C -18 42, -8 38, -4 30 C -2 18, 0 8, 4 4 Z`} fill={fill} {...s} />;
    case "bun":
      return <circle cx={-30} cy={-30} r={14} fill={fill} {...s} />;
    case "ponytail": {
      const sway = Math.sin(frame / 7) * 8;
      return <path d={`M -28 -26 C -52 -30, ${-62 + sway} -4, ${-56 + sway} 34 C ${-50 + sway} 30, ${-44 + sway * 0.5} 4, -30 -12 Z`} fill={fill} {...s} />;
    }
    case "curly":
      return (
        <g fill={fill} {...s}>
          {Array.from({ length: 11 }, (_, i) => {
            const a = -40 - i * 23;
            return <circle key={i} cx={Math.cos((a * Math.PI) / 180) * 32} cy={Math.sin((a * Math.PI) / 180) * 32} r={16} />;
          })}
        </g>
      );
    default:
      return null;
  }
}

export function HairFront({ hair, p }: { hair: HairId; p: HairPaint }): ReactNode {
  const fill = hairFill(p);
  const s = S(p);
  switch (hair) {
    case "none":
      return null;
    case "messy":
      return <path d={spikes()} fill={fill} {...s} />;
    case "bob":
      return <path d={`M ${P(33, -30)} A 38 38 0 0 0 ${P(36, 172)} Q -26 -4 -18 -16 Q 4 -20 ${P(33, -30)} Z`} fill={fill} {...s} />;
    case "curly":
      return (
        <g fill={fill} {...s}>
          {[-60, -85, -110, -135].map((a) => (
            <circle key={a} cx={Math.cos((a * Math.PI) / 180) * 30} cy={Math.sin((a * Math.PI) / 180) * 30} r={13} />
          ))}
        </g>
      );
    default:
      return <path d={cap()} fill={fill} {...s} />;
  }
}

export function Beard({ beard, gaze, p }: { beard: BeardId; gaze: number; p: HairPaint }): ReactNode {
  const fill = hairFill(p);
  const off = 4 + gaze * 8;
  const o = off * 0.6;
  const { mx, my } = layout(gaze);
  switch (beard) {
    case "full":
      return (
        <path
          d={`M ${-24 + o} 4 C ${-26 + o} 30, ${-8 + o} 46, ${8 + o} 46 C ${26 + o} 44, ${34 + o} 26, ${30 + o} 2 C ${18 + o} 10, ${-12 + o} 12, ${-24 + o} 4 Z`}
          fill={fill}
          stroke={p.ink}
          strokeWidth={4}
          strokeLinejoin="round"
        />
      );
    case "stubble":
      return (
        <g>
          <path d={`M ${-22 + o} 6 C ${-20 + o} 26, ${-4 + o} 34, ${8 + o} 34 C ${22 + o} 33, ${30 + o} 22, ${29 + o} 6 C ${20 + o} 22, ${-6 + o} 24, ${-22 + o} 6 Z`} fill={p.sil ? INK : mix(p.hair, "#ffffff", 0.15)} opacity={p.sil ? 1 : 0.32} />
          {!p.sil && [[-8, 22], [0, 27], [9, 28], [17, 25], [23, 18], [-14, 15]].map(([x, y], i) => <circle key={i} cx={x! + o} cy={y} r={1.3} fill={p.hair} opacity={0.7} />)}
        </g>
      );
    case "moustache":
      return (
        <path
          d={`M ${mx - 12} ${my - 2} Q ${mx - 7} ${my - 10} ${mx} ${my - 6} Q ${mx + 7} ${my - 10} ${mx + 12} ${my - 2} Q ${mx + 6} ${my} ${mx} ${my - 3} Q ${mx - 6} ${my} ${mx - 12} ${my - 2} Z`}
          fill={fill}
          stroke={p.ink}
          strokeWidth={2.6}
          strokeLinejoin="round"
        />
      );
    case "goatee":
      return <path d={`M ${mx - 5} ${my + 9} L ${mx + 7} ${my + 9} L ${mx + 2} ${my + 22} Z`} fill={fill} stroke={p.ink} strokeWidth={2.6} strokeLinejoin="round" />;
    default:
      return null;
  }
}

export function FaceFeatures({ features, gaze, p }: { features: readonly FaceFeatureId[]; gaze: number; p: Paint }): ReactNode {
  if (p.sil || !features.length) return null;
  const { e1, e2, ey, mx, my } = layout(gaze);
  const ink = p.ink;
  return (
    <g>
      {features.map((f) => {
        switch (f) {
          case "glasses":
            return (
              <g key={f} fill="rgba(255,255,255,0.18)" stroke={ink} strokeWidth={2.8}>
                <circle cx={e1} cy={ey} r={7.6} />
                <circle cx={e2} cy={ey} r={7.6} />
                <path d={`M ${e1 + 7.6} ${ey} L ${e2 - 7.6} ${ey} M ${e1 - 7.6} ${ey - 1} L -24 -8`} fill="none" />
              </g>
            );
          case "sunglasses":
            return (
              <g key={f} stroke={ink} strokeWidth={2.6} strokeLinejoin="round">
                <path d={`M ${e1 - 8} ${ey - 6} L ${e1 + 7} ${ey - 6} L ${e1 + 6} ${ey + 3} Q ${e1} ${ey + 8} ${e1 - 7} ${ey + 3} Z`} fill={p.neon ? p.dark : "#1d1b29"} />
                <path d={`M ${e2 - 7} ${ey - 6} L ${e2 + 8} ${ey - 6} L ${e2 + 7} ${ey + 3} Q ${e2} ${ey + 8} ${e2 - 6} ${ey + 3} Z`} fill={p.neon ? p.dark : "#1d1b29"} />
                <path d={`M ${e1 + 7} ${ey - 5} L ${e2 - 7} ${ey - 5} M ${e1 - 8} ${ey - 5} L -24 -9`} fill="none" />
                {!p.neon && <path d={`M ${e1 - 4} ${ey - 3} l 3 0 M ${e2 - 3} ${ey - 3} l 3 0`} stroke="#ffffff" strokeWidth={2} opacity={0.7} />}
              </g>
            );
          case "lashes":
            return (
              <g key={f} stroke={ink} strokeWidth={2.4} strokeLinecap="round">
                <path d={`M ${e1 - 3} ${ey - 5} l -3 -4 M ${e1 + 1} ${ey - 6} l 0 -5`} />
                <path d={`M ${e2 + 3} ${ey - 5} l 3 -4 M ${e2 - 1} ${ey - 6} l 0 -5`} />
              </g>
            );
          case "freckles":
            return (
              <g key={f} fill={p.neon ? ink : "#c27a50"}>
                {[[-11, -6], [-7, -3], [-13, -1], [12, -7], [16, -4], [11, -2]].map(([dx, dy], i) => <circle key={i} cx={mx + dx!} cy={my + dy!} r={1.5} />)}
              </g>
            );
          case "blush":
            return (
              <g key={f} fill="#f2a0a8" opacity={0.75}>
                <ellipse cx={e1 - 4} cy={ey + 11} rx={5.5} ry={2.8} />
                <ellipse cx={e2 + 6} cy={ey + 11} rx={5} ry={2.8} />
              </g>
            );
          case "nose":
            return <path key={f} d={`M ${mx + 6} ${my - 14} q 7 4 1 8`} fill="none" stroke={ink} strokeWidth={3} strokeLinecap="round" />;
          case "eyepatch":
            return (
              <g key={f}>
                <path d={`M ${e2 - 4} ${ey - 6} L -26 -20 M ${e2 + 5} ${ey - 5} L 31 -14`} stroke={ink} strokeWidth={2.6} />
                <ellipse cx={e2} cy={ey} rx={7.5} ry={7} fill={p.neon ? p.dark : "#1d1b29"} stroke={ink} strokeWidth={2.4} />
              </g>
            );
          default:
            return null;
        }
      })}
    </g>
  );
}
