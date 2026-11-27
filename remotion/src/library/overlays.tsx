import type { OverlayId, OverlayInScene } from "@studio/schema";
import { useId, type ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { TimedOverlay } from "../scene/timeline";
import { ACCENT, INK, PAPER, SAFE_BOTTOM, W } from "../theme";

/**
 * Overlays: text and graphics above the picture and below the captions.
 * Each runs from its start frame to the end of its scene (the time card
 * leaves after ~2 s). Same type and ink as the captions so they belong together.
 */

const font: React.CSSProperties = { fontFamily: "Fredoka, sans-serif", fontWeight: 700, lineHeight: 1, whiteSpace: "nowrap" };
const inked = (stroke: number): React.CSSProperties => ({ WebkitTextStroke: `${stroke}px ${INK}`, paintOrder: "stroke fill" });
const clampOpts = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

type Props<S extends OverlayId> = { o: Extract<OverlayInScene, { style: S }>; f: number; len: number };

/** 0→1 in, 1→0 over the last `out` frames. */
function life(f: number, len: number, inF: number, out: number) {
  return Math.min(interpolate(f, [0, inF], [0, 1], clampOpts), interpolate(f, [len - out, len], [1, 0], clampOpts));
}

function TitleCard({ o, f, len }: Props<"title_card">) {
  const { fps } = useVideoConfig();
  const pop = spring({ frame: f, fps, config: { damping: 12, stiffness: 180, mass: 0.7 } });
  const out = interpolate(f, [len - 8, len], [1, 0], clampOpts);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 170, opacity: out }}>
      <div
        style={{
          transform: `scale(${0.6 + 0.4 * pop}) rotate(${-2 + (1 - pop) * 6}deg)`,
          background: PAPER,
          border: `9px solid ${INK}`,
          borderRadius: 22,
          padding: "26px 56px 30px",
          boxShadow: "0 14px 0 rgba(0,0,0,0.3)",
          textAlign: "center",
        }}
      >
        <div style={{ ...font, fontSize: 104, color: INK }}>{o.text}</div>
        {o.sub && <div style={{ ...font, fontSize: 42, color: "#8a5d3d", marginTop: 14 }}>{o.sub}</div>}
      </div>
    </AbsoluteFill>
  );
}

const TIME_CARD = 66;
function TimeCard({ o, f }: Props<"time_card">) {
  const len = TIME_CARD;
  const slide = interpolate(f, [0, 10, len - 10, len], [-W, 0, 0, W], { ...clampOpts, easing: Easing.inOut(Easing.cubic) });
  const dim = life(f, len, 8, 8);
  if (f >= len) return null;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: INK, opacity: dim * 0.5 }} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ transform: `translateX(${slide}px) rotate(-4deg)`, background: "#3b6fd8", padding: "28px 90px", border: `8px solid ${INK}`, borderRadius: 18, boxShadow: "0 16px 0 rgba(0,0,0,0.3)" }}>
          <div style={{ ...font, ...inked(16), fontSize: 120, color: ACCENT, textTransform: "uppercase", letterSpacing: 2 }}>{o.text}</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function LowerThird({ o, f, len }: Props<"lower_third">) {
  const right = o.side === "right";
  const k = interpolate(f, [0, 12], [0, 1], { ...clampOpts, easing: Easing.out(Easing.back(1.4)) });
  const out = interpolate(f, [len - 10, len], [0, 1], { ...clampOpts, easing: Easing.in(Easing.cubic) });
  const dx = (1 - k + out) * 640 * (right ? 1 : -1);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: right ? "flex-end" : "flex-start", padding: `0 90px ${SAFE_BOTTOM + 40}px` }}>
      <div style={{ transform: `translateX(${dx}px)`, display: "flex", flexDirection: right ? "row-reverse" : "row", alignItems: "stretch" }}>
        <div style={{ width: 22, background: ACCENT, border: `6px solid ${INK}`, borderRadius: 10 }} />
        <div style={{ background: PAPER, border: `6px solid ${INK}`, borderRadius: 14, padding: "16px 30px 18px", margin: right ? "0 10px 0 0" : "0 0 0 10px", boxShadow: "0 10px 0 rgba(0,0,0,0.25)", textAlign: right ? "right" : "left" }}>
          <div style={{ ...font, fontSize: 58, color: INK }}>{o.text}</div>
          {o.sub && <div style={{ ...font, fontSize: 32, color: "#6b5b4b", marginTop: 8 }}>{o.sub}</div>}
        </div>
      </div>
    </AbsoluteFill>
  );
}

