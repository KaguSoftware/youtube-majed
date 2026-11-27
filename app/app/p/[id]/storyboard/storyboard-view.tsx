"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { JobError, JobProgress } from "@/components/job-progress";
import { JobBar, StepHead } from "@/components/step-head";
import { VarietyPanel } from "@/components/variety-panel";
import { button } from "@/components/ui";
import { call, ScenesState, StoryboardState, type ProjectDetail } from "@/lib/api";
import { clock } from "@/lib/format";
import { useAct } from "@/lib/use-act";
import { useProject } from "@/lib/use-project";

type Scenes = NonNullable<ScenesState["scenes"]>;
type Report = NonNullable<StoryboardState["storyboard"]>;
const words = (id: string) => id.replaceAll("_", " ");

/**
 * Step 6. Claude plans a cast and then the scenes, in batches of whole loops;
 * code maps unknown ids to the closest library item, repairs what keeps a
 * shot's meaning, and enforces variety. This page shows what came out and
 * what code had to change.
 */
export function StoryboardView({ initial }: { initial: ProjectDetail }) {
  const { project: p, active, lastFinished, reload } = useProject(initial);
  const [scenes, setScenes] = useState<Scenes | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([call(`/projects/${p.id}/scenes`, ScenesState), call(`/projects/${p.id}/storyboard`, StoryboardState)]);
      setScenes(s.scenes);
      setReport(r.storyboard);
    } catch {
      /* the next job event retries */
    }
  }, [p.id]);
  const refresh = useCallback(async () => {
    await reload();
    await load();
  }, [reload, load]);
  useEffect(() => void load(), [load, lastFinished?.id]);
  const { act, cancel, error } = useAct(refresh);

  const stage = p.pipeline.stages[5]!;
  const busy = active.length > 0;
  const voiced = p.pipeline.stages[4]!.status === "done";

  const byLoop = useMemo(() => {
    const m = new Map<string, Scenes["scenes"]>();
    for (const s of scenes?.scenes ?? []) {
      const loop = s.lineIds[0]!.split(".")[0]!;
      m.set(loop, [...(m.get(loop) ?? []), s]);
    }
    return [...m];
  }, [scenes]);
  const title = (loop: string) => p.loopmap?.loops.find((l) => l.id === loop)?.title;
  const mood = (loop: string) => report?.music.find((m) => m.loopId === loop)?.mood;
  const revealAt = useMemo(() => new Set(report?.reveals.map((r) => r.lineId)), [report]);
  const open = report?.flags.filter((f) => !f.fixed && f.kind !== "mapped") ?? [];
  const changed = report?.flags.filter((f) => f.fixed || f.kind === "mapped") ?? [];

  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-12">
      <StepHead stepKey="storyboard" stage={stage} title="Storyboard">
        {voiced && (
          <button type="button" onClick={() => act(`/projects/${p.id}/storyboard`, scenes ? { force: true } : {})} disabled={busy} className={scenes && !stage.stale ? button.secondary : button.primary}>
            {scenes ? "Plan the scenes again" : "Plan the scenes"}
          </button>
        )}
        {scenes && <Link href={`/p/${p.id}/cast`} className={button.secondary}>Edit the cast</Link>}
      </StepHead>

      <JobBar live={busy || Boolean(error) || lastFinished?.status === "failed"}>
        <JobProgress jobs={active} onCancel={cancel} />
        {!busy && <JobError job={lastFinished} />}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </JobBar>

      {!voiced && !scenes ? (
        <section className="mt-12 max-w-xl">
          <h2 className="text-lg font-semibold">Scenes follow the real voice</h2>
          <p className="mt-2 text-muted">Voice the script first. The storyboard reads the spoken timing, so shots land on the right words and nothing has to be estimated.</p>
          <Link href={`/p/${p.id}/voice`} className={`${button.secondary} mt-6`}>Go to the voice</Link>
        </section>
      ) : !scenes || !report ? (
        !busy && (
          <section className="mt-12 max-w-xl">
            <h2 className="text-lg font-semibold">Claude casts it, then draws every shot</h2>
            <p className="mt-2 text-muted">One call decides who is on screen, where each loop happens and what music it wants. Then the scenes are written in batches of whole loops, three at a time. Code checks every id against the animation library and every head fake gets its own reveal shot. A few minutes.</p>
          </section>
        )
      ) : (
        <>
          <dl className="mt-10 grid max-w-4xl grid-cols-2 gap-x-10 gap-y-4 text-sm sm:grid-cols-5">
            <div><dt className="eyebrow text-faint">Scenes</dt><dd className="tabular mt-1 text-lg font-semibold">{report.stats.scenes}</dd></div>
            <div><dt className="eyebrow text-faint">Lines covered</dt><dd className="tabular mt-1 text-lg font-semibold">{report.stats.lines}</dd></div>
            <div><dt className="eyebrow text-faint">Runs for</dt><dd className="tabular mt-1 text-lg font-semibold">{clock(report.stats.seconds)}</dd></div>
            <div><dt className="eyebrow text-faint">Timed by</dt><dd className="mt-1 text-lg font-semibold">{report.stats.timedBy === "voice" ? "The voice" : "An estimate"}</dd></div>
            <div><dt className="eyebrow text-faint">Cast</dt><dd className="mt-1 text-lg font-semibold">{Object.keys(scenes.cast).length} characters</dd></div>
          </dl>
          {report.stats.timedBy === "estimate" && <p className="mt-4 max-w-2xl text-sm text-caution">These scenes were planned before the script was voiced, so their timing is an estimate. Plan them again to follow the voice.</p>}
          {report.style && <p className="mt-6 max-w-2xl text-muted"><span className="eyebrow mr-2 text-faint">Look</span>{report.style}</p>}

          <VarietyPanel project={p.id} trigger={lastFinished?.id} />

          {open.length > 0 && (
            <section aria-labelledby="open-h" className="mt-10 max-w-3xl">
              <h2 id="open-h" className="text-lg font-semibold text-caution">{open.length} for you to look at</h2>
              <ul className="mt-3 space-y-1.5 text-sm">
                {open.map((f, i) => (
                  <li key={i} className="text-muted"><span className="tabular mr-2 font-semibold text-text">{f.sceneId}</span>{f.message}</li>
                ))}
              </ul>
            </section>
          )}
          {changed.length > 0 && (
            <details className="mt-8 max-w-3xl text-sm">
              <summary className="cursor-pointer select-none text-muted hover:text-text">What code changed in Claude's draft ({changed.length})</summary>
              <ul className="mt-3 space-y-1.5">
                {changed.map((f, i) => (
                  <li key={i} className="text-muted"><span className="tabular mr-2 font-semibold text-text">{f.sceneId}</span><span className="eyebrow mr-2 text-faint">{f.kind}</span>{f.message}</li>
                ))}
              </ul>
            </details>
          )}

          <section aria-labelledby="scenes-h" className="mt-14">
            <h2 id="scenes-h" className="text-lg font-semibold">Scenes by loop</h2>
            <div className="mt-6 space-y-10">
              {byLoop.map(([loop, list]) => (
                <div key={loop}>
                  <h3 className="flex flex-wrap items-baseline gap-x-3 text-sm">
                    <span className="tabular font-semibold">{loop}</span>
                    <span className="text-muted">{title(loop)}</span>
                    {mood(loop) && <span className="eyebrow text-faint">music: {mood(loop)}</span>}
                  </h3>
                  <ol className="mt-2 divide-y divide-hairline border-y border-hairline text-sm">
                    {list.map((s) => (
                      <li key={s.id} className="grid grid-cols-[3rem_5.5rem_1fr] gap-x-4 gap-y-0.5 py-2 md:grid-cols-[3rem_5.5rem_11rem_1fr_9rem]">
                        <span className="tabular font-semibold">{s.id}</span>
                        <span className="tabular text-faint">{s.lineIds.length > 1 ? `${s.lineIds[0]} to ${s.lineIds.at(-1)!.split(".")[1]}` : s.lineIds[0]}</span>
                        <span className="text-text">{words(s.bg)}<span className="text-faint"> · {words(s.grade)}</span></span>
                        <span className="text-muted">
                          {s.chars.length ? s.chars.map((c) => `${scenes.cast[c.id]?.name ?? c.id} ${words(c.action)}`).join(", ") : "no one on screen"}
                          {s.props.length > 0 && <span className="text-faint"> · {s.props.map((x) => words(x.id)).join(", ")}</span>}
                        </span>
                        <span className="text-faint md:text-right">
                          {words(s.camera)}
                          {s.lineIds.some((l) => revealAt.has(l)) && <span className="ml-2 font-semibold text-accent">reveal</span>}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
