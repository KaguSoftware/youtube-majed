import type { WeatherId } from "@studio/schema";
import { random } from "remotion";
import type { TimeOfDay } from "../theme";
import { X0, X1, Y0, Y1, useGid } from "./backgrounds/common";
import { Layer } from "./camera";

/**
 * Weather, drawn over the scenery in two parallax planes: a far one behind
 * the characters and a near one in front of them. Deterministic: every drop
 * and flake is placed by `random(seed)` and moved by the frame.
 */

const SPAN_X = X1 - X0;
const SPAN_Y = Y1 - Y0;

function Rain({ frame, tod, heavy, near }: { frame: number; tod: TimeOfDay; heavy: boolean; near: boolean }) {
  const n = (heavy ? 150 : 90) * (near ? 0.5 : 1);
  const len = near ? 60 : 36;
  const speed = near ? 62 : 40;
  const slant = heavy ? 0.32 : 0.12;
  const color = tod === "night" ? "rgba(190,210,255,0.55)" : "rgba(235,242,255,0.7)";
  return (
    <g stroke={color} strokeWidth={near ? 3.2 : 2} strokeLinecap="round">
      {Array.from({ length: n }, (_, i) => {
        const seed = `${near ? "rn" : "rf"}${i}`;
        const x0 = X0 + random(`${seed}x`) * SPAN_X;
        const y = Y0 + ((random(`${seed}y`) * SPAN_Y + frame * speed) % SPAN_Y);
        const x = x0 - ((y - Y0) * slant) % SPAN_X;
        return <path key={i} d={`M ${x.toFixed(1)} ${y.toFixed(1)} l ${(-len * slant).toFixed(1)} ${len}`} />;
      })}
    </g>
  );
}

function Splashes({ frame, groundY }: { frame: number; groundY: number }) {
  return (
    <g stroke="rgba(235,242,255,0.6)" strokeWidth={2.5} fill="none" strokeLinecap="round">
      {Array.from({ length: 26 }, (_, i) => {
        const period = 14 + Math.floor(random(`sp${i}p`) * 10);
        const t = ((frame + Math.floor(random(`sp${i}o`) * period)) % period) / period;
        const x = X0 + random(`sp${i}x`) * SPAN_X;
        const y = groundY + random(`sp${i}y`) * (Y1 - groundY);
        const r = 4 + t * 16;
        return <ellipse key={i} cx={x} cy={y} rx={r} ry={r * 0.3} opacity={1 - t} />;
      })}
    </g>
  );
}

function Snow({ frame, near }: { frame: number; near: boolean }) {
  const n = near ? 45 : 110;
  const fall = near ? 4.2 : 2.2;
  return (
    <g fill="#ffffff">
      {Array.from({ length: n }, (_, i) => {
        const seed = `${near ? "sn" : "sf"}${i}`;
        const r = (near ? 4 : 2.2) + random(`${seed}r`) * (near ? 4 : 2.5);
        const y = Y0 + ((random(`${seed}y`) * SPAN_Y + frame * fall * (0.7 + random(`${seed}v`) * 0.6)) % SPAN_Y);
        const x = X0 + random(`${seed}x`) * SPAN_X + Math.sin(frame / (26 + random(`${seed}w`) * 20) + i) * (near ? 30 : 18);
        return <circle key={i} cx={x} cy={y} r={r} opacity={near ? 0.95 : 0.8} />;
      })}
    </g>
  );
}

function Fog({ frame, tod, groundY, near }: { frame: number; tod: TimeOfDay; groundY: number; near: boolean }) {
  const id = useGid();
  const color = tod === "night" ? "#8f9bc4" : tod === "dusk" ? "#e8c9c4" : "#eef2f4";
  const bands = near ? [groundY + 40, groundY + 150] : [groundY - 260, groundY - 120, groundY - 10];
  return (
    <g>
      <defs>
        <filter id={id} x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation={near ? 26 : 34} />
        </filter>
      </defs>
      {!near && <rect x={X0} y={Y0} width={SPAN_X} height={SPAN_Y} fill={color} opacity={0.22} />}
      <g filter={`url(#${id})`} fill={color}>
        {bands.map((y, i) => {
          const drift = ((frame * (0.6 + i * 0.25) + i * 700) % (SPAN_X + 1200)) - 600;
          return (
            <g key={i} opacity={near ? 0.5 : 0.62}>
              {[0, 1, 2].map((k) => (
                <ellipse key={k} cx={X0 + drift + k * 900} cy={y + Math.sin(frame / 40 + k) * 10} rx={520} ry={near ? 60 : 85} />
              ))}
              {[0, 1, 2].map((k) => (
                <ellipse key={`b${k}`} cx={X0 + drift + k * 900 - SPAN_X - 600} cy={y} rx={520} ry={near ? 60 : 85} />
              ))}
            </g>
          );
        })}
      </g>
    </g>
  );
}

/** A storm's lightning: a couple of quick double-flashes every few seconds. */
export function lightning(frame: number): number {
  const period = 150;
  const f = frame % period;
  const strike = [0, 1, 0.3, 0.9, 0.4, 0.15, 0];
  const start = 40 + Math.floor(random(`lt${Math.floor(frame / period)}`) * 70);
  const k = f - start;
  return k >= 0 && k < strike.length ? strike[k]! : 0;
}

/** Behind the characters. */
export function WeatherBack({ kind, frame, tod, groundY }: { kind: WeatherId; frame: number; tod: TimeOfDay; groundY: number }) {
  return (
    <Layer depth={0.7}>
      {kind === "rain" && <Rain frame={frame} tod={tod} heavy={false} near={false} />}
      {kind === "storm" && <rect x={X0} y={Y0} width={SPAN_X} height={SPAN_Y} fill="#1a2140" opacity={0.25} />}
      {kind === "storm" && <Rain frame={frame} tod={tod} heavy near={false} />}
      {kind === "snow" && <Snow frame={frame} near={false} />}
      {kind === "fog" && <Fog frame={frame} tod={tod} groundY={groundY} near={false} />}
    </Layer>
  );
}

/** In front of the characters. */
export function WeatherFront({ kind, frame, tod, groundY }: { kind: WeatherId; frame: number; tod: TimeOfDay; groundY: number }) {
  const flash = kind === "storm" ? lightning(frame) : 0;
  return (
    <>
      <Layer depth={1.25}>
        {(kind === "rain" || kind === "storm") && <Rain frame={frame} tod={tod} heavy={kind === "storm"} near />}
        {(kind === "rain" || kind === "storm") && <Splashes frame={frame} groundY={groundY} />}
        {kind === "snow" && <Snow frame={frame} near />}
        {kind === "fog" && <Fog frame={frame} tod={tod} groundY={groundY} near />}
      </Layer>
      {flash > 0 && <rect x={X0} y={Y0} width={SPAN_X} height={SPAN_Y} fill="#eef3ff" opacity={flash * 0.55} />}
    </>
  );
}
