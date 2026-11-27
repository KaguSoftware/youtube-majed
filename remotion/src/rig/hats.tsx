import type { HatId } from "@studio/schema";
import type { ReactNode } from "react";
import { INK, mix } from "../theme";

/** Hats in head space (head centre 0,0, radius 34, facing right). */
const S = { stroke: INK, strokeWidth: 4, strokeLinejoin: "round" as const };

export const HATS: Record<HatId, (color: string, silhouette: boolean) => ReactNode> = {
  none: () => null,

  keeper_cap: (color, sil) => (
    <g>
      <path d="M -31 -22 C -33 -44, -20 -56, 0 -56 C 20 -56, 32 -46, 31 -22 Z" fill={sil ? INK : "#2c3a5c"} {...S} />
      {!sil && <path d="M -31 -30 L 31 -30 L 31 -22 L -31 -22 Z" fill={color} {...S} />}
      <path d="M 12 -24 C 24 -26, 40 -24, 47 -17 C 36 -14, 22 -15, 10 -18 Z" fill={INK} {...S} />
      {!sil && <circle cx={4} cy={-42} r={4} fill="#e8c35a" stroke={INK} strokeWidth={2.5} />}
    </g>
  ),

  beanie: (color, sil) => (
    <g>
      <circle cx={-2} cy={-50} r={9} fill={sil ? INK : mix(color, "#ffffff", 0.35)} {...S} />
      <path d="M -33 -12 C -36 -52, 34 -54, 33 -12 Z" fill={sil ? INK : color} {...S} />
      <path d="M -35 -20 L 35 -20 L 35 -8 L -35 -8 Z" fill={sil ? INK : mix(color, "#000000", 0.18)} {...S} rx={4} />
    </g>
  ),

  top_hat: (color, sil) => (
    <g>
      <path d="M -24 -30 L -22 -92 L 24 -92 L 26 -30 Z" fill={INK} {...S} />
      {!sil && <path d="M -23.5 -44 L 25.5 -44 L 25.8 -33 L -23.8 -33 Z" fill={color} />}
      <ellipse cx={2} cy={-29} rx={42} ry={6} fill={INK} {...S} />
    </g>
  ),
};

export function Beard({ offX, silhouette }: { offX: number; silhouette: boolean }) {
  const o = offX * 0.6;
  return (
    <path
      d={`M ${-24 + o} 4 C ${-26 + o} 30, ${-8 + o} 46, ${8 + o} 46 C ${26 + o} 44, ${34 + o} 26, ${30 + o} 2 C ${18 + o} 10, ${-12 + o} 12, ${-24 + o} 4 Z`}
      fill={silhouette ? INK : "#e9e5dd"}
      stroke={INK}
      strokeWidth={4}
      strokeLinejoin="round"
    />
  );
}
