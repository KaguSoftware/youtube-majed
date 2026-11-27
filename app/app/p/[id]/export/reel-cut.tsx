"use client";
import Link from "next/link";
import { JobError, JobProgress } from "@/components/job-progress";
import { button } from "@/components/ui";
import type { Job, ReelState } from "@/lib/api";
import { clock } from "@/lib/format";

/**
 * A long video can give a Reel: Claude reads the loop map and the critic's scores, picks the strongest loop and cuts
 * 60 to 90 seconds around it. The cut is its own project, so it has its own edit pass and its own export. And a
 * project that is a cut says where it came from.
 */
export function ReelCutSection({ project, state, blocked, jobs, lastFinished, onCut }: { project: string; state: ReelState; blocked?: string; jobs: Job[]; lastFinished: Job | undefined; onCut: () => void }) {
  const from = state.links.cutFrom;
  const busy = jobs.length > 0;

  if (from) {
    return (
      <section aria-labelledby="cut-h" className="border-t border-hairline pt-6">
        <h2 id="cut-h" className="text-lg font-semibold">
          A Reel cut of{" "}
          <Link href={`/p/${from.parent}/export`} className="underline underline-offset-4 hover:text-accent">
            {from.parent}
          </Link>
        </h2>
        <p className="mt-2 max-w-prose text-sm text-muted">
          Built around loop {from.cut.loopId}, from version {from.parentVersion} of the long video. {from.cut.why}
        </p>
        {(from.cut.hook || from.cut.ending) && (
          <dl className="mt-4 max-w-prose space-y-2 text-sm">
            {from.cut.hook && (
              <div>
                <dt className="eyebrow text-faint">New first line · {from.newLines.hook}</dt>
                <dd className="mt-1 text-text">{from.cut.hook.text}</dd>
              </div>
            )}
            {from.cut.ending && (
              <div>
                <dt className="eyebrow text-faint">New last line · {from.newLines.ending}</dt>
                <dd className="mt-1 text-text">{from.cut.ending.text}</dd>
              </div>
            )}
          </dl>
        )}
        <p className="mt-4 text-sm text-muted">
          Every other line is the long video's own take. Edit it in the{" "}
          <Link href={`/p/${project}/editor`} className="underline underline-offset-4 hover:text-text">
            editor
          </Link>{" "}
          like any project.
        </p>
      </section>
    );
  }

  if (state.format === "reel") return null;

  return (
    <section aria-labelledby="cut-h" className="border-t border-hairline pt-6">
      <h2 id="cut-h" className="text-lg font-semibold">
        Cut a Reel from this video
      </h2>
      <p className="mt-2 max-w-prose text-sm text-muted">
        Claude reads the loop map and the critic's scores, picks the strongest loop and cuts 60 to 90 seconds around it. Takes you already have are reused; only a new first or last line is voiced, so the voice service must be running if it adds one. The cut becomes its own project with its own edits.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onCut} disabled={busy || Boolean(blocked)} className={button.secondary}>
          {state.links.reels.length ? "Cut another Reel" : "Cut a Reel"}
        </button>
        {blocked && !busy && <span className="text-sm text-muted">{blocked}</span>}
      </div>
      <div className="mt-4 space-y-4 empty:hidden">
        <JobProgress jobs={jobs} />
        {!busy && <JobError job={lastFinished} />}
      </div>
      {state.links.reels.length > 0 && (
        <ul className="mt-5 max-w-xl divide-y divide-hairline">
          {state.links.reels.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-2.5 text-sm">
              <span>
                <span className="font-semibold">{r.id}</span> <span className="tabular text-muted">{r.seconds ? clock(r.seconds) : ""} from loop {r.loopId}</span>
              </span>
              <span className="flex gap-4">
                <Link href={`/p/${r.id}/export`} className="text-text underline underline-offset-4 hover:text-accent">
                  Export
                </Link>
                <Link href={`/p/${r.id}/editor`} className="text-muted underline underline-offset-4 hover:text-text">
                  Edit
                </Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
