"use client";
import Link from "next/link";
import { JobError, JobProgress } from "@/components/job-progress";
import { ReviewScores } from "@/components/review-scores";
import { JobBar, StepHead } from "@/components/step-head";
import { button } from "@/components/ui";
import type { ProjectDetail } from "@/lib/api";
import { useAct } from "@/lib/use-act";
import { useProject } from "@/lib/use-project";

/** Step 3. The scores of each round; the findings themselves are pinned under their lines in the script editor. */
export function ReviewView({ initial }: { initial: ProjectDetail }) {
  const { project: p, active, lastFinished, reload } = useProject(initial);
  const { act, cancel, error } = useAct(reload);
  const open = p.comments.filter((c) => c.status === "open" && c.severity !== "info");
  const blockers = open.filter((c) => c.severity === "blocker").length;
  const locked = Boolean(p.narration?.lockedAt);
  const stage = p.pipeline.stages[2]!;

  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-12">
      <StepHead stepKey="review" stage={stage} title="Review">
        <button type="button" onClick={() => act(`/projects/${p.id}/review`, {})} disabled={active.length > 0 || !p.narration || locked} className={p.history.length ? button.secondary : button.primary}>
          {p.history.length ? "Review again" : "Review the script"}
        </button>
        {p.narration && (
          <Link href={`/p/${p.id}/script`} className={open.length ? button.primary : button.secondary}>
            {open.length ? `Open ${open.length} finding${open.length > 1 ? "s" : ""} in the script` : "Open the script"}
          </Link>
        )}
      </StepHead>

      <JobBar live={active.length > 0 || Boolean(error) || lastFinished?.status === "failed"}>
        <JobProgress jobs={active} onCancel={cancel} />
        {!active.length && <JobError job={lastFinished} />}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </JobBar>

      {!p.narration ? (
        <p className="mt-12 max-w-xl text-muted">Two readers go through the script in parallel: a fact-checker (or a consistency check for fiction) and a retention critic who scores every loop. They need the story first.</p>
      ) : p.history.length === 0 ? (
        <section className="mt-12 max-w-xl">
          <h2 className="text-lg font-semibold">Two readers, in parallel</h2>
          <p className="mt-2 text-muted">{p.brief.factual ? "The fact-checker looks up every claim and keeps the source." : "The consistency check reads for names, timelines and world rules."} The critic scores each loop on stakes, question, surprise and rehook, and names the three weakest moments. Findings land under the exact lines in the script editor.</p>
        </section>
      ) : (
        <section aria-labelledby="scores-h" className="mt-12">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <h2 id="scores-h" className="text-lg font-semibold">Scores by round</h2>
            <p className="text-sm text-muted">
              {blockers ? <span className="text-danger">{blockers} blocker{blockers > 1 ? "s" : ""} stop the lock. </span> : null}
              {open.length ? `${open.length} open finding${open.length > 1 ? "s" : ""}.` : "No open findings."}
            </p>
          </div>
          <ReviewScores history={p.history} />
        </section>
      )}
    </div>
  );
}
