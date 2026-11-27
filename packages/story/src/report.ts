import type { CheckReport } from "./check";

const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** The checker's report as terminal text (`pnpm story check`). */
export function formatReport(r: CheckReport, label = "story"): string {
  const out: string[] = [];
  const pct = Math.round((r.words / r.budget) * 100);
  out.push(`${r.ok ? "✓" : "✗"} ${label}: ${r.words} / ${r.budget} words (${pct}%), about ${time(r.seconds)} · ${r.errors} error${r.errors === 1 ? "" : "s"}, ${r.warnings} warning${r.warnings === 1 ? "" : "s"}`);
  out.push("");
  out.push("  loop  words/budget  time         title");
  for (const l of r.loops) {
    const flag = l.words > l.budget * 1.1 ? " ✗ over" : l.words < l.budget * 0.8 ? " ! short" : "";
    out.push(`  ${l.loopId.padEnd(5)} ${`${l.words}/${l.budget}`.padEnd(13)} ${`${time(l.start)}–${time(l.end)}`.padEnd(12)} ${l.title}${flag}`);
  }
  const long = r.gaps.filter((g) => g.end - g.start > 20);
  out.push("");
  out.push(long.length ? `  open-question gaps over 20 s: ${long.map((g) => `${time(g.start)}–${time(g.end)}`).join(", ")}` : "  no open-question gap over 20 s");
  for (const level of ["error", "warning"] as const) {
    const items = r.findings.filter((f) => f.level === level);
    if (!items.length) continue;
    out.push("");
    out.push(`  ${level === "error" ? "Errors" : "Warnings"}:`);
    for (const f of items) out.push(`  ${level === "error" ? "✗" : "!"} [${f.code}] ${f.message}`);
  }
  return out.join("\n");
}
