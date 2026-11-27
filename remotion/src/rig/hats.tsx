import type { HatId } from "@studio/schema";
import type { ReactNode } from "react";
import { INK, mix } from "../theme";

/**
 * Hats in head space (head centre 0,0, radius 34, facing right). Colours go
 * through `paint`: real colours normally, a dark fill with glowing outlines
 * for neon, solid ink for silhouettes.
 */
export type Paint = { ink: string; dark: string; accent: string; sil: boolean; neon: boolean };

const fillOf = (p: Paint) => (color: string) => (p.sil ? INK : p.neon ? p.dark : color);

export const HATS: Record<HatId, (p: Paint) => ReactNode> = {
  none: () => null,

  keeper_cap: (p) => {
    const f = fillOf(p);
    const S = { stroke: p.ink, strokeWidth: 4, strokeLinejoin: "round" as const };
    return (
      <g>
        <path d="M -31 -22 C -33 -44, -20 -56, 0 -56 C 20 -56, 32 -46, 31 -22 Z" fill={f("#2c3a5c")} {...S} />
        {!p.sil && <path d="M -31 -30 L 31 -30 L 31 -22 L -31 -22 Z" fill={p.neon ? p.dark : p.accent} {...S} stroke={p.neon ? p.accent : p.ink} />}
        <path d="M 12 -24 C 24 -26, 40 -24, 47 -17 C 36 -14, 22 -15, 10 -18 Z" fill={f(p.dark)} {...S} />
        {!p.sil && <circle cx={4} cy={-42} r={4} fill="#e8c35a" stroke={p.ink} strokeWidth={2.5} />}
      </g>
    );
  },

  beanie: (p) => {
    const f = fillOf(p);
    const S = { stroke: p.ink, strokeWidth: 4, strokeLinejoin: "round" as const };
    return (
      <g>
        <circle cx={-2} cy={-50} r={9} fill={f(mix(p.accent, "#ffffff", 0.35))} {...S} />
        <path d="M -33 -12 C -36 -52, 34 -54, 33 -12 Z" fill={f(p.accent)} {...S} />
        <path d="M -35 -20 L 35 -20 L 35 -8 L -35 -8 Z" fill={f(mix(p.accent, "#000000", 0.18))} {...S} />
      </g>
    );
  },

  top_hat: (p) => {
    const S = { stroke: p.ink, strokeWidth: 4, strokeLinejoin: "round" as const };
    return (
      <g>
        <path d="M -24 -30 L -22 -92 L 24 -92 L 26 -30 Z" fill={p.dark} {...S} />
        {!p.sil && <path d="M -23.5 -44 L 25.5 -44 L 25.8 -33 L -23.8 -33 Z" fill={p.accent} />}
        <ellipse cx={2} cy={-29} rx={42} ry={6} fill={p.dark} {...S} />
      </g>
    );
  },

  baseball_cap: (p) => {
    const f = fillOf(p);
    const S = { stroke: p.ink, strokeWidth: 4, strokeLinejoin: "round" as const };
    return (
      <g>
        <path d="M -32 -18 C -34 -48, -14 -56, 2 -56 C 22 -56, 34 -42, 32 -18 Z" fill={f(p.accent)} {...S} />
        <path d="M 6 -54 L 8 -20 M -16 -50 L -22 -20" stroke={p.sil ? INK : mix(p.accent, "#000", 0.25)} strokeWidth={2.5} fill="none" />
        <path d="M 24 -22 C 38 -24, 52 -22, 58 -15 C 46 -11, 32 -12, 22 -16 Z" fill={f(mix(p.accent, "#000", 0.2))} {...S} />
        <circle cx={0} cy={-56} r={4} fill={f(mix(p.accent, "#000", 0.2))} {...S} strokeWidth={2.5} />
      </g>
    );
  },

  fedora: (p) => {
    const f = fillOf(p);
    const S = { stroke: p.ink, strokeWidth: 4, strokeLinejoin: "round" as const };
    return (
      <g>
        <path d="M -27 -26 C -30 -56, -14 -66, 0 -58 C 14 -66, 30 -56, 27 -26 Z" fill={f("#5a4a3e")} {...S} />
        {!p.sil && <path d="M -27.5 -36 L 27.5 -36 L 27 -27 L -27 -27 Z" fill={p.neon ? p.dark : mix(p.accent, "#000", 0.35)} />}
        <path d="M -50 -22 C -40 -32, 40 -32, 54 -24 C 44 -18, -40 -16, -50 -22 Z" fill={f("#4a3c32")} {...S} />
      </g>
    );
  },

  cowboy_hat: (p) => {
    const f = fillOf(p);
    const S = { stroke: p.ink, strokeWidth: 4, strokeLinejoin: "round" as const };
    return (
      <g>
        <path d="M -24 -28 C -28 -62, -12 -70, 0 -60 C 12 -70, 28 -62, 24 -28 Z" fill={f("#b98552")} {...S} />
        {!p.sil && <path d="M -25 -37 L 25 -37 L 24.5 -29 L -24.5 -29 Z" fill={p.neon ? p.dark : "#6b4426"} />}
        <path d="M -62 -40 C -54 -20, -30 -22, 0 -24 C 30 -22, 54 -20, 64 -40 C 58 -22, 36 -14, 0 -15 C -36 -14, -58 -22, -62 -40 Z" fill={f("#a8744a")} {...S} />
      </g>
    );
  },

  crown: (p) => {
    const f = fillOf(p);
    const S = { stroke: p.ink, strokeWidth: 4, strokeLinejoin: "round" as const };
    return (
      <g>
        <path d="M -26 -24 L -30 -64 L -14 -46 L 0 -70 L 14 -46 L 30 -64 L 26 -24 Z" fill={f("#f2c14e")} {...S} />
        {!p.sil && (
          <g stroke={p.ink} strokeWidth={2.5}>
            <circle cx={0} cy={-36} r={5.5} fill={p.neon ? p.dark : p.accent} />
            <circle cx={-15} cy={-33} r={3.5} fill={p.neon ? p.dark : "#e5484d"} />
            <circle cx={15} cy={-33} r={3.5} fill={p.neon ? p.dark : "#3f8fd2"} />
          </g>
        )}
      </g>
    );
  },

  hard_hat: (p) => {
    const f = fillOf(p);
    const S = { stroke: p.ink, strokeWidth: 4, strokeLinejoin: "round" as const };
    return (
      <g>
        <path d="M -32 -22 C -34 -54, 34 -56, 32 -22 Z" fill={f("#f5c518")} {...S} />
        <path d="M -4 -56 C -6 -44, -6 -32, -4 -22 L 6 -22 C 8 -32, 8 -44, 6 -56" fill={f("#e0ae0c")} {...S} strokeWidth={3} />
        <path d="M -40 -24 L 46 -24 C 48 -18, 46 -16, 40 -16 L -38 -16 C -42 -16, -43 -20, -40 -24 Z" fill={f("#e0ae0c")} {...S} />
      </g>
    );
  },

  chef_hat: (p) => {
    const f = fillOf(p);
    const S = { stroke: p.ink, strokeWidth: 4, strokeLinejoin: "round" as const };
    return (
      <g>
        <path d="M -24 -26 L -26 -54 C -44 -58, -40 -86, -18 -80 C -14 -100, 14 -100, 18 -80 C 40 -86, 44 -58, 26 -54 L 24 -26 Z" fill={f("#fbfbf6")} {...S} />
        <path d="M -24 -38 L 24 -38" stroke={p.ink} strokeWidth={3} />
      </g>
    );
  },

  police_cap: (p) => {
    const f = fillOf(p);
    const S = { stroke: p.ink, strokeWidth: 4, strokeLinejoin: "round" as const };
    return (
      <g>
        <path d="M -30 -24 L -34 -50 C -10 -62, 22 -60, 40 -50 L 30 -24 Z" fill={f("#24304f")} {...S} />
        <path d="M -30 -32 L 31 -32 L 30 -24 L -30 -24 Z" fill={f("#1b1f2e")} {...S} strokeWidth={3} />
        {!p.sil && <path d="M 4 -50 L 10 -44 L 4 -36 L -2 -44 Z" fill="#e8c35a" stroke={p.ink} strokeWidth={2} />}
        <path d="M 14 -26 C 26 -28, 40 -26, 46 -19 C 34 -16, 22 -17, 12 -20 Z" fill={f("#111")} {...S} />
      </g>
    );
  },

  beret: (p) => {
    const f = fillOf(p);
    const S = { stroke: p.ink, strokeWidth: 4, strokeLinejoin: "round" as const };
    return (
      <g>
        <path d="M -36 -26 C -46 -48, -8 -62, 22 -52 C 40 -46, 40 -34, 28 -26 C 10 -20, -20 -20, -36 -26 Z" fill={f(p.accent)} {...S} />
        <path d="M -2 -56 L 0 -64" stroke={p.ink} strokeWidth={4} strokeLinecap="round" />
      </g>
    );
  },
};
