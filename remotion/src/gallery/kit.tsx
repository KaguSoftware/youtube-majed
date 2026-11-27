import { CastMember, type CastMember as CastMemberT } from "@studio/schema";
import type { ReactNode } from "react";
import { C, INK } from "../theme";

/** Shared bits for the Library galleries in Remotion Studio. */

export const LABEL: React.CSSProperties = { fontFamily: "Fredoka, sans-serif", fontWeight: 700, color: INK, fontSize: 30 };

/** A parsed cast member from a partial look (defaults filled in by the schema). */
export const cast = (look: Partial<CastMemberT> & { color: string }): CastMemberT => CastMember.parse({ name: "x", ...look });

/** A rounded card with a ground line and a label, drawn inside an SVG. */
export function Cell({ x, y, w, h, title, sub, dark = false, children }: { x: number; y: number; w: number; h: number; title: string; sub?: string; dark?: boolean; children: ReactNode }) {
  const bg = dark ? "#16132b" : "#fffaf0";
  const fg = dark ? "#f3eefe" : INK;
  const edge = dark ? "#2e2950" : C.wallShade;
  return (
    <svg x={x} y={y} width={w} height={h} overflow="hidden">
      <rect x={6} y={6} width={w - 12} height={h - 12} rx={18} fill={bg} stroke={edge} strokeWidth={3} />
      <path d={`M 30 ${h - 54} L ${w - 30} ${h - 54}`} stroke={edge} strokeWidth={4} strokeLinecap="round" />
      {children}
      <text x={w / 2} y={h - (sub ? 26 : 18)} textAnchor="middle" style={{ ...LABEL, fontSize: Math.min(26, w / 9) }} fill={fg}>{title}</text>
      {sub && <text x={w / 2} y={h - 6} textAnchor="middle" style={{ ...LABEL, fontSize: Math.min(15, w / 15), opacity: 0.7 }} fill={fg}>{sub}</text>}
    </svg>
  );
}
