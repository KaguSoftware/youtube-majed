import type { CastMember, HairId, HatId, OutfitId } from "@studio/schema";
import type { ReactNode } from "react";
import * as THREE from "three";
import { INK, PAPER } from "../theme";
import { G, M, blend, mat, shade } from "./kit";
import type { Dims } from "./rig3d";
import { RAD } from "./world";

/**
 * Cast looks in low poly: the same cast entry as the stick figure, mapped
 * onto the 3D figure. The accent colour is the shirt (and hat bands), the
 * line colour the trousers and shoes, the fill colour the skin (paper by
 * default, as the stick figure's head). Hats, hair and the full beard are
 * shapes on the head; the lighter beards and face features are drawn on the
 * face texture (face.ts). Every id in the catalogue has a version here:
 * TypeScript checks the Records.
 */

export type Look3D = {
  shirt: string;
  legs: string;
  shoes: string;
  skin: string;
  hair: string;
  accent: string;
  /** dark parts of hats */
  dark: string;
  /** face line colour */
  ink: string;
  neon: boolean;
  silhouette: boolean;
};

const SIL = "#14121c";
const NEON_BODY = "#1b1730";

export function look3d(cast: CastMember, silhouette: boolean): Look3D {
  if (silhouette) return { shirt: SIL, legs: SIL, shoes: SIL, skin: SIL, hair: SIL, accent: SIL, dark: SIL, ink: SIL, neon: false, silhouette: true };
  const ink = cast.line ?? INK;
  if (cast.style === "neon") {
    const glow = cast.line ?? cast.color;
    return { shirt: NEON_BODY, legs: NEON_BODY, shoes: "#0e0c18", skin: cast.fill ?? "#221d3a", hair: cast.hairColor, accent: glow, dark: "#0e0c18", ink: glow, neon: true, silhouette: false };
  }
  // a black accent (mystery figures) would read as a hole: lift it to charcoal
  const shirt = cast.color.toLowerCase() === "#000000" ? "#2a2833" : cast.color;
  return { shirt, legs: blend(ink, "#3b3f58", 0.25), shoes: shade(ink, 0.7), skin: cast.fill ?? PAPER, hair: cast.hairColor, accent: shirt, dark: blend(ink, "#2a2d3e", 0.3), ink, neon: false, silhouette: false };
}

/** The body's material in a look colour: neon parts glow in the accent. */
export function bodyMat(l: Look3D, color: string, glowing = false) {
  if (l.neon && glowing) return mat(l.accent, { glow: 1.6, rough: 0.5 });
  return mat(color, { rough: l.silhouette ? 1 : 0.82 });
}

type HeadProps = { l: Look3D; d: Dims; frame: number; speed: number };

/** A hemisphere-ish cap over the top of the head: the base of most hats and hair. */
function cap(r: number, thetaLen: number, m: THREE.Material, y = 0, sx = 1) {
  return <M g={G.sphere(r, 9, 5, 0, Math.PI * 2, 0, thetaLen)} m={m} p={[0, y, 0]} s={[sx, 1, sx]} />;
}

