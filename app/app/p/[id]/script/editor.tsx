"use client";
import { allLines, countWords, NarrationFile, type Comment, type ScriptLine, type Source } from "@studio/schema";
import { checkStory, tensionGraph, type Finding } from "@studio/story";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { JobError, JobProgress } from "@/components/job-progress";
import { ReviewScores } from "@/components/review-scores";
import { TensionGraph } from "@/components/tension-graph";
import { button, field, paperButton } from "@/components/ui";
import { UsageLine } from "@/components/usage-line";
import { call, JobResponse, type ProjectDetail } from "@/lib/api";
import { clock } from "@/lib/format";
import { TONES } from "@/lib/tones";
import { useProject } from "@/lib/use-project";
import { CommentBlock } from "./comment-block";
import { LineRow } from "./line-row";

type Save = { state: "saved" | "dirty" | "saving" | "error"; message?: string };
const Saved = z.object({ narration: NarrationFile }).loose();

export function ScriptEditor({ initial }: { initial: ProjectDetail }) {
  const { project: p, setProject, reload, active, lastFinished } = useProject(initial);
  const [draft, setDraft] = useState(initial.narration!);
  const [save, setSave] = useState<Save>({ state: "saved" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [direction, setDirection] = useState("");
  const [pending, setPending] = useState<{ lineIds: string[]; direction: string } | null>(null);
  const [showDecided, setShowDecided] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);
  const directionRef = useRef<HTMLInputElement>(null);

  const scriptLocked = Boolean(draft.lockedAt);
  const loopmap = p.loopmap!;

  // A newer narration from the worker (an accepted comment, a lock) replaces the draft unless there are unsaved edits.
  useEffect(() => {
    if (p.narration && !dirty.current && p.narration.updatedAt !== draft.updatedAt) setDraft(p.narration);
  }, [p.narration]);

  // ---- saving
  const flush = useCallback(async (n: NarrationFile = draft) => {
    if (!dirty.current) return true;
    setSave({ state: "saving" });
    try {
      const r = await call(`/projects/${p.id}/narration`, Saved, { method: "PUT", body: { narration: n } });
      dirty.current = false;
      setDraft((d) => (d === n ? r.narration : { ...d, updatedAt: r.narration.updatedAt }));
      setProject((x) => ({ ...x, narration: r.narration }));
      setSave({ state: "saved" });
      return true;
    } catch (e) {
      setSave({ state: "error", message: (e as Error).message });
      return false;
    }
  }, [draft, p.id, setProject]);

  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => void flush(), 700);
    return () => clearTimeout(t);
  }, [draft, flush]);

  const edit = useCallback((id: string, patch: Partial<ScriptLine>) => {
    dirty.current = true;
    setSave({ state: "dirty" });
    setDraft((d) => ({ ...d, loops: d.loops.map((l) => ({ ...l, lines: l.lines.map((x) => (x.id === id ? { ...x, ...patch } : x)) })) }));
  }, []);

  // ---- live checks
  const report = useMemo(() => checkStory(loopmap, draft, { budget: p.budget, wpm: p.wpm }), [loopmap, draft, p.budget, p.wpm]);
  const graph = useMemo(() => tensionGraph(loopmap, report), [loopmap, report]);
  const order = useMemo(() => allLines(draft).map((l) => l.id), [draft]);
  const text = useMemo(() => new Map(allLines(draft).map((l) => [l.id, l.text])), [draft]);
  const linesById = useMemo(() => new Map(allLines(draft).map((l) => [l.id, l])), [draft]);
  const findingsByLine = useMemo(() => {
    const m = new Map<string, Finding[]>();
    for (const f of report.findings) {
      // show a finding on its lines only when it is about a line or two; loop-wide ones live in the rail
      if (f.lineIds.length === 0 || f.lineIds.length > 2) continue;
      for (const id of f.lineIds) (m.get(id) ?? m.set(id, []).get(id)!).push(f);
    }
    return m;
  }, [report]);
  const checked = useMemo(() => {
    const m = new Map<string, { claim: string; sources: Source[] }[]>();
    for (const c of p.factcheck?.claims ?? []) if (c.verdict === "confirmed") for (const id of c.lineIds) (m.get(id) ?? m.set(id, []).get(id)!).push({ claim: c.claim, sources: c.sources });
    return m;
  }, [p.factcheck]);

  // ---- comments anchored under the last of their lines
  // a locked script can't take suggestions, so open ones stay out of the way until it's unlocked
  const visible = p.comments.filter((c) => (c.status === "open" && !scriptLocked) || (showDecided && c.status !== "superseded" && c.status !== "open"));
  const anchored = useMemo(() => {
    const m = new Map<string, Comment[]>();
    for (const c of visible) {
      // under the last line of a run of adjacent lines; under the first when the lines are scattered
      const idx = c.lineIds.map((id) => order.indexOf(id)).filter((i) => i >= 0).sort((a, b) => a - b);
      const adjacent = idx.every((v, i) => i === 0 || v === idx[i - 1]! + 1);
      const at = order[adjacent ? idx.at(-1)! : idx[0]!]!;
      (m.get(at) ?? m.set(at, []).get(at)!).push(c);
    }
    return m;
  }, [visible, order]);
  const openBlockers = p.comments.filter((c) => c.status === "open" && c.severity === "blocker");
  const flagged = p.comments.filter((c) => c.status === "open" && c.source !== "rewrite").length;
  const decidedCount = p.comments.filter((c) => c.status === "accepted" || c.status === "rejected").length;

  // ---- selection
  const select = useCallback((id: string, e: React.MouseEvent | React.KeyboardEvent) => {
    setSelected((prev) => {
      const next = new Set(e.metaKey || e.ctrlKey || e.shiftKey ? prev : []);
      if (e.shiftKey && anchor) {
        const a = Math.min(order.indexOf(anchor), order.indexOf(id));
        const b = Math.max(order.indexOf(anchor), order.indexOf(id));
        order.slice(a, b + 1).forEach((x) => next.add(x));
      } else if (prev.has(id) && (prev.size === 1 || e.metaKey || e.ctrlKey)) next.delete(id);
      else next.add(id);
      return next;
    });
    setAnchor(id);
  }, [anchor, order]);
  const selectedIds = order.filter((id) => selected.has(id));
  const lockedById = useMemo(() => new Map(allLines(draft).map((l) => [l.id, l.locked])), [draft]);
  const selectedLocked = selectedIds.filter((id) => lockedById.get(id));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selected.size && !(e.target instanceof HTMLInputElement)) setSelected(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.size]);

  const navigate = useCallback((id: string, dir: -1 | 1) => {
    const next = order[order.indexOf(id) + dir];
    if (next) document.getElementById(`t-${next}`)?.focus();
  }, [order]);

  const jump = useCallback((ids: string[]) => {
    const first = ids[0];
    if (!first) return;
    const el = document.getElementById(first);
    el?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    for (const id of ids) {
      const row = document.getElementById(id);
      row?.classList.remove("flash");
      void row?.offsetWidth;
      row?.classList.add("flash");
    }
  }, []);

  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) setTimeout(() => jump([id]), 50);
  }, [jump]);

  // ---- actions
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      if (!(await flush())) throw new Error("Your last edit couldn't be saved; fix that first.");
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  const decide = (id: string, d: "accept" | "reject") =>
    run(async () => {
      const r = await call(`/projects/${p.id}/comments/${id}/${d}`, Saved, { body: {} });
      setDraft(r.narration);
      await reload();
    });
  const applyTone = (tone: (typeof TONES)[number]) => {
    for (const id of selectedIds) if (!lockedById.get(id)) edit(id, { energy: tone.energy, delivery: tone.delivery });
  };
  const setLineLocks = (locked: boolean) => {
    for (const id of selectedIds) edit(id, { locked });
  };
  const rewrite = (ids: string[], dir: string) =>
    run(async () => {
      await call(`/projects/${p.id}/rewrite`, JobResponse, { body: { lineIds: ids, direction: dir } });
      setPending({ lineIds: ids, direction: dir });
      setDirection("");
      await reload();
    });
  const startRewriteFrom = (c: Comment) => {
    setSelected(new Set(c.lineIds));
    setDirection(c.message || c.title);
    setTimeout(() => directionRef.current?.focus(), 0);
  };
  const job = (path: string) => run(async () => { await call(`/projects/${p.id}/${path}`, JobResponse, { body: {} }); await reload(); });
  const lock = (force = false) =>
    run(async () => {
      const r = await call(`/projects/${p.id}/lock`, Saved, { body: force ? { force: true } : {} });
      setDraft(r.narration);
      setSelected(new Set());
      await reload();
    });
  const unlock = () => run(async () => { const r = await call(`/projects/${p.id}/unlock`, Saved, { body: {} }); setDraft(r.narration); await reload(); });

  useEffect(() => {
    if (pending && !active.some((j) => j.kind === "rewrite")) setPending(null);
  }, [active, pending]);

  const cancel = (j: { id: string }) => void call(`/jobs/${j.id}/cancel`, JobResponse, { body: {} }).catch(() => {});
  const errors = report.findings.filter((f) => f.level === "error");
  const warnings = report.findings.filter((f) => f.level === "warning");
  const canLock = !errors.length && !openBlockers.length;
  const pendingAnchor = pending ? [...pending.lineIds].sort((a, b) => order.indexOf(a) - order.indexOf(b)).at(-1) : undefined;

  return (
    <div className="mx-auto max-w-[1440px] px-6 pb-40 pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link href={`/p/${p.id}`} className="eyebrow text-faint hover:text-muted">← {p.title ?? p.id}</Link>
          <h1 className="title-card mt-1 text-title">Script</h1>
        </div>
        <p className="text-sm text-muted" aria-live="polite">
          {save.state === "saved" && "All changes saved"}
          {save.state === "dirty" && "Editing…"}
          {save.state === "saving" && "Saving…"}
          {save.state === "error" && <span className="text-danger">Couldn't save: {save.message}</span>}
        </p>
      </div>

      {(active.length > 0 || lastFinished?.status === "failed" || error) && (
        <div className="sticky top-14 z-20 -mx-6 mt-4 space-y-3 border-b border-hairline bg-room/95 px-6 py-3 backdrop-blur-[2px]">
          <JobProgress jobs={active} onCancel={cancel} />
          {!active.length && <JobError job={lastFinished} />}
          {error && <p role="alert" className="whitespace-pre-wrap text-sm text-danger">{error}</p>}
        </div>
      )}

      <div className="mt-6 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_23rem]">
        {/* ---------------- the page */}
        <article aria-label="Narration" className="paper rounded-lg px-3 py-6 shadow-[0_1px_0_0_var(--color-paper-edge)] sm:px-6">
          {scriptLocked && (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md bg-ok-tint px-4 py-3 text-sm">
              <p className="text-ink">
                <span className="font-semibold text-ok-ink">✓ Locked</span> {new Date(draft.lockedAt!).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}. <span className="text-ink-muted">script.json is ready for the voice:</span>{" "}
                <code className="rounded bg-paper px-1.5 py-0.5 font-mono text-xs">pnpm voice {p.id}</code>
              </p>
              <button type="button" onClick={unlock} disabled={busy} className={paperButton.secondary}>Unlock to edit</button>
            </div>
          )}
          {draft.loops.map((loop) => {
            const plan = loopmap.loops.find((l) => l.id === loop.id);
            const stats = report.loops.find((l) => l.loopId === loop.id);
            const over = stats && stats.words > stats.budget * 1.1;
            return (
              <section key={loop.id} aria-labelledby={`h-${loop.id}`} className="mb-8 last:mb-0">
                <header className="mb-2 grid grid-cols-[4.25rem_minmax(0,1fr)_auto] gap-x-3 border-b border-paper-edge px-2 pb-2">
                  <h2 id={`h-${loop.id}`} className="tabular pt-0.5 text-sm font-bold text-ink">{loop.id}</h2>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{plan?.title}</p>
                    {plan && <p className="mt-0.5 text-xs text-ink-muted">Asks: {plan.question}</p>}
                  </div>
                  {stats && (
                    <p className={`tabular pt-0.5 text-xs ${over ? "font-semibold text-danger-ink" : "text-ink-muted"}`}>
                      {stats.words}/{stats.budget}w · {clock(stats.seconds)}
                    </p>
                  )}
                </header>
                {loop.lines.map((line) => (
                  <Fragment key={line.id}>
                    <LineRow
                      line={line}
                      locked={scriptLocked || line.locked}
                      scriptLocked={scriptLocked}
                      selected={selected.has(line.id)}
                      findings={findingsByLine.get(line.id) ?? []}
                      checked={checked.get(line.id) ?? []}
                      words={countWords(line.text)}
                      onChange={edit}
                      onSelect={select}
                      onNavigate={navigate}
                    />
                    {anchored.get(line.id)?.map((c) => (
                      <CommentBlock key={c.id} comment={c} current={linesById} scriptLocked={scriptLocked} busy={busy} onDecide={decide} onRewrite={startRewriteFrom} />
                    ))}
                    {pending && pendingAnchor === line.id && (
                      <div role="status" className="my-2 ml-[4.75rem] mr-2 overflow-hidden rounded-md bg-paper-shade px-4 py-3 ring-1 ring-inset ring-paper-edge">
                        <p className="text-xs font-semibold text-ink">↻ Claude is rewriting {pending.lineIds.join(", ")}</p>
                        <p className="mt-0.5 text-sm text-ink-muted">“{pending.direction}”</p>
                        <div className="mt-2.5 h-0.5 overflow-hidden rounded-full bg-paper-edge" aria-hidden>
                          <div className="h-full w-2/5 rounded-full bg-ink/60" style={{ animation: "sweep 1.8s var(--ease-out-quart) infinite" }} />
                        </div>
                      </div>
                    )}
                  </Fragment>
                ))}
              </section>
            );
          })}
        </article>

        {/* ---------------- the rail */}
        <aside aria-label="Checks and review" className="space-y-8 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:pr-1">
          <section aria-labelledby="graph-h">
            <div className="flex items-baseline justify-between">
              <h2 id="graph-h" className="eyebrow text-faint">Tension</h2>
              <span className="tabular text-xs text-faint">{clock(report.seconds)}</span>
            </div>
            <div className="mt-2 rounded-md bg-raised px-3 pb-2 pt-4">
              <TensionGraph graph={graph} height={120} compact lineText={(id) => text.get(id)} onPick={(id) => jump([id])} highlight={selected} />
            </div>
          </section>

          <section aria-labelledby="budget-h">
            <h2 id="budget-h" className="eyebrow text-faint">Word budget</h2>
            <p className="tabular mt-2 text-sm">
              <span className={report.words > report.budget * 1.05 ? "font-semibold text-danger" : "text-text"}>{report.words.toLocaleString("en-GB")}</span>
              <span className="text-muted"> / {report.budget.toLocaleString("en-GB")} words</span>
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-lifted" aria-hidden>
              <div className={`h-full rounded-full ${report.words > report.budget * 1.05 ? "bg-danger" : "bg-text/70"}`} style={{ width: `${Math.min(100, (report.words / report.budget) * 100)}%` }} />
            </div>
            <ul className="tabular mt-3 grid grid-cols-4 gap-x-3 gap-y-1 text-xs">
              {report.loops.map((l) => {
                const over = l.words > l.budget * 1.1;
                return (
                  <li key={l.loopId}>
                    <button type="button" onClick={() => jump([`${l.loopId}.1`])} className={`hover:text-text ${over ? "font-semibold text-danger" : "text-muted"}`}>
                      {l.loopId} {l.words}/{l.budget}{over ? " ▲" : ""}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="checks-h">
            <h2 id="checks-h" className="eyebrow text-faint">Loop checks</h2>
            {!report.findings.length && <p className="mt-2 text-sm text-ok">✓ Every loop has stakes, a question, a fair head fake and a rehook, and no gap over 20 s.</p>}
            <ul className="mt-2 space-y-1.5">
              {[...errors, ...warnings].map((f, i) => (
                <li key={i}>
                  <button type="button" onClick={() => jump(f.lineIds)} disabled={!f.lineIds.length} className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-raised disabled:cursor-default disabled:hover:bg-transparent ${f.level === "error" ? "text-text" : "text-muted"}`}>
                    <span className={f.level === "error" ? "text-danger" : "text-caution"} aria-hidden>{f.level === "error" ? "✗ " : "! "}</span>
                    <span className="sr-only">{f.level}: </span>
                    {f.message}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="review-h">
            <h2 id="review-h" className="eyebrow text-faint">Review</h2>
            {p.history.length ? <ReviewScores history={p.history} compact /> : <p className="mt-2 text-sm text-muted">The fact-checker and the critic haven't read this yet.</p>}
            {!scriptLocked && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => job("review")} disabled={busy || active.length > 0} className={button.secondary}>{p.history.length ? "Review again" : "Run review"}</button>
                {flagged > 0 && <button type="button" onClick={() => job("fix")} disabled={busy || active.length > 0} className={button.quiet}>Rewrite flagged lines</button>}
              </div>
            )}
            {decidedCount > 0 && (
              <label className="mt-3 flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={showDecided} onChange={(e) => setShowDecided(e.target.checked)} className="accent-[var(--color-accent)]" />
                Show {decidedCount} decided comment{decidedCount > 1 ? "s" : ""}
              </label>
            )}
          </section>

          <section aria-labelledby="lock-h" className="border-t border-hairline pt-6">
            <h2 id="lock-h" className="eyebrow text-faint">Lock</h2>
            {scriptLocked ? (
              <p className="mt-2 text-sm text-muted">Locked lines are never rewritten. Unlock on the page to edit.</p>
            ) : (
              <>
                <p className="mt-2 text-sm text-muted">
                  {canLock ? "Ready. Locking writes script.json for the voice." : `${errors.length ? `${errors.length} loop check error${errors.length > 1 ? "s" : ""}` : ""}${errors.length && openBlockers.length ? " and " : ""}${openBlockers.length ? `${openBlockers.length} open review blocker${openBlockers.length > 1 ? "s" : ""}` : ""} first.`}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button type="button" onClick={() => lock()} disabled={!canLock || busy || active.length > 0} className={button.primary}>Lock script</button>
                  {!canLock && <button type="button" onClick={() => lock(true)} disabled={busy || active.length > 0} className={button.quiet}>Lock anyway</button>}
                </div>
              </>
            )}
          </section>

          <div className="border-t border-hairline pt-4">
            <UsageLine usage={p.usage} />
            <p className="mt-2 text-xs text-faint">Click a line id to select it; shift-click for a range. Alt + ↑/↓ moves between lines.</p>
          </div>
        </aside>
      </div>

      {/* ---------------- selection toolbar */}
      {selectedIds.length > 0 && !scriptLocked && (
        <div role="toolbar" aria-label="Selected lines" className="fixed inset-x-0 bottom-4 z-40 mx-auto w-[min(60rem,calc(100%-2rem))] rounded-lg bg-lifted px-4 py-3 shadow-2xl ring-1 ring-edge/60">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <p className="tabular text-sm font-semibold text-text">
              {selectedIds.length} line{selectedIds.length > 1 ? "s" : ""} <span className="font-normal text-muted">{selectedIds.length > 3 ? `${selectedIds[0]}–${selectedIds.at(-1)}` : selectedIds.join(", ")}</span>
            </p>
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Tone">
              <span className="eyebrow mr-1 text-faint">Tone</span>
              {TONES.map((t) => (
                <button key={t.id} type="button" onClick={() => applyTone(t)} title={`energy ${t.energy} · ${t.delivery}`} className="rounded px-2 py-1 text-sm text-muted ring-1 ring-inset ring-hairline hover:bg-raised hover:text-text">{t.label}</button>
              ))}
            </div>
            <button type="button" onClick={() => setLineLocks(selectedLocked.length !== selectedIds.length)} className={button.quiet}>{selectedLocked.length === selectedIds.length ? "Unlock lines" : "Lock lines"}</button>
            <button type="button" onClick={() => setSelected(new Set())} className={`${button.quiet} ml-auto`}>Clear <span className="text-faint">esc</span></button>
          </div>
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (direction.trim()) void rewrite(selectedIds, direction.trim()); }}>
            <label htmlFor="direction" className="sr-only">Rewrite direction</label>
            <input ref={directionRef} id="direction" value={direction} onChange={(e) => setDirection(e.target.value)} placeholder={selectedLocked.length ? `${selectedLocked.join(", ")} locked: unlock to rewrite` : "Rewrite with direction: “make this the shocking reveal”, “add a joke”, “shorter”"} disabled={selectedLocked.length > 0} className={`${field} py-2`} />
            <button type="submit" disabled={!direction.trim() || busy || selectedLocked.length > 0 || active.length > 0} className={button.primary}>Rewrite</button>
          </form>
        </div>
      )}
    </div>
  );
}
