import type { ReviewRound } from "@studio/schema";

const DIMS = ["stakes", "question", "surprise", "rehook"] as const;

function cell(n: number) {
  return n <= 2 ? "text-danger font-semibold" : n >= 4 ? "text-ok" : "text-text";
}

/** Critic scores per loop, round by round, so the effect of fixes is visible. */
export function ReviewScores({ history, compact = false }: { history: ReviewRound[]; compact?: boolean }) {
  const rounds = compact ? history.slice(-2) : history;
  const loops = [...new Set(rounds.flatMap((r) => r.scores.map((s) => s.loopId)))];
  const last = history.at(-1);
  if (!last) return null;
  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-muted">
        Round {last.round}: <span className={last.passed ? "font-semibold text-ok" : "font-semibold text-danger"}>{last.passed ? "✓ passed" : "✗ failed"}</span>
        {" · "}mean <span className="tabular text-text">{last.mean.toFixed(2)}</span>/5
        {history.length > 1 && <span className="tabular"> (was {history.at(-2)!.mean.toFixed(2)})</span>}
        {" · "}
        {last.factual ? `${last.facts.confirmed} facts confirmed, ${last.facts.wrong} wrong, ${last.facts.unverifiable} unverifiable` : `${last.facts.issues} consistency issue${last.facts.issues === 1 ? "" : "s"}`}
      </p>
      <div className="overflow-x-auto">
        <table className="tabular w-full text-sm">
          <caption className="sr-only">Critic scores, 1 to 5, per loop and round</caption>
          <thead>
            <tr className="text-left text-xs text-faint">
              <th scope="col" className="py-1.5 pr-4 font-semibold">Loop</th>
              {rounds.map((r) => (
                <th key={r.round} scope="colgroup" colSpan={4} className="py-1.5 pr-4 font-semibold">Round {r.round}</th>
              ))}
            </tr>
            <tr className="text-left text-xs text-faint">
              <th />
              {rounds.flatMap((r) => DIMS.map((d) => <th key={r.round + d} scope="col" className="pb-2 pr-3 font-normal" title={d}>{compact ? d[0]!.toUpperCase() : d}</th>))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {loops.map((l) => (
              <tr key={l}>
                <th scope="row" className="py-1.5 pr-4 text-left font-semibold text-text">{l}</th>
                {rounds.flatMap((r) => {
                  const s = r.scores.find((x) => x.loopId === l);
                  return DIMS.map((d) => <td key={r.round + d} className={`py-1.5 pr-3 ${s ? cell(s[d]) : "text-faint"}`}>{s ? s[d] : "–"}</td>);
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!compact && (
        <ul className="space-y-1 text-sm text-muted">
          {last.scores.filter((s) => Math.min(s.stakes, s.question, s.surprise, s.rehook) <= 3).map((s) => (
            <li key={s.loopId}><span className="tabular font-semibold text-text">{s.loopId}</span> {s.note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