const HATS3D: Record<HatId, (p: HeadProps) => ReactNode> = {
  none: () => null,
  keeper_cap: ({ l, d }) => {
    const R = d.headR;
    const top = bodyMat(l, l.dark);
    return (
      <group position={[0, R * 0.62, 0]}>
        <M g={G.cyl(R * 1.02, R * 0.96, R * 0.42, 9)} m={top} p={[0, R * 0.12, 0]} />
        <M g={G.cyl(R * 0.99, R * 0.99, R * 0.16, 9)} m={bodyMat(l, l.accent, true)} p={[0, -0.02 * R, 0]} />
        <M g={G.box(R * 1.3, R * 0.07, R * 0.7)} m={top} p={[0, -R * 0.1, R * 0.82]} r={[0.18, 0, 0]} />
        <M g={G.box(R * 0.22, R * 0.16, R * 0.04)} m={mat("#e8c45a", { metal: 0.6, rough: 0.4 })} p={[0, R * 0.14, R * 0.98]} />
      </group>
    );
  },
  beanie: ({ l, d }) => {
    const R = d.headR;
    return (
      <group position={[0, R * 0.18, 0]}>
        {cap(R * 1.07, 1.55, bodyMat(l, l.accent, true), 0)}
        <M g={G.cyl(R * 1.08, R * 1.1, R * 0.26, 10)} m={bodyMat(l, shade(l.accent, 0.82), true)} p={[0, R * 0.05, 0]} />
        <M g={G.ico(R * 0.27, 0)} m={bodyMat(l, "#f2ede4")} p={[0, R * 1.12, 0]} />
      </group>
    );
  },
  top_hat: ({ l, d }) => {
    const R = d.headR;
    const m = bodyMat(l, l.dark);
    return (
      <group position={[0, R * 0.72, 0]}>
        <M g={G.cyl(R * 1.45, R * 1.45, R * 0.07, 12)} m={m} />
        <M g={G.cyl(R * 0.8, R * 0.74, R * 1.35, 9)} m={m} p={[0, R * 0.7, 0]} />
        <M g={G.cyl(R * 0.77, R * 0.76, R * 0.24, 9)} m={bodyMat(l, l.accent, true)} p={[0, R * 0.17, 0]} />
      </group>
    );
  },
  baseball_cap: ({ l, d }) => {
    const R = d.headR;
    const m = bodyMat(l, l.accent, true);
    return (
      <group position={[0, R * 0.2, 0]}>
        {cap(R * 1.06, 1.25, m)}
        <M g={G.box(R * 1.2, R * 0.07, R * 0.95)} m={bodyMat(l, shade(l.accent, 0.8), true)} p={[0, R * 0.3, R * 0.98]} r={[0.12, 0, 0]} />
        <M g={G.ico(R * 0.1, 0)} m={m} p={[0, R * 1.06, 0]} />
      </group>
    );
  },
  fedora: ({ l, d }) => {
    const R = d.headR;
    const felt = bodyMat(l, l.silhouette ? l.dark : "#4a3f3a");
    return (
      <group position={[0, R * 0.66, 0]} rotation={[-0.06, 0, 0]}>
        <M g={G.cyl(R * 1.62, R * 1.62, R * 0.07, 12)} m={felt} />
        <M g={G.cyl(R * 0.72, R * 0.92, R * 0.72, 8)} m={felt} p={[0, R * 0.38, 0]} />
        <M g={G.box(R * 0.5, R * 0.14, R * 0.9)} m={felt} p={[0, R * 0.74, 0]} />
        <M g={G.cyl(R * 0.93, R * 0.93, R * 0.18, 8)} m={bodyMat(l, l.accent, true)} p={[0, R * 0.1, 0]} />
      </group>
    );
  },
  cowboy_hat: ({ l, d }) => {
    const R = d.headR;
    const leather = bodyMat(l, l.silhouette ? l.dark : "#9a6a3e");
    return (
      <group position={[0, R * 0.64, 0]}>
        <M g={G.cyl(R * 1.7, R * 1.7, R * 0.07, 12)} m={leather} s={[1, 1, 0.82]} />
        {[-1, 1].map((s) => (
          <M key={s} g={G.box(R * 0.5, R * 0.07, R * 2.6)} m={leather} p={[s * R * 1.5, R * 0.2, 0]} r={[0, 0, s * 0.55]} />
        ))}
        <M g={G.cyl(R * 0.72, R * 0.9, R * 0.85, 8)} m={leather} p={[0, R * 0.45, 0]} />
        <M g={G.cyl(R * 0.91, R * 0.91, R * 0.16, 8)} m={bodyMat(l, shade(l.accent, 0.8), true)} p={[0, R * 0.12, 0]} />
      </group>
    );
  },
  crown: ({ l, d }) => {
    const R = d.headR;
    const gold = l.silhouette ? bodyMat(l, l.dark) : mat("#f0c040", { metal: 0.7, rough: 0.35 });
    return (
      <group position={[0, R * 0.7, 0]}>
        <M g={G.cyl(R * 0.88, R * 0.82, R * 0.36, 10, true)} m={gold} p={[0, R * 0.1, 0]} />
        {Array.from({ length: 5 }, (_, i) => {
          const a = (i / 5) * Math.PI * 2;
          return <M key={i} g={G.cone(R * 0.16, R * 0.42, 4)} m={gold} p={[Math.sin(a) * R * 0.84, R * 0.45, Math.cos(a) * R * 0.84]} />;
        })}
        {!l.silhouette && <M g={G.ico(R * 0.11, 0)} m={mat("#d0303d", { glow: 0.2, rough: 0.3 })} p={[0, R * 0.12, R * 0.88]} />}
      </group>
    );
  },
  hard_hat: ({ l, d }) => {
    const R = d.headR;
    const y = bodyMat(l, l.silhouette ? l.dark : "#f2c230");
    return (
      <group position={[0, R * 0.28, 0]}>
        {cap(R * 1.1, 1.45, y)}
        <M g={G.cyl(R * 1.3, R * 1.32, R * 0.07, 12)} m={y} p={[0, R * 0.1, R * 0.08]} />
        <M g={G.box(R * 0.16, R * 0.1, R * 1.1)} m={y} p={[0, R * 1.06, 0]} />
      </group>
    );
  },
  chef_hat: ({ l, d }) => {
    const R = d.headR;
    const w = bodyMat(l, l.silhouette ? l.dark : "#f7f4ee");
    return (
      <group position={[0, R * 0.62, 0]}>
        <M g={G.cyl(R * 0.92, R * 0.95, R * 0.55, 9)} m={w} p={[0, R * 0.2, 0]} />
        <M g={G.ico(R * 0.85, 1)} m={w} p={[0, R * 1.05, 0]} s={[1.15, 0.85, 1.15]} />
      </group>
    );
  },
  police_cap: ({ l, d }) => {
    const R = d.headR;
    const navy = bodyMat(l, l.silhouette ? l.dark : "#24305a");
    return (
      <group position={[0, R * 0.62, 0]}>
        <M g={G.cyl(R * 1.18, R * 0.96, R * 0.42, 10)} m={navy} p={[0, R * 0.16, 0]} />
        <M g={G.cyl(R * 0.98, R * 0.98, R * 0.14, 10)} m={bodyMat(l, "#141a30")} p={[0, -R * 0.02, 0]} />
        <M g={G.box(R * 1.3, R * 0.07, R * 0.68)} m={bodyMat(l, "#11131c")} p={[0, -R * 0.08, R * 0.84]} r={[0.2, 0, 0]} />
        {!l.silhouette && <M g={G.ico(R * 0.14, 0)} m={mat("#e8c45a", { metal: 0.7, rough: 0.35 })} p={[0, R * 0.2, R * 1.05]} s={[1, 1, 0.4]} />}
      </group>
    );
  },
  beret: ({ l, d }) => {
    const R = d.headR;
    return (
      <group position={[R * 0.12, R * 0.72, 0]} rotation={[0, 0, -0.32]}>
        <M g={G.ico(R * 1.05, 1)} m={bodyMat(l, l.accent, true)} s={[1.12, 0.32, 1.1]} />
        <M g={G.cyl(R * 0.04, R * 0.06, R * 0.2, 5)} m={bodyMat(l, shade(l.accent, 0.7), true)} p={[0, R * 0.38, 0]} />
      </group>
    );
  },
};

