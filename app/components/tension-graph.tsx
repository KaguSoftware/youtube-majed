"use client";
import type { TensionGraph as Graph } from "@studio/story";
import { useId, useMemo, useState } from "react";
import { clock } from "@/lib/format";

/**
 * One rise and drop per loop; stretches with no open question over 20 s are
 * shaded red and labelled. Hover a point to read the line; click to jump to
 * it in the script. Heights are modelled tension (see @studio/story).
 */
export function TensionGraph({ graph, wpm, height = 200, compact = false, lineText, onPick, highlight }: { graph: Graph; wpm?: number; height?: number; compact?: boolean; lineText?: (id: string) => string | undefined; onPick?: (lineId: string) => void; highlight?: ReadonlySet<string> }) {
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();
  const W = 1000;
  const pad = { l: 8, r: 8, t: 14, b: compact ? 22 : 40 };
  const h = height - pad.t - pad.b;
  const x = (t: number) => pad.l + (graph.duration ? (t / graph.duration) * (W - pad.l - pad.r) : 0);
  const y = (v: number) => pad.t + h - v * h;
  const path = useMemo(() => graph.points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.value).toFixed(1)}`).join(" "), [graph, height]);
  const long = graph.gaps.filter((g) => g.long);
  const hp = hover !== null ? graph.points[hover] : undefined;

  if (!graph.points.length) return null;

  return (
    <figure>
      <div className="relative" style={{ height }}>
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }} role="img" aria-labelledby={titleId}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const t = ((e.clientX - r.left) / r.width) * graph.duration;
          let best = 0;
          graph.points.forEach((p, i) => { if (Math.abs(p.t - t) < Math.abs(graph.points[best]!.t - t)) best = i; });
          setHover(best);
        }}
        onClick={() => hp && onPick?.(hp.lineId)}
      >
        <title id={titleId}>
          {`Tension over ${clock(graph.duration)}: ${graph.loops.length} loops${long.length ? `, ${long.length} stretch${long.length > 1 ? "es" : ""} over 20 seconds with no open question` : ", never more than 20 seconds without an open question"}.`}
        </title>
        {long.map((g, i) => (
          <rect key={i} x={x(g.start)} y={pad.t - 6} width={Math.max(3, x(g.end) - x(g.start))} height={h + 6} className="fill-danger/25" />
        ))}
        {graph.loops.map((l, i) => i > 0 && <line key={l.loopId} x1={x(l.start)} x2={x(l.start)} y1={pad.t - 6} y2={pad.t + h} className="stroke-hairline" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />)}
        <path d={`${path} L${x(graph.points.at(-1)!.t)},${pad.t + h} L${x(graph.points[0]!.t)},${pad.t + h} Z`} className="fill-accent/10" />
        <path d={path} className="fill-none stroke-accent" strokeWidth={2.25} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {highlight && graph.points.filter((p) => highlight.has(p.lineId)).map((p) => (
          <line key={p.lineId} x1={x(p.t)} x2={x(p.t)} y1={pad.t} y2={pad.t + h} className="stroke-text/40" vectorEffect="non-scaling-stroke" />
        ))}
        {hp && <line x1={x(hp.t)} x2={x(hp.t)} y1={pad.t - 6} y2={pad.t + h} className="stroke-muted" vectorEffect="non-scaling-stroke" />}
      </svg>
      {/* Dots and labels in HTML, so they stay round and crisp at any width. */}
      <div className="pointer-events-none absolute inset-0">
        {graph.points.filter((p) => p.headfake || p.rehook).map((p) => (
          <span key={p.lineId} className={`absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${p.headfake ? "bg-accent" : "bg-room ring-2 ring-accent"}`} style={{ left: `${(x(p.t) / W) * 100}%`, top: y(p.value) }} />
        ))}
        {graph.loops.map((l) => (
          <span key={l.loopId} className="absolute bottom-0 -translate-x-1/2 truncate text-center" style={{ left: `${((x(l.start) + x(l.end)) / 2 / W) * 100}%`, maxWidth: `${((x(l.end) - x(l.start)) / W) * 100}%` }}>
            <span className="tabular block text-xs font-semibold text-text">{l.loopId}</span>
            {!compact && <span className="block truncate text-xs text-faint">{l.title}</span>}
          </span>
        ))}
        {long.map((g, i) => (
          <span key={i} className="absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-sm bg-danger px-1 text-[0.6875rem] font-semibold text-room" style={{ left: `clamp(3.5rem, ${((x(g.start) + x(g.end)) / 2 / W) * 100}%, calc(100% - 3.5rem))` }}>
            {Math.round(g.end - g.start)} s, no question
          </span>
        ))}
      </div>
      {hp && (
        <figcaption className="pointer-events-none absolute z-10 w-64 -translate-x-1/2 rounded-md bg-lifted px-3 py-2 text-xs shadow-lg ring-1 ring-hairline" style={{ left: `clamp(8rem, ${(x(hp.t) / W) * 100}%, calc(100% - 8rem))`, top: Math.max(0, y(hp.value) - 74) }}>
          <span className="tabular font-semibold text-text">{hp.lineId}</span>
          <span className="tabular text-faint"> · {clock(hp.t)}{hp.headfake ? " · head fake" : hp.rehook ? " · rehook" : ""}</span>
          {lineText?.(hp.lineId) && <span className="mt-0.5 line-clamp-2 block text-muted">{lineText(hp.lineId)}</span>}
        </figcaption>
      )}
      </div>
      {!compact && (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-faint">
          <span><span aria-hidden className="mr-1.5 inline-block size-2 rounded-full bg-accent" />head fake</span>
          <span><span aria-hidden className="mr-1.5 inline-block size-2 rounded-full ring-2 ring-accent" />rehook</span>
          <span><span aria-hidden className="mr-1.5 inline-block h-2 w-3 bg-danger/40" />over 20 s with no open question</span>
          <span className="tabular ml-auto">{clock(graph.duration)}{wpm ? ` at ${wpm} wpm` : ""}</span>
        </div>
      )}
    </figure>
  );
}
