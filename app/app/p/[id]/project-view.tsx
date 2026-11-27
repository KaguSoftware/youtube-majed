"use client";
import { NARRATIVES, type MasterOption } from "@studio/schema";
import { checkStory, tensionGraph } from "@studio/story";
import Link from "next/link";
import { useMemo, useState } from "react";
import { JobError, JobProgress } from "@/components/job-progress";
import { ReviewScores } from "@/components/review-scores";
import { TensionGraph } from "@/components/tension-graph";
import { button } from "@/components/ui";
import { UsageLine } from "@/components/usage-line";
import { call, JobResponse, type ProjectDetail } from "@/lib/api";
import { minutesLabel } from "@/lib/format";
import { useProject } from "@/lib/use-project";

const STAKES: Record<string, string> = { character: "Someone to root for", at_risk: "Something to lose", urgent: "A deadline" };

export function ProjectView({ initial }: { initial: ProjectDetail }) {
  const { project: p, active, lastFinished, reload } = useProject(initial);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);

  async function act(path: string, body: unknown = {}) {
    setError(null);
    try {
      await call(path, JobResponse, { body });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function pick(o: MasterOption) {
    setPicking(o.id);
    await act(`/projects/${p.id}/pick`, { option: o.id, ...(p.narration ? { force: true } : {}) });
    setPicking(null);
  }

  const report = useMemo(() => (p.loopmap && p.narration ? checkStory(p.loopmap, p.narration, { budget: p.budget, wpm: p.wpm }) : null), [p.loopmap, p.narration, p.budget, p.wpm]);
  const graph = useMemo(() => (p.loopmap && report ? tensionGraph(p.loopmap, report) : null), [p.loopmap, report]);
  const lines = useMemo(() => new Map((p.narration?.loops ?? []).flatMap((l) => l.lines).map((l) => [l.id, l.text])), [p.narration]);
  const cancel = (job: { id: string }) => void call(`/jobs/${job.id}/cancel`, JobResponse, { body: {} }).catch(() => {});

  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-12">
      <header className="max-w-3xl">
        <p className="eyebrow text-faint">
          {NARRATIVES[p.brief.narrative].label} · {p.brief.format === "reel" ? "Reel" : "YouTube"} · {minutesLabel(p.brief.minutes)} · {p.budget.toLocaleString("en-GB")} words · {p.brief.factual ? "fact-checked" : "fiction"}
        </p>
        {p.pick ? (
          <>
            <h1 className="title-card mt-3 text-marquee">{p.pick.option.title}</h1>
            <p className="mt-4 text-lg text-muted">{p.pick.option.logline}</p>
          </>
        ) : (
          <h1 className="mt-3 text-title font-semibold leading-tight text-text">{p.brief.sentence}</h1>
        )}
      </header>

      <div className={`${active.length || error || lastFinished?.status === "failed" ? "sticky top-14 z-20 -mx-6 border-b border-hairline bg-room/95 px-6 py-3 backdrop-blur-[2px]" : ""} mt-8 space-y-4`}>
        <JobProgress jobs={active} onCancel={cancel} />
        {!active.length && <JobError job={lastFinished} />}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>

      {/* ---- Step 2a: pick a master loop */}
      {p.options && !p.pick && (
        <section aria-labelledby="options-h" className="mt-12">
          <div className="flex items-baseline justify-between gap-6">
            <h2 id="options-h" className="text-lg font-semibold">Three ways to tell it. Pick one.</h2>
            <button type="button" onClick={() => act(`/projects/${p.id}/options`, { force: true })} disabled={active.length > 0} className={button.quiet}>
              Write three new ones
            </button>
          </div>
          <ol className="mt-6 grid gap-px overflow-hidden rounded-lg bg-hairline ring-1 ring-hairline lg:grid-cols-3">
            {p.options.options.map((o) => (
              <li key={o.id} className="flex flex-col bg-room p-6">
                <p className="eyebrow text-faint">Option {o.id}</p>
                <h3 className="title-card mt-2 text-[1.75rem] leading-[1.9rem] text-text">{o.title}</h3>
                <p className="mt-4 text-[0.9375rem] leading-relaxed text-muted">{o.logline}</p>
                <dl className="mt-6 space-y-4 text-sm">
                  <div>
                    <dt className="eyebrow text-faint">Stakes · {STAKES[o.stakes.type]}</dt>
                    <dd className="mt-1 text-text">{o.stakes.text}</dd>
                  </div>
                  <div>
                    <dt className="eyebrow text-faint">The big question</dt>
                    <dd className="mt-1 font-semibold text-text">{o.question}</dd>
                  </div>
                  <div>
                    <dt className="eyebrow text-faint">Viewers expect</dt>
                    <dd className="mt-1 text-muted">{o.endingTwist.expected}</dd>
                  </div>
                  <div>
                    <dt className="eyebrow text-faint">They get</dt>
                    <dd className="mt-1 text-text">{o.endingTwist.actual}</dd>
                  </div>
                </dl>
                <blockquote className="mt-6 border-t border-hairline pt-4 text-[0.9375rem] italic text-text">“{o.hook}”</blockquote>
                <p className="mt-2 text-xs text-faint">{o.whyItWorks}</p>
                <div className="mt-auto pt-6">
                  <button type="button" onClick={() => pick(o)} disabled={active.length > 0 || picking !== null} className={`${button.primary} w-full`}>
                    {picking === o.id ? "Starting…" : "Tell this one"}
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ---- Step 2b/c: the story */}
      {p.pick && p.loopmap && p.narration && graph && report && (
        <>
          <section aria-labelledby="shape-h" className="mt-14">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 id="shape-h" className="text-lg font-semibold">The shape of it</h2>
                <p className="mt-1 text-sm text-muted">
                  <span className="tabular">{report.words.toLocaleString("en-GB")}</span> of {report.budget.toLocaleString("en-GB")} words ·{" "}
                  {report.ok ? <span className="text-ok">✓ loop checks pass</span> : <span className="text-danger">✗ {report.errors} loop check{report.errors > 1 ? "s" : ""} failing</span>}
                  {report.warnings ? <span className="text-caution"> · {report.warnings} warning{report.warnings > 1 ? "s" : ""}</span> : null}
                </p>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => act(`/projects/${p.id}/review`, {})} disabled={active.length > 0 || Boolean(p.narration.lockedAt)} className={button.secondary}>
                  {p.history.length ? "Review again" : "Review the script"}
                </button>
                <Link href={`/p/${p.id}/script`} className={button.primary}>
                  {p.narration.lockedAt ? "Open the locked script" : "Open the script editor"}
                </Link>
              </div>
            </div>
            <div className="mt-6 rounded-lg bg-raised px-5 pb-4 pt-6">
              <TensionGraph graph={graph} wpm={p.wpm} height={220} lineText={(id) => lines.get(id)} onPick={(id) => (window.location.href = `/p/${p.id}/script#${id}`)} />
            </div>
          </section>

          <section aria-labelledby="loops-h" className="mt-14">
            <h2 id="loops-h" className="text-lg font-semibold">Loop map</h2>
            <dl className="mt-3 grid max-w-3xl gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[7rem_1fr]">
              <dt className="eyebrow pt-0.5 text-faint">Master asks</dt>
              <dd className="font-semibold text-text">{p.loopmap.master.question}</dd>
              <dt className="eyebrow pt-0.5 text-faint">Viewers expect</dt>
              <dd className="text-muted">{p.loopmap.master.headFake.expected}</dd>
              <dt className="eyebrow pt-0.5 text-faint">They get</dt>
              <dd className="text-text">{p.loopmap.master.headFake.actual}</dd>
            </dl>
            <ol className="mt-6 divide-y divide-hairline border-y border-hairline">
              {p.loopmap.loops.map((l) => {
                const s = report.loops.find((x) => x.loopId === l.id);
                const over = s && s.words > s.budget * 1.1;
                return (
                  <li key={l.id} className="grid gap-x-8 gap-y-2 py-5 md:grid-cols-[7rem_1fr_1fr]">
                    <div>
                      <p className="tabular text-sm font-semibold text-text">{l.id}</p>
                      <p className="text-sm text-muted">{l.title}</p>
                      {s && <p className={`tabular mt-1 text-xs ${over ? "text-danger" : "text-faint"}`}>{s.words}/{s.budget} words{over ? " · over" : ""}</p>}
                    </div>
                    <dl className="space-y-2 text-sm">
                      <div><dt className="sr-only">Stakes</dt><dd className="text-muted"><span className="eyebrow mr-2 text-faint">Stakes</span>{l.stakes.text}</dd></div>
                      <div><dt className="sr-only">Question</dt><dd className="font-semibold text-text"><span className="eyebrow mr-2 font-normal text-faint">Asks</span>{l.question}</dd></div>
                    </dl>
                    <dl className="space-y-2 text-sm">
                      <div><dt className="sr-only">Head fake</dt><dd className="text-muted"><span className="eyebrow mr-2 text-faint">Expect</span>{l.headFake.expected}</dd></div>
                      <div><dt className="sr-only">Delivered</dt><dd className="text-text"><span className="eyebrow mr-2 text-faint">Get</span>{l.headFake.actual} <span className="tabular text-faint">(plants {l.headFake.plantIds.join(", ")})</span></dd></div>
                      <div><dt className="sr-only">Rehook</dt><dd className="italic text-text"><span className="eyebrow mr-2 not-italic text-faint">Rehook</span>{l.rehook}</dd></div>
                    </dl>
                  </li>
                );
              })}
            </ol>
          </section>

          {p.history.length > 0 && (
            <section aria-labelledby="review-h" className="mt-14">
              <h2 id="review-h" className="text-lg font-semibold">Review</h2>
              <ReviewScores history={p.history} />
            </section>
          )}
        </>
      )}

      <footer className="mt-20 border-t border-hairline pt-5">
        <UsageLine usage={p.usage} />
      </footer>
    </div>
  );
}
