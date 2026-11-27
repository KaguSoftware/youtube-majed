import type { LoopMapOutput } from "@studio/schema";
import type { CheckReport } from "./check";

/**
 * The tension graph (docs/PLAN.md section 3): one rise and drop per loop,
 * gaps with no open question in red. Tension is modelled, not measured:
 * each loop starts a little higher than the last (the master stakes rise),
 * climbs line by line to its head fake, drops after it, and the rehook lifts
 * it into the next loop. Energy nudges each point.
 */

export type TensionPoint = { t: number; value: number; lineId: string; loopId: string; headfake: boolean; rehook: boolean };
export type TensionGraph = {
  duration: number;
  points: TensionPoint[];
  loops: { loopId: string; title: string; start: number; end: number; peak: number }[];
  gaps: { start: number; end: number; long: boolean }[];
};

export function tensionGraph(map: LoopMapOutput, report: CheckReport, maxGap = 20): TensionGraph {
  const n = Math.max(1, map.loops.length - 1);
  const points: TensionPoint[] = [];
  const loops: TensionGraph["loops"] = [];
  map.loops.forEach((loop, li) => {
    const lines = report.lines.filter((l) => l.loopId === loop.id);
    if (!lines.length) return;
    const base = 0.18 + 0.32 * (li / n);
    const fakeAt = lines.findIndex((l) => l.beats.includes("headfake"));
    const peakIdx = fakeAt >= 0 ? fakeAt : lines.length - 1;
    let peak = 0;
    lines.forEach((l, i) => {
      let v: number;
      if (i <= peakIdx) v = base + (0.42 * i) / Math.max(1, peakIdx);
      else if (l.beats.includes("rehook")) v = base + 0.24;
      else v = base * 0.75;
      v += 0.02 * (l.energy - 3);
      v = Math.max(0.03, Math.min(1, v));
      peak = Math.max(peak, v);
      points.push({ t: (l.start + l.end) / 2, value: v, lineId: l.id, loopId: loop.id, headfake: l.beats.includes("headfake"), rehook: l.beats.includes("rehook") });
    });
    loops.push({ loopId: loop.id, title: loop.title, start: lines[0]!.start, end: lines[lines.length - 1]!.end, peak });
  });
  return { duration: report.seconds, points, loops, gaps: report.gaps.map((g) => ({ start: g.start, end: g.end, long: g.end - g.start > maxGap })) };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A standalone SVG of the graph, for `pnpm story check` (projects/<id>/tension.svg). The app draws its own, interactive one. */
export function tensionSvg(g: TensionGraph, title = "", width = 1200, height = 360): string {
  const pad = { l: 44, r: 16, t: title ? 40 : 16, b: 52 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const x = (t: number) => pad.l + (g.duration ? (t / g.duration) * w : 0);
  const y = (v: number) => pad.t + h - v * h;
  const ink = "#e9e5dc";
  const faint = "#8a857c";
  const accent = "#f2cf3d";
  const danger = "#f0645a";
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="ui-sans-serif, system-ui, sans-serif">`);
  parts.push(`<rect width="${width}" height="${height}" fill="#1c1b19"/>`);
  if (title) parts.push(`<text x="${pad.l}" y="24" fill="${ink}" font-size="15" font-weight="700">${esc(title)}</text>`);
  for (const gap of g.gaps.filter((x) => x.long)) parts.push(`<rect x="${x(gap.start)}" y="${pad.t}" width="${Math.max(2, x(gap.end) - x(gap.start))}" height="${h}" fill="${danger}" fill-opacity="0.22"/>`);
  g.loops.forEach((l, i) => {
    if (i > 0) parts.push(`<line x1="${x(l.start)}" x2="${x(l.start)}" y1="${pad.t}" y2="${pad.t + h}" stroke="${faint}" stroke-opacity="0.35" stroke-dasharray="3 4"/>`);
    parts.push(`<text x="${(x(l.start) + x(l.end)) / 2}" y="${pad.t + h + 18}" fill="${ink}" font-size="12" font-weight="600" text-anchor="middle">${esc(l.loopId)}</text>`);
    parts.push(`<text x="${(x(l.start) + x(l.end)) / 2}" y="${pad.t + h + 34}" fill="${faint}" font-size="11" text-anchor="middle">${esc(l.title.length > 18 ? l.title.slice(0, 17) + "…" : l.title)}</text>`);
  });
  const path = g.points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  if (g.points.length) {
    const area = `${path} L${x(g.points[g.points.length - 1]!.t).toFixed(1)},${pad.t + h} L${x(g.points[0]!.t).toFixed(1)},${pad.t + h} Z`;
    parts.push(`<path d="${area}" fill="${accent}" fill-opacity="0.10"/>`);
    parts.push(`<path d="${path}" fill="none" stroke="${accent}" stroke-width="2.25" stroke-linejoin="round"/>`);
  }
  for (const p of g.points.filter((p) => p.headfake)) parts.push(`<circle cx="${x(p.t)}" cy="${y(p.value)}" r="4.5" fill="${accent}"><title>${esc(p.lineId)} head fake</title></circle>`);
  for (const p of g.points.filter((p) => p.rehook)) parts.push(`<circle cx="${x(p.t)}" cy="${y(p.value)}" r="3.5" fill="#1c1b19" stroke="${accent}" stroke-width="2"><title>${esc(p.lineId)} rehook</title></circle>`);
  for (let s = 0; s <= g.duration; s += g.duration > 180 ? 60 : 15) parts.push(`<text x="${x(s)}" y="${height - 6}" fill="${faint}" font-size="10" text-anchor="middle">${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}</text>`);
  parts.push(`<text x="12" y="${pad.t + 10}" fill="${faint}" font-size="10">tension</text>`);
  parts.push("</svg>");
  return parts.join("\n");
}
