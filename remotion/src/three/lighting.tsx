import type { GradeId } from "@studio/schema";
import { useMemo } from "react";
import * as THREE from "three";
import { GRADE_LIB } from "../library/grades";
import type { TimeOfDay } from "../theme";

/**
 * Light per time of day and grade. The stick style re-colours its flat
 * shapes by time of day (theme.tone); here the light does it: a sun or moon
 * that casts shadows, a sky/ground fill, and fog in the sky's colour so the
 * far planes fade. Sets add their own practical lights (lamps, windows,
 * screens). The grade's wash, vignette and filter still go over the picture
 * (GradeOverlay), as in the stick style.
 */

export type LightRig = {
  sun: { color: string; intensity: number; dir: [number, number, number] };
  sky: string;
  ground: string;
  fill: number;
  ambient: number;
  fog: { color: string; near: number; far: number };
  /** practical lights (lamps, windows) are this strong */
  practical: number;
  /** emissive surfaces (screens, lit windows) */
  glow: number;
};

const BASE: Record<TimeOfDay, LightRig> = {
  day: { sun: { color: "#fff1dc", intensity: 2.6, dir: [-4, 7, 5] }, sky: "#bfdcf5", ground: "#b8a88c", fill: 1.15, ambient: 0.25, fog: { color: "#d4e8f4", near: 30, far: 110 }, practical: 0.35, glow: 0.5 },
  dusk: { sun: { color: "#ffb27a", intensity: 2.2, dir: [-7, 2.6, 3] }, sky: "#c48aa6", ground: "#6b4a5a", fill: 0.85, ambient: 0.18, fog: { color: "#e2a08e", near: 22, far: 90 }, practical: 0.8, glow: 1 },
  night: { sun: { color: "#9db4ff", intensity: 0.9, dir: [5, 6, 4] }, sky: "#4a5c9a", ground: "#1a2038", fill: 0.85, ambient: 0.14, fog: { color: "#1a2448", near: 16, far: 70 }, practical: 1.4, glow: 1.6 },
};

/** Grades that change the light itself, not only the wash over it. */
const GRADE_LIGHT: Partial<Record<GradeId, Partial<LightRig>>> = {
  memory: { sun: { color: "#ffd9a8", intensity: 2.2, dir: [-5, 5, 4] }, sky: "#f2dcc0", fill: 1.25 },
  horror: { sun: { color: "#9fe0a8", intensity: 0.75, dir: [6, 7, 2] }, sky: "#2e4a36", ground: "#0c140e", fog: { color: "#13241a", near: 10, far: 50 } },
  noir: { sun: { color: "#ffffff", intensity: 3.2, dir: [-6, 5, 3] }, fill: 0.35, ambient: 0.05 },
  neon: { sun: { color: "#c27bff", intensity: 0.8, dir: [6, 5, 4] }, sky: "#4a2a8a", ground: "#10183a", fog: { color: "#241446", near: 14, far: 60 } },
};

/** Interiors: the sun becomes window light, softer, and the room's own lamps carry the night. */
const INTERIOR: Record<TimeOfDay, Partial<LightRig>> = {
  day: { sun: { color: "#fff4e2", intensity: 2.4, dir: [-3, 6, 6] }, sky: "#fff4e4", ground: "#c9b99c", fill: 1.6, ambient: 0.4 },
  dusk: { sky: "#f0b89a", ground: "#7a5a5a", fill: 1.0, ambient: 0.25 },
  night: { sun: { color: "#7f95e0", intensity: 0.35, dir: [5, 6, 4] }, sky: "#4a4060", ground: "#2a1e22", fill: 0.42, ambient: 0.14 },
};

export function lightRig(grade: GradeId, interior: boolean): LightRig {
  const tod = GRADE_LIB[grade].tod;
  return { ...BASE[tod], ...(interior ? INTERIOR[tod] : {}), ...GRADE_LIGHT[grade] };
}

/** The global lights. `flicker` (horror) dips them on a frame-driven pattern. */
export function Lights({ rig, frame, flicker = 0 }: { rig: LightRig; frame: number; flicker?: number }) {
  const k = flicker ? 1 - flicker * (0.5 + 0.5 * Math.sin(frame * 0.9) * Math.sin(frame * 0.23)) : 1;
  const sun = useMemo(() => new THREE.Object3D(), []);
  const [x, y, z] = rig.sun.dir;
  const n = Math.hypot(x, y, z);
  const D = 30;
  return (
    <>
      <hemisphereLight args={[rig.sky, rig.ground, rig.fill * k]} />
      <ambientLight intensity={rig.ambient * k} />
      <primitive object={sun} position={[0, 0, 0]} />
      <directionalLight
        position={[(x / n) * D, (y / n) * D, (z / n) * D]}
        color={rig.sun.color}
        intensity={rig.sun.intensity * k}
        castShadow
        target={sun}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={12}
        shadow-camera-bottom={-6}
        shadow-camera-near={1}
        shadow-camera-far={80}
      />
      {/* a soft fill from the camera's side, no shadows: faces stay readable against lamps and windows behind them */}
      <directionalLight position={[2, 6, 30]} color="#fff6ea" intensity={(0.25 + rig.practical * 0.18) * k} />
      <fog attach="fog" args={[rig.fog.color, rig.fog.near, rig.fog.far]} />
    </>
  );
}
