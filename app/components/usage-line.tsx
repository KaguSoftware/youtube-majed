import type { ProjectDetail } from "@/lib/api";
import { kTokens } from "@/lib/format";

const LABEL: Record<string, string> = { options: "options", loopmap: "loop map", narration: "narration", rewrite: "rewrites", factcheck: "fact-check", critic: "critic" };

/** Claude usage for this story: calls, tokens, time, and the API-equivalent price the CLI reports (nothing is billed per call on the subscription). */
export function UsageLine({ usage }: { usage: ProjectDetail["usage"] }) {
  const t = usage.total;
  if (!t.calls) return <p className="text-xs text-faint">No Claude calls yet.</p>;
  return (
    <details className="text-xs text-faint">
      <summary className="cursor-pointer select-none hover:text-muted">
        <span className="tabular">
          Claude: {t.calls} call{t.calls === 1 ? "" : "s"} · {kTokens(t.outputTokens)} tokens out · {Math.round(t.durationMs / 1000)} s · ≈ ${t.costUsd.toFixed(2)} API-equivalent (subscription)
        </span>
      </summary>
      <table className="tabular mt-3 text-left">
        <thead>
          <tr><th className="pr-6 font-semibold">Step</th><th className="pr-6 font-semibold">Calls</th><th className="pr-6 font-semibold">Out</th><th className="pr-6 font-semibold">Context</th><th className="pr-6 font-semibold">Time</th><th className="font-semibold">≈ $</th></tr>
        </thead>
        <tbody>
          {Object.entries(usage.byStep).map(([k, s]) => (
            <tr key={k}>
              <td className="pr-6">{LABEL[k] ?? k}</td>
              <td className="pr-6">{s.calls}{s.failed ? ` (${s.failed} failed)` : ""}</td>
              <td className="pr-6">{kTokens(s.outputTokens)}</td>
              <td className="pr-6">{kTokens(s.cacheReadTokens + s.cacheWriteTokens + s.inputTokens)}</td>
              <td className="pr-6">{Math.round(s.durationMs / 1000)} s</td>
              <td>{s.costUsd.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
