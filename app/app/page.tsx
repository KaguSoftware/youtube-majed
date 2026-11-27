"use client";
import Link from "next/link";
import { NARRATIVES } from "@studio/schema";
import { Gate, useLoaded } from "@/components/with-project";
import { button } from "@/components/ui";
import { StatusMark } from "@/components/status";
import { type ProjectSummary, loadProjects } from "@/lib/api";
import { ago, minutesLabel } from "@/lib/format";
import { stepHref, stepOf } from "@/lib/steps";

export default function Home() {
  const loaded = useLoaded(loadProjects, []);
  return <Gate loaded={loaded}>{(projects) => <Stories projects={projects} />}</Gate>;
}

function Stories({ projects }: { projects: ProjectSummary[] }) {

  return (
    <div className="mx-auto max-w-5xl px-6 pb-24 pt-14">
      <div className="flex items-end justify-between gap-6">
        <div>
          <p className="eyebrow text-faint">Stories</p>
          <h1 className="title-card mt-2 text-marquee">One sentence in.</h1>
        </div>
        <Link href="/new" className={button.primary}>
          New story
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="mt-16 max-w-xl border-t border-hairline pt-10">
          <h2 className="text-lg font-semibold">No stories yet</h2>
          <p className="mt-2 text-muted">
            Start with one sentence: a premise, a true event, a "what if". Claude writes three ways to tell it, you pick one, and it comes back as a script you can shape line by line before it goes to the voice.
          </p>
          <Link href="/new" className={`${button.secondary} mt-6`}>
            Write the first sentence
          </Link>
        </div>
      ) : (
        <ul className="mt-12 divide-y divide-hairline border-y border-hairline">
          {projects.map((p) => {
            const stage = p.pipeline.stages.find((x) => x.key === p.pipeline.current)!;
            const everyStepDone = p.pipeline.stages.every((x) => x.status === "done" && !x.stale || x.key === "editor");
            return (
              <li key={p.id}>
                <Link href={stepHref(p.id, p.pipeline.current)} className="group grid grid-cols-[1fr_auto] items-baseline gap-x-8 gap-y-1 px-2 py-5 hover:bg-raised sm:grid-cols-[1fr_9rem_9rem]">
                  <span className="min-w-0">
                    <span className="block truncate text-lg font-semibold text-text group-hover:text-accent">{p.title ?? p.brief.sentence}</span>
                    {p.title && <span className="mt-0.5 block truncate text-sm text-faint">{p.brief.sentence}</span>}
                  </span>
                  <span className="tabular text-sm text-muted">
                    {p.brief.format === "reel" ? "Reel" : "YouTube"} · {minutesLabel(p.brief.minutes)}
                    <span className="block text-faint">{NARRATIVES[p.brief.narrative].label}</span>
                  </span>
                  <span className="col-start-2 row-start-1 text-right text-sm sm:col-start-3">
                    <span className="block text-muted">{everyStepDone ? "Exported" : `${stepOf(stage.key).n} ${stepOf(stage.key).label}`}</span>
                    <StatusMark stage={stage} className="text-sm" />
                    <span className="block text-faint">{ago(p.updatedAt)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
