"use client";
import type { VersionDiff } from "@studio/schema";
import { GitCompareArrows, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { call } from "@/lib/api";
import { DiffResponse, type VersionSummary } from "@/lib/editor";
import { ago, clock } from "@/lib/format";
import { small } from "./bits";

const KIND: Record<VersionSummary["kind"], string> = { start: "Start", edit: "Edit", outside: "Outside the editor", rollback: "Rollback" };

/** One line saying what a version changed, from its stored diff. */
function summary(v: VersionSummary): string {
  const c = v.changes;
  if (!c) return v.kind === "start" ? "Where the editing started" : "";
  const parts: string[] = [];
  const sc = c.scenes.added.length + c.scenes.removed.length + Object.keys(c.scenes.changed).length;
  if (sc) parts.push(`${sc} scene${sc > 1 ? "s" : ""}`);
  if (c.scenes.reordered) parts.push("reordered");
  const ln = c.lines.added.length + c.lines.removed.length + Object.keys(c.lines.changed).length;
  if (ln) parts.push(`${ln} line${ln > 1 ? "s" : ""}`);
  if (c.voiced.length) parts.push(`${c.voiced.length} re-voiced`);
  const cues = c.cues.added.length + c.cues.removed.length;
  if (cues) parts.push(`${cues} sound${cues > 1 ? "s" : ""}`);
  return parts.join(" · ") || "No change to the picture or the voice";
}

/**
 * Every edit is a version. Tick two to compare them; roll back to any one
 * (that is a new version too, so nothing is lost). ⌘Z rolls back one step.
 */
export function VersionsPanel({ id, head, versions, busy, rollback }: { id: string; head: number | null; versions: VersionSummary[]; busy: boolean; rollback: (n: number) => void }) {
  const [pair, setPair] = useState<number[]>([]);
  const [diff, setDiff] = useState<{ a: number; b: number; diff: VersionDiff } | { error: string } | null>(null);
  const [a, b] = [...pair].sort((x, y) => x - y);

  useEffect(() => {
    if (a === undefined || b === undefined) return setDiff(null);
    let live = true;
    call(`/projects/${id}/versions/diff?a=${a}&b=${b}`, DiffResponse).then(
      (r) => live && setDiff({ a, b, diff: r.diff }),
      (e: Error) => live && setDiff({ error: e.message }),
    );
    return () => void (live = false);
  }, [id, a, b]);

  const toggle = (n: number) => setPair((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p.slice(-1), n]));
  const list = [...versions].reverse();

  if (!versions.length) return <p className="text-sm text-muted">No versions yet. Your first edit records where the video started, then the edit.</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Tick two versions to see what changed between them. Rolling back makes a new version; nothing is voiced or drawn again for it.
      </p>

      {diff && "error" in diff && <p role="alert" className="text-sm text-danger">{diff.error}</p>}
      {diff && "diff" in diff && <Compare a={diff.a} b={diff.b} diff={diff.diff} onClose={() => setPair([])} />}

      <ol className="space-y-1" aria-label="Versions, newest first">
        {list.map((v) => {
          const current = v.n === head;
          const ticked = pair.includes(v.n);
          return (
            <li key={v.n} className={`group rounded-md px-2 py-2 ${current ? "bg-lifted" : "hover:bg-lifted/60"}`}>
              <div className="flex items-start gap-2.5">
                <input type="checkbox" checked={ticked} onChange={() => toggle(v.n)} aria-label={`Compare version ${v.n}`} className="mt-1 size-4 shrink-0 cursor-pointer accent-[var(--color-accent)]" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline gap-2 text-sm">
                    <span className="tabular font-semibold">v{v.n}</span>
                    <span className="min-w-0 truncate" title={v.label}>
                      {v.label}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-faint">
                    {KIND[v.kind]}
                    {v.restores ? ` to v${v.restores}` : ""} · {ago(v.createdAt)} · {summary(v)}
                  </p>
                </div>
                {current ? (
                  <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">Current</span>
                ) : (
                  <button type="button" disabled={busy} onClick={() => rollback(v.n)} className={`${small.quiet} shrink-0 opacity-70 group-hover:opacity-100 focus-visible:opacity-100`} aria-label={`Roll back to version ${v.n}`}>
                    <RotateCcw aria-hidden size={13} /> Roll back
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Compare({ a, b, diff, onClose }: { a: number; b: number; diff: VersionDiff; onClose: () => void }) {
  const changed = Object.entries(diff.scenes.changed);
  const lines = Object.entries(diff.lines.changed);
  const rows: [string, React.ReactNode][] = [];
  if (diff.scenes.added.length) rows.push(["Scenes added", diff.scenes.added.join(", ")]);
  if (diff.scenes.removed.length) rows.push(["Scenes removed", diff.scenes.removed.join(", ")]);
  if (changed.length) rows.push(["Scenes changed", <Fields key="s" entries={changed} />]);
  if (diff.scenes.reordered) rows.push(["Order", "scenes moved"]);
  if (diff.lines.added.length) rows.push(["Lines added", diff.lines.added.join(", ")]);
  if (diff.lines.removed.length) rows.push(["Lines cut", diff.lines.removed.join(", ")]);
  if (lines.length) rows.push(["Lines changed", <Fields key="l" entries={lines} />]);
  if (diff.voiced.length) rows.push(["New takes", diff.voiced.join(", ")]);
  if (diff.cues.added.length) rows.push(["Sounds added", <Cues key="ca" list={diff.cues.added} />]);
  if (diff.cues.removed.length) rows.push(["Sounds removed", <Cues key="cr" list={diff.cues.removed} />]);
  if (diff.cues.moved.length) rows.push(["Sounds moved", `${diff.cues.moved.length} (they follow the voice)`]);
  const from = diff.durationS.from;
  const to = diff.durationS.to;
  return (
    <section aria-label={`Version ${a} against version ${b}`} className="rounded-md bg-room p-3 ring-1 ring-inset ring-accent/50">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <GitCompareArrows aria-hidden size={14} className="text-accent" /> v{a} → v{b}
        </h3>
        <button type="button" onClick={onClose} className={small.quiet}>
          Close
        </button>
      </div>
      {rows.length ? (
        <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="min-w-0">{v}</dd>
            </div>
          ))}
          {from !== null && to !== null && from !== to && (
            <div className="contents">
              <dt className="text-muted">Length</dt>
              <dd className="tabular">
                {clock(from)} → {clock(to)} ({to > from ? "+" : ""}
                {(to - from).toFixed(1)} s)
              </dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="text-sm text-muted">The two versions are the same.</p>
      )}
    </section>
  );
}

const Fields = ({ entries }: { entries: [string, string[]][] }) => (
  <ul className="space-y-0.5">
    {entries.map(([id, f]) => (
      <li key={id}>
        <span className="font-semibold tabular">{id}</span> <span className="text-faint">{f.join(", ")}</span>
      </li>
    ))}
  </ul>
);

const Cues = ({ list }: { list: string[] }) => (
  <ul className="space-y-0.5">
    {list.slice(0, 6).map((c) => (
      <li key={c} className="truncate" title={c}>
        {c.replace(/^\w+: /, "")}
      </li>
    ))}
    {list.length > 6 && <li className="text-faint">and {list.length - 6} more</li>}
  </ul>
);