const HAIR3D: Record<HairId, (p: HeadProps) => ReactNode> = {
  none: () => null,
  short: ({ l, d }) => {
    const R = d.headR;
    const m = bodyMat(l, l.hair);
    return (
      <group>
        {cap(R * 1.06, 0.95, m, R * 0.02)}
        <M g={G.sphere(R * 1.05, 9, 6, Math.PI * 1.05, Math.PI * 0.9, 0.3, 1.6)} m={m} />
      </group>
    );
  },
  messy: ({ l, d }) => {
    const R = d.headR;
    const m = bodyMat(l, l.hair);
    return (
      <group>
        {cap(R * 1.07, 1.0, m, R * 0.02)}
        <M g={G.sphere(R * 1.06, 9, 6, Math.PI * 1.05, Math.PI * 0.9, 0.3, 1.6)} m={m} />
        {[[0, 1, 0.3], [0.5, 0.88, 0.1], [-0.5, 0.9, 0.05], [0.25, 0.92, -0.45], [-0.3, 0.86, -0.5], [0.05, 0.95, 0.65]].map(([x, y, z], i) => (
          <M key={i} g={G.cone(R * 0.24, R * 0.55, 4)} m={m} p={[x! * R, y! * R, z! * R]} r={[z! * 0.9, i * 0.7, -x! * 0.9]} />
        ))}
      </group>
    );
  },
  long: ({ l, d }) => {
    const R = d.headR;
    const m = bodyMat(l, l.hair);
    return (
      <group>
        {cap(R * 1.07, 1.0, m, R * 0.02)}
        <M g={G.sphere(R * 1.07, 9, 6, Math.PI * 0.95, Math.PI * 1.1, 0.3, 1.9)} m={m} />
        <M g={G.ico(R * 1.0, 1)} m={m} p={[0, -R * 0.75, -R * 0.42]} s={[1.02, 1.35, 0.55]} r={[-0.15, 0, 0]} />
      </group>
    );
  },
  bob: ({ l, d }) => {
    const R = d.headR;
    const m = bodyMat(l, l.hair);
    return (
      <group>
        {cap(R * 1.09, 1.05, m, R * 0.02)}
        <M g={G.sphere(R * 1.1, 10, 6, Math.PI * 0.82, Math.PI * 1.36, 0.25, 2.0)} m={m} />
        <M g={G.box(R * 1.4, R * 0.28, R * 0.3)} m={m} p={[0, R * 0.72, R * 0.72]} r={[0.5, 0, 0]} />
      </group>
    );
  },
  bun: ({ l, d }) => {
    const R = d.headR;
    const m = bodyMat(l, l.hair);
    return (
      <group>
        {cap(R * 1.06, 0.95, m, R * 0.02)}
        <M g={G.sphere(R * 1.05, 9, 6, Math.PI * 1.0, Math.PI * 1.0, 0.3, 1.7)} m={m} />
        <M g={G.ico(R * 0.48, 1)} m={m} p={[0, R * 0.95, -R * 0.45]} />
      </group>
    );
  },
  ponytail: ({ l, d, frame, speed }) => {
    const R = d.headR;
    const m = bodyMat(l, l.hair);
    const swing = Math.sin(frame / 6) * 0.18 + Math.min(0.6, speed * 0.25);
    return (
      <group>
        {cap(R * 1.06, 0.95, m, R * 0.02)}
        <M g={G.sphere(R * 1.05, 9, 6, Math.PI * 1.0, Math.PI * 1.0, 0.3, 1.7)} m={m} />
        <group position={[0, R * 0.55, -R * 0.95]} rotation={[0.5 + swing, 0, Math.sin(frame / 7) * 0.12]}>
          <M g={G.cone(R * 0.3, R * 1.5, 6)} m={m} p={[0, -R * 0.75, 0]} r={[Math.PI, 0, 0]} />
        </group>
      </group>
    );
  },
  curly: ({ l, d }) => {
    const R = d.headR;
    const m = bodyMat(l, l.hair);
    const puffs: [number, number, number][] = [];
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      const up = i % 2 ? 0.55 : 0.8;
      if (Math.cos(a) > 0.55 && up < 0.7) continue; // keep the face clear
      puffs.push([Math.sin(a) * R * 0.92, R * up, Math.cos(a) * R * 0.85 - R * 0.1]);
    }
    return (
      <group>
        {cap(R * 1.08, 1.0, m, R * 0.05)}
        {puffs.map((p, i) => (
          <M key={i} g={G.ico(R * 0.42, 0)} m={m} p={p} />
        ))}
      </group>
    );
  },
};