function MapPin({ o, f, len }: Props<"map_pin">) {
  const { fps } = useVideoConfig();
  const enter = spring({ frame: f, fps, config: { damping: 14, stiffness: 160 } });
  const out = interpolate(f, [len - 10, len], [1, 0], clampOpts);
  const route = interpolate(f, [8, 34], [1, 0], { ...clampOpts, easing: Easing.inOut(Easing.cubic) });
  const drop = spring({ frame: f - 32, fps, config: { damping: 8, stiffness: 220, mass: 0.6 } });
  const maskId = `route-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const routeD = "M 70 250 C 120 160, 200 230, 250 170 S 340 90, 372 120";
  return (
    <AbsoluteFill style={{ alignItems: "flex-end", padding: "70px 80px", opacity: out }}>
      <div style={{ transform: `translateX(${(1 - enter) * 600}px) rotate(${2 - enter * 4}deg)` }}>
        <svg width={460} height={360} viewBox="0 0 460 360" style={{ overflow: "visible", filter: "drop-shadow(0 12px 0 rgba(0,0,0,0.28))" }}>
          <path d="M 12 20 L 150 6 L 300 22 L 448 8 L 444 300 L 300 316 L 150 300 L 16 314 Z" fill="#f1dfb6" stroke={INK} strokeWidth={7} strokeLinejoin="round" />
          <path d="M 150 6 L 150 300 M 300 22 L 300 316" stroke="#d8c08e" strokeWidth={4} />
          <path d="M 40 90 C 80 50, 150 70, 170 110 C 200 150, 130 190, 90 170 C 50 160, 20 130, 40 90 Z" fill="#b9d29a" />
          <path d="M 250 230 C 300 200, 390 210, 410 250 C 420 280, 340 296, 290 286 C 250 280, 230 250, 250 230 Z" fill="#b9d29a" />
          <path d="M 330 50 C 360 40, 410 50, 420 80 C 410 100, 370 104, 340 90 C 320 80, 316 60, 330 50 Z" fill="#9fc4dd" />
          <path d={routeD} fill="none" stroke="#c0392b" strokeWidth={6} strokeLinecap="round" pathLength={1} strokeDasharray="0.035 0.025" mask={`url(#${maskId})`} />
          <mask id={maskId}>
            <path d={routeD} fill="none" stroke="#fff" strokeWidth={14} pathLength={1} strokeDasharray="1 1" strokeDashoffset={route} />
          </mask>
          <circle cx={70} cy={250} r={9} fill={INK} />
          <g transform={`translate(372 ${120 - (1 - drop) * 140})`} opacity={f > 30 ? 1 : 0}>
            <ellipse cx={0} cy={4} rx={16 * drop} ry={5 * drop} fill="rgba(0,0,0,0.25)" />
            <path d="M 0 0 C -10 -18, -26 -30, -26 -48 C -26 -64, -14 -76, 0 -76 C 14 -76, 26 -64, 26 -48 C 26 -30, 10 -18, 0 0 Z" fill="#e5484d" stroke={INK} strokeWidth={6} strokeLinejoin="round" />
            <circle cx={0} cy={-49} r={9} fill={PAPER} stroke={INK} strokeWidth={4} />
          </g>
        </svg>
        <div style={{ textAlign: "center", marginTop: 18, opacity: interpolate(f, [34, 44], [0, 1], clampOpts) }}>
          <div style={{ ...font, ...inked(12), fontSize: 64, color: "#ffffff" }}>{o.text}</div>
          {o.sub && <div style={{ ...font, ...inked(8), fontSize: 34, color: ACCENT, marginTop: 8 }}>{o.sub}</div>}
        </div>
      </div>
    </AbsoluteFill>
  );
}

function Counter({ o, f, len }: Props<"counter">) {
  const { fps } = useVideoConfig();
  const from = o.from ?? 0;
  const k = interpolate(f, [4, 46], [0, 1], { ...clampOpts, easing: Easing.out(Easing.cubic) });
  const value = from + (o.to - from) * k;
  const done = spring({ frame: f - 46, fps, config: { damping: 9, stiffness: 260, mass: 0.5 } });
  const enter = spring({ frame: f, fps, config: { damping: 14, stiffness: 200 } });
  const out = interpolate(f, [len - 8, len], [1, 0], clampOpts);
  const text = value.toLocaleString("en-US", { minimumFractionDigits: o.decimals ?? 0, maximumFractionDigits: o.decimals ?? 0 });
  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 150, opacity: out * enter }}>
      {o.label && <div style={{ ...font, ...inked(10), fontSize: 50, color: "#ffffff", marginBottom: 12, textTransform: "uppercase", letterSpacing: 2 }}>{o.label}</div>}
      <div style={{ ...font, ...inked(20), fontSize: 150, color: ACCENT, fontVariantNumeric: "tabular-nums", transform: `scale(${f < 46 ? 1 : 1 + 0.1 * Math.sin(Math.min(1, done) * Math.PI)})`, filter: "drop-shadow(0 12px 0 rgba(0,0,0,0.3))" }}>
        {o.prefix ?? ""}
        {text}
        {o.suffix ? <span style={{ fontSize: 90 }}>{o.suffix}</span> : null}
      </div>
    </AbsoluteFill>
  );
}

const DRAW: { [S in OverlayId]: (p: Props<S>) => ReactNode } = {
  title_card: TitleCard,
  time_card: TimeCard,
  lower_third: LowerThird,
  map_pin: MapPin,
  counter: Counter,
};

function One({ t }: { t: TimedOverlay }) {
  const frame = useCurrentFrame();
  const f = frame - t.start;
  const len = t.end - t.start;
  if (f < 0 || f >= len) return null;
  const draw = DRAW[t.overlay.style] as (p: { o: OverlayInScene; f: number; len: number }) => ReactNode;
  return <AbsoluteFill style={{ pointerEvents: "none" }}>{draw({ o: t.overlay, f, len })}</AbsoluteFill>;
}

export function Overlays({ overlays }: { overlays: TimedOverlay[] }) {
  return (
    <>
      {overlays.map((t, i) => (
        <One key={i} t={t} />
      ))}
    </>
  );
}
