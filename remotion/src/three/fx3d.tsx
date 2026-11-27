import * as THREE from "three";
import { G, flat } from "./kit";

/**
 * Action effects in 3D (ActionDef.fx): floating Zs over a sleeper, sweat
 * drops flying off a panicking head, steam puffs. Positions in the figure's
 * space, driven by the frame. Speed lines are left out: in 3D the motion and
 * the camera already say "fast".
 */

let zTex: THREE.CanvasTexture | undefined;
function zTexture(): THREE.CanvasTexture {
  if (zTex) return zTex;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const ctx = cv.getContext("2d")!;
  ctx.font = "700 110px Fredoka, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 14;
  ctx.strokeStyle = "#1d1b29";
  ctx.strokeText("Z", 64, 68);
  ctx.fillStyle = "#fbf4e6";
  ctx.fillText("Z", 64, 68);
  zTex = new THREE.CanvasTexture(cv);
  zTex.colorSpace = THREE.SRGBColorSpace;
  return zTex;
}
const zMats = new Map<number, THREE.SpriteMaterial>();
const zMat = (o: number) => {
  const k = Math.round(o * 20);
  let m = zMats.get(k);
  if (!m) zMats.set(k, (m = new THREE.SpriteMaterial({ map: zTexture(), transparent: true, opacity: k / 20, depthWrite: false, fog: false })));
  return m;
};

export function Fx3D({ kind, head, frame, phase }: { kind: "zzz" | "sweat" | "speed" | "steam"; head: THREE.Vector3; frame: number; phase: number }) {
  if (kind === "zzz") {
    return (
      <group position={[head.x, head.y + 0.15, head.z]}>
        {[0, 1, 2].map((i) => {
          const t = ((frame + i * 26 + phase * 78) % 78) / 78;
          const o = Math.min(1, t * 4) * (1 - t);
          const s = 0.12 + t * 0.16;
          return <sprite key={i} material={zMat(o)} position={[0.1 + Math.sin(t * 5 + i) * 0.08, t * 0.7, 0.05]} scale={[s, s, s]} />;
        })}
      </group>
    );
  }
  if (kind === "sweat") {
    return (
      <group position={[head.x, head.y, head.z]}>
        {[0, 1, 2, 3].map((i) => {
          const t = ((frame + i * 7 + phase * 28) % 28) / 28;
          const a = (i / 4) * Math.PI * 2 + 0.6;
          const r = 0.2 + t * 0.25;
          return <mesh key={i} geometry={G.cone(0.025, 0.07, 4)} material={flat("#8fd0f0", { opacity: 1 - t })} position={[Math.cos(a) * r, 0.12 + t * 0.15 - t * t * 0.35, Math.sin(a) * r * 0.5]} rotation={[0, 0, a - Math.PI / 2]} />;
        })}
      </group>
    );
  }
  if (kind === "steam") {
    return (
      <group position={[head.x, head.y + 0.2, head.z]}>
        {[0, 1, 2].map((i) => {
          const t = ((frame + i * 10) % 30) / 30;
          return <mesh key={i} geometry={G.ico(0.06 + t * 0.08, 0)} material={flat("#f4f1ea", { opacity: 0.8 * (1 - t) })} position={[(i - 1) * 0.12, t * 0.45, 0]} />;
        })}
      </group>
    );
  }
  return null;
}