/** The full beard as a shape on the chin; the others are drawn on the face (face.ts). */
export function Beard3D({ l, d, cast }: HeadProps & { cast: CastMember }) {
  if (cast.beard !== "full") return null;
  const R = d.headR;
  return <M g={G.ico(R * 0.62, 1)} m={bodyMat(l, l.hair)} p={[0, -R * 0.78, R * 0.42]} s={[1.25, 1.05, 0.9]} />;
}

export function Hat3D(p: HeadProps & { hat: HatId }) {
  return <>{HATS3D[p.hat](p)}</>;
}

export function Hair3D(p: HeadProps & { hair: HairId; hat: HatId }) {
  // under a tall hat only what hangs below it shows; the cap would poke through brims
  if (p.hair === "none") return null;
  return <>{HAIR3D[p.hair](p)}</>;
}

type OutfitProps = { l: Look3D; d: Dims; frame: number; speed: number; legAngle: number };

/** Outfits in the chest's space (origin at the hip, up the spine). */
export const OUTFITS3D: Record<OutfitId, (p: OutfitProps) => ReactNode> = {
  none: () => null,
  tie: ({ l, d }) => {
    const c = l.neon ? l.accent : blend(l.accent, "#1d1b29", 0.45);
    const m = bodyMat(l, c, true);
    return (
      <group position={[0, d.torso * 0.62, d.chestR * 0.72]} rotation={[0.08, 0, 0]}>
        <M g={G.box(d.chestR * 0.26, d.torso * 0.45, 0.02)} m={m} />
        <M g={G.box(d.chestR * 0.3, d.chestR * 0.24, 0.03)} m={m} p={[0, d.torso * 0.24, 0.005]} />
      </group>
    );
  },
  scarf: ({ l, d, frame, speed }) => {
    const m = bodyMat(l, blend(l.accent, "#ffffff", 0.25), true);
    const flap = Math.sin(frame / 5) * 0.15 + Math.min(1, speed * 0.4);
    return (
      <group position={[0, d.torso * 0.96, 0]}>
        <M g={G.torus(d.chestR * 0.55, d.limbR * 0.9, 4, 9)} m={m} r={[Math.PI / 2, 0, 0]} s={[1, 0.8, 1]} />
        <group position={[d.chestR * 0.2, -0.02, -d.chestR * 0.4]} rotation={[-0.3 - flap, 0, 0]}>
          <M g={G.box(d.limbR * 1.6, d.torso * 0.45, 0.025)} m={m} p={[0, -d.torso * 0.22, 0]} />
        </group>
      </group>
    );
  },
  dress: ({ l, d, legAngle }) => {
    const m = bodyMat(l, l.accent, true);
    return (
      <group position={[0, d.torso * 0.12, 0]} rotation={[legAngle * 0.35 * RAD, 0, 0]}>
        <M g={G.cyl(d.waistR * 1.05, d.waistR * 2.1, d.thigh * 1.15, 9, true)} m={m} p={[0, -d.thigh * 0.5, 0]} />
      </group>
    );
  },
  cape: ({ l, d, frame, speed }) => {
    const m = bodyMat(l, shade(l.accent, 0.75), true);
    const blow = Math.min(0.9, 0.12 + speed * 0.35) + Math.sin(frame / 6) * 0.05;
    const len = d.torso + d.thigh * 0.9;
    return (
      <group position={[0, d.torso * 0.98, -d.chestR * 0.75]} rotation={[-blow, 0, 0]}>
        <M g={G.box(d.chestR * 2.3, len, 0.03)} m={m} p={[0, -len / 2, 0]} />
      </group>
    );
  },
  backpack: ({ l, d }) => {
    const m = bodyMat(l, l.neon ? l.accent : blend(l.accent, "#5a4a3a", 0.55), true);
    return (
      <group position={[0, d.torso * 0.58, -d.chestR * 0.85]}>
        <M g={G.box(d.chestR * 1.5, d.torso * 0.55, d.chestR * 0.8)} m={m} />
        <M g={G.box(d.chestR * 1.2, d.torso * 0.2, d.chestR * 0.3)} m={m} p={[0, -d.torso * 0.1, -d.chestR * 0.5]} />
      </group>
    );
  },
};
