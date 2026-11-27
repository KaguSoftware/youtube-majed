import { useId } from "react";
import { random } from "remotion";
import { ACCENT, C, H, W, mix, tone, type TimeOfDay } from "../../theme";
import { Layer } from "../camera";

/** Shared scenery: sky, sun/moon, stars, clouds. Drawn with bleed past the frame. */
export const BLEED = 260;
export const X0 = -BLEED;
export const X1 = W + BLEED;
export const Y0 = -BLEED;
export const Y1 = H + BLEED;

export type BgProps = { tod: TimeOfDay; frame: number };

export const useGid = () => useId().replace(/[^a-zA-Z0-9_-]/g, "");

export function SkyGradient({ tod, top = Y0, bottom }: { tod: TimeOfDay; top?: number; bottom: number }) {
  const id = useGid();
  const stops =
    tod === "day"
      ? [[0, C.skyDayTop], [1, C.skyDayBottom]]
      : tod === "dusk"
        ? [[0, C.skyDuskTop], [0.55, C.skyDuskMid], [1, C.skyDuskBottom]]
        : [[0, C.skyNightTop], [1, C.skyNightBottom]];
  return (
    <>
      <defs>
        <linearGradient id={id} x1="0" y1={top} x2="0" y2={bottom} gradientUnits="userSpaceOnUse">
          {stops.map(([o, c]) => <stop key={String(o)} offset={o as number} stopColor={c as string} />)}
        </linearGradient>
      </defs>
      <rect x={X0} y={top} width={X1 - X0} height={bottom - top} fill={`url(#${id})`} />
    </>
  );
}

export function Stars({ frame, count = 70, maxY = 560, seed = "stars" }: { frame: number; count?: number; maxY?: number; seed?: string }) {
  return (
    <g>
      {Array.from({ length: count }, (_, i) => {
        const x = X0 + random(`${seed}-x-${i}`) * (X1 - X0);
        const y = Y0 + 60 + random(`${seed}-y-${i}`) * (maxY - Y0 - 60);
        const r = 1.2 + random(`${seed}-r-${i}`) * 2.2;
        const tw = 0.55 + 0.45 * Math.sin(frame / (8 + random(`${seed}-t-${i}`) * 14) + i);
        return <circle key={i} cx={x} cy={y} r={r} fill="#fff8e1" opacity={tw} />;
      })}
    </g>
  );
}

export function Moon({ x, y, r = 46 }: { x: number; y: number; r?: number }) {
  const id = useGid();
  return (
    <g>
      <defs>
        <radialGradient id={id}>
          <stop offset="0%" stopColor="#fff5d6" stopOpacity={0.45} />
          <stop offset="100%" stopColor="#fff5d6" stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx={x} cy={y} r={r * 3.2} fill={`url(#${id})`} />
      <circle cx={x} cy={y} r={r} fill="#fff2c8" />
      <circle cx={x + r * 0.42} cy={y - r * 0.18} r={r * 0.86} fill={C.skyNightTop} opacity={0.92} />
    </g>
  );
}

export function Sun({ x, y, tod }: { x: number; y: number; tod: TimeOfDay }) {
  const id = useGid();
  if (tod === "night") return null;
  const core = tod === "dusk" ? "#ffb36b" : "#fff3c4";
  return (
    <g>
      <defs>
        <radialGradient id={id}>
          <stop offset="0%" stopColor={core} stopOpacity={0.7} />
          <stop offset="100%" stopColor={core} stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx={x} cy={y} r={tod === "dusk" ? 240 : 170} fill={`url(#${id})`} />
      <circle cx={x} cy={y} r={tod === "dusk" ? 74 : 54} fill={core} />
    </g>
  );
}

export function Cloud({ x, y, s = 1, color }: { x: number; y: number; s?: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} fill={color}>
      <ellipse cx={0} cy={0} rx={90} ry={34} />
      <circle cx={-40} cy={-18} r={38} />
      <circle cx={18} cy={-34} r={48} />
      <circle cx={64} cy={-10} r={32} />
    </g>
  );
}

export function Clouds({ tod, frame, y = 200, seed = "cl" }: { tod: TimeOfDay; frame: number; y?: number; seed?: string }) {
  if (tod === "night") return null;
  const color = tod === "dusk" ? mix("#ffd2c0", C.skyDuskMid, 0.25) : "#ffffff";
  const span = X1 - X0 + 400;
  return (
    <g opacity={tod === "dusk" ? 0.75 : 0.92}>
      {[0, 1, 2, 3].map((i) => {
        const base = X0 + random(`${seed}-${i}`) * span;
        const x = ((base + frame * (0.35 + i * 0.12) - X0) % span) + X0 - 200;
        return <Cloud key={i} x={x} y={y + random(`${seed}-y-${i}`) * 160 - 60} s={0.7 + random(`${seed}-s-${i}`) * 0.6} color={color} />;
      })}
    </g>
  );
}

/** The sky for an outdoor scene: gradient, sun or moon and stars, drifting clouds. */
export function OutdoorSky({ tod, frame, horizon, sunX = 1500 }: BgProps & { horizon: number; sunX?: number }) {
  return (
    <Layer depth={0.08}>
      <SkyGradient tod={tod} bottom={horizon + 40} />
      {tod === "night" && <Stars frame={frame} maxY={horizon - 40} />}
      {tod === "night" ? <Moon x={sunX} y={170} /> : <Sun x={sunX} y={tod === "dusk" ? horizon - 50 : 160} tod={tod} />}
      <Clouds tod={tod} frame={frame} />
    </Layer>
  );
}

/** A soft pool of warm light (lamps, windows) that skips the night tint. */
export function Glow({ x, y, r, opacity = 0.35, color = ACCENT }: { x: number; y: number; r: number; opacity?: number; color?: string }) {
  const id = useGid();
  return (
    <g>
      <defs>
        <radialGradient id={id}>
          <stop offset="0%" stopColor={color} stopOpacity={opacity} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx={x} cy={y} r={r} fill={`url(#${id})`} />
    </g>
  );
}

export const lit = (tod: TimeOfDay) => tod !== "day";
export const t = (tod: TimeOfDay) => (hex: string) => tone(hex, tod);
