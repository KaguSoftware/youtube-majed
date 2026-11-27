import type { CastMember, ExpressionId } from "@studio/schema";
import type { ReactNode } from "react";
import * as THREE from "three";
import { faceTexture, SPAN } from "./face";
import { G, M, blend, mat, shade } from "./kit";
import { Beard3D, Hair3D, Hat3D, OUTFITS3D, bodyMat, type Look3D } from "./looks3d";
import type { Dims, Rig } from "./rig3d";

/**
 * One low-poly character. The bone hierarchy follows Mixamo's (Hips → Spine →
 * Neck → Head, Spine → Right/LeftArm → ForeArm → Hand, Hips → Right/LeftUpLeg
 * → Leg → Foot); each bone carries a few flat-shaded shapes. The pose comes
 * from rig3d.ts, the look from looks3d.ts, the face from face.ts.
 */

const faceGeos = new Map<number, THREE.BufferGeometry>();
/** The face decal: the front of a sphere just outside the head, with the face texture projected flat onto it. */
function faceGeo(R: number): THREE.BufferGeometry {
  const key = Math.round(R * 1e4);
  let g = faceGeos.get(key);
  if (g) return g;
  const r = R * 1.045;
  g = new THREE.SphereGeometry(r, 20, 14, Math.PI * 0.5 - 1.25, 2.5, 0.42, 2.2);
  const pos = g.attributes.position!;
  const uv = g.attributes.uv!;
  // features 15% larger than the stick face, relative to the head
  const span = (R * SPAN * 1.15) / 34;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, 0.5 + pos.getX(i) / (2 * span), 0.5 + pos.getY(i) / (2 * span));
  faceGeos.set(key, g);
  return g;
}

const faceMats = new WeakMap<THREE.Texture, THREE.Material>();
function faceMat(tex: THREE.Texture, neon: boolean): THREE.Material {
  let m = faceMats.get(tex);
  if (!m) {
    const o = { map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 };
    m = neon ? new THREE.MeshBasicMaterial(o) : new THREE.MeshStandardMaterial({ ...o, roughness: 0.9 });
    faceMats.set(tex, m);
  }
  return m;
}

/** A limb segment: a few-sided tapered prism hanging down from its joint. */
function Segment({ len, r0, r1, m }: { len: number; r0: number; r1: number; m: THREE.Material }) {
  return <M g={G.cyl(r0, r1, len, 6)} m={m} p={[0, -len / 2, 0]} />;
}

type Props = {
  rig: Rig;
  cast: CastMember;
  look: Look3D;
  expr: ExpressionId;
  blink: number;
  frame: number;
  /** m/s, for capes, scarves and ponytails */
  speed: number;
};

export function Figure3D({ rig, cast, look: l, expr, blink, frame, speed }: Props) {
  const d: Dims = rig.dims;
  const R = d.headR;
  const shirt = bodyMat(l, l.shirt, true);
  const sleeve = bodyMat(l, shade(l.shirt, 0.92), true);
  const legs = bodyMat(l, l.legs);
  const shoes = bodyMat(l, l.shoes);
  const skin = l.neon ? mat(l.skin, { rough: 0.6 }) : bodyMat(l, l.skin);
  const lr = d.limbR;

  const arm = (a: Rig["armF"], key: string) => (
    <group key={key} position={[a.side * d.shoulderW, d.torso - d.shoulderDrop + rig.shoulderLift, 0]} rotation={a.upper}>
      <M g={G.ico(lr * 1.35, 0)} m={shirt} />
      <Segment len={d.upperArm} r0={lr * 1.2} r1={lr * 1.0} m={sleeve} />
      <group position={[0, -d.upperArm, 0]} rotation={a.fore}>
        <M g={G.ico(lr * 1.05, 0)} m={sleeve} />
        <Segment len={d.foreArm * 0.92} r0={lr} r1={lr * 0.85} m={sleeve} />
        <M g={G.ico(lr * 1.4, 0)} m={skin} p={[0, -d.foreArm - lr * 0.3, 0]} s={[1, 1.15, 0.9]} />
      </group>
    </group>
  );

  const leg = (g: Rig["legF"], key: string) => (
    <group key={key} position={[g.side * d.hipW, 0, 0]} rotation={g.thigh}>
      <Segment len={d.thigh} r0={lr * 1.45} r1={lr * 1.15} m={legs} />
      <group position={[0, -d.thigh, 0]} rotation={g.shin}>
        <M g={G.ico(lr * 1.18, 0)} m={legs} />
        <Segment len={d.shin} r0={lr * 1.15} r1={lr * 0.95} m={legs} />
        <group position={[0, -d.shin, 0]} rotation={g.foot}>
          <M g={G.box(lr * 2.1, lr * 1.3, d.foot * 1.25)} m={shoes} p={[0, -lr * 0.2, d.foot * 0.4]} />
        </group>
      </group>
    </group>
  );

  const legAngle = -((rig.legF.thigh.x + rig.legB.thigh.x) / 2) * (180 / Math.PI);
  const tex = l.silhouette ? null : faceTexture({ expr, blink, mouth: rig.mouth, frame, ink: l.ink, skin: blend(l.skin, "#ffffff", 0.5), beard: cast.beard, features: cast.face, hair: l.hair, neon: l.neon });
  const headProps = { l, d, frame, speed };

  return (
    <group scale={[1 - rig.squash * 0.5, 1 + rig.squash, 1 - rig.squash * 0.5]}>
      <group position={[0, rig.hipY, 0]}>
        {/* Hips */}
        <group rotation={rig.pelvis}>
          <M g={G.cyl(d.waistR * 1.02, d.waistR * 0.95, lr * 3.2, 8)} m={legs} p={[0, lr * 0.6, 0]} s={[1, 1, 0.78]} />
          {leg(rig.legB, "lb")}
          {leg(rig.legF, "lf")}
          {/* Spine */}
          <group rotation={rig.chest}>
            <M g={G.cyl(d.chestR, d.waistR, d.torso * 0.84, 8)} m={shirt} p={[0, d.torso * 0.5, 0]} s={[1, 1, 0.8]} />
            <M g={G.cyl(d.chestR * 0.72, d.chestR, d.torso * 0.12, 8)} m={shirt} p={[0, d.torso * 0.97, 0]} s={[1, 1, 0.8]} />
            {d.belly > 0 && <M g={G.ico(d.waistR * 1.05, 1)} m={shirt} p={[0, d.torso * 0.32, d.waistR * 0.35]} s={[1.05, 0.95, 0.95]} />}
            {OUTFITS3D[cast.outfit]({ l, d, frame, speed, legAngle })}
            {arm(rig.armB, "ab")}
            {arm(rig.armF, "af")}
            {/* Neck → Head */}
            <group position={[0, d.torso, 0]}>
              <M g={G.cyl(lr * 1.15, lr * 1.3, d.neckGap * 1.6, 6)} m={skin} p={[0, d.neckGap * 0.5, 0]} />
              <group position={[0, d.neckGap + R, 0]} rotation={rig.head}>
                <M g={G.ico(R, 1)} m={skin} s={[1, 1.04, 0.97]} />
                {tex && <mesh geometry={faceGeo(R)} material={faceMat(tex, l.neon)} renderOrder={2} />}
                <Beard3D {...headProps} cast={cast} />
                <Hair3D {...headProps} hair={cast.hair} hat={cast.hat} />
                <Hat3D {...headProps} hat={cast.hat} />
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

export type HeldNode = { at: THREE.Vector3; node: ReactNode };
