"use client";
import type { Comment, ScriptLine } from "@studio/schema";
import { paperButton } from "@/components/ui";

const SOURCE: Record<Comment["source"], { word: string; mark: string }> = {
  factcheck: { word: "Fact-check", mark: "✗" },
  consistency: { word: "Consistency", mark: "!" },
  critic: { word: "Critic", mark: "•" },
  rewrite: { word: "Rewrite", mark: "↻" },
};

/**
 * A reviewer finding or a Claude rewrite, pinned under the lines it is about.
 * The proposal is a diff; only Accept changes the script. A proposal whose
 * line has been edited since says so.
 */
export function CommentBlock({ comment: c, current, scriptLocked, busy, onDecide, onRewrite }: { comment: Comment; current: Map<string, ScriptLine>; scriptLocked: boolean; busy: boolean; onDecide: (id: string, d: "accept" | "reject") => void; onRewrite: (c: Comment) => void }) {
  const open = c.status === "open";
  const stale = c.proposal.filter((p) => current.has(p.id) && current.get(p.id)!.text !== p.before);
  const meta = SOURCE[c.source];
  const kind = c.source === "factcheck" ? (c.title.startsWith("Wrong") ? "wrong fact" : "unverifiable") : null;

  return (
    <aside aria-label={`${meta.word} on ${c.lineIds.join(", ")}`} className={`my-2 ml-[4.75rem] mr-2 rounded-md px-4 py-3 ring-1 ring-inset ${open ? "bg-paper-shade ring-paper-edge" : "bg-transparent ring-paper-edge/70 opacity-75"}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
        <span className={`font-semibold ${c.severity === "blocker" ? "text-danger-ink" : "text-ink"}`}>
          <span aria-hidden>{meta.mark} </span>
          {meta.word}
          {kind && ` · ${kind}`}
        </span>
        <span className="tabular text-ink-muted">{c.lineIds.join(", ")}</span>
        {c.severity === "blocker" && open && <span className="eyebrow text-danger-ink">blocks lock</span>}
        {!open && <span className="eyebrow text-ink-muted">{c.status}</span>}
        {c.answers.length > 0 && <span className="text-ink-muted">answers {c.answers.join(", ")}</span>}
      </div>
      <p className="mt-1 text-sm font-semibold text-ink">{c.title.replace(/^(Wrong|Unverifiable): /, "")}</p>
      {c.message && <p className="mt-0.5 text-sm text-ink-muted">{c.message}</p>}

      {c.proposal.length > 0 && (
        <ol className="mt-2.5 space-y-2">
          {c.proposal.map((p) => (
            <li key={p.id} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-2 text-sm">
              <span className="tabular row-span-2 pt-0.5 text-xs font-semibold text-ink-muted">{p.id}</span>
              <del className="rounded-sm bg-danger-tint px-1.5 py-0.5 text-danger-ink decoration-danger-ink/60">{p.before}</del>
              <ins className="mt-1 rounded-sm bg-ok-tint px-1.5 py-0.5 text-ink no-underline">
                {p.text}
                {(() => {
                  const now = current.get(p.id);
                  const changes = [
                    p.energy !== undefined && p.energy !== now?.energy ? `energy ${now?.energy ?? "?"} → ${p.energy}` : "",
                    p.delivery && p.delivery !== now?.delivery ? p.delivery : "",
                    p.beats && now && p.beats.join() !== now.beats.join() ? `beats: ${p.beats.join(", ") || "none"}` : "",
                  ].filter(Boolean);
                  return changes.length ? <span className="tabular ml-2 text-xs text-ink-muted">{changes.join(" · ")}</span> : null;
                })()}
              </ins>
            </li>
          ))}
        </ol>
      )}
      {c.sources.length > 0 && (
        <p className="mt-2 text-xs text-ink-muted">
          Source{c.sources.length > 1 ? "s" : ""}:{" "}
          {c.sources.map((s, i) => (
            <span key={s.url}>
              {i > 0 && ", "}
              <a href={s.url} target="_blank" rel="noreferrer" className="text-ink underline decoration-ink-muted underline-offset-2 hover:decoration-ink">{s.title || new URL(s.url).hostname}↗</a>
            </span>
          ))}
          {c.source === "factcheck" && c.proposal.length > 0 && " · kept on the line when you accept"}
        </p>
      )}
      {stale.length > 0 && open && <p className="mt-2 text-xs text-caution-ink">! {stale.map((s) => s.id).join(", ")} changed since this was written. Accepting replaces your edit.</p>}

      {open && !scriptLocked && (
        <div className="mt-3 flex flex-wrap gap-2">
          {c.proposal.length > 0 ? (
            <button type="button" disabled={busy} onClick={() => onDecide(c.id, "accept")} className={paperButton.primary}>Accept</button>
          ) : (
            <button type="button" disabled={busy} onClick={() => onRewrite(c)} className={paperButton.primary}>Rewrite these lines</button>
          )}
          <button type="button" disabled={busy} onClick={() => onDecide(c.id, "reject")} className={paperButton.quiet}>{c.proposal.length ? "Reject" : "Dismiss"}</button>
        </div>
      )}
    </aside>
  );
}
