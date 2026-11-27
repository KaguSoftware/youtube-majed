"use client";
import { NARRATIVES } from "@studio/schema";
import Link from "next/link";
import { use } from "react";
import { StepHead } from "@/components/step-head";
import { WithProject } from "@/components/with-project";
import { button } from "@/components/ui";
import type { ProjectDetail } from "@/lib/api";
import { ago, minutesLabel } from "@/lib/format";

/** Step 1. The brief is written once, on /new; here it is read back, so any step can point at what the story was asked to be. */
export default function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <WithProject id={id} title="Brief">{(p) => <Brief id={id} p={p} />}</WithProject>;
}

function Brief({ id, p }: { id: string; p: ProjectDetail }) {
  const b = p.brief;
  const rows: [string, string][] = [
    ["Narrative", NARRATIVES[b.narrative].label],
    ["Format", b.format === "reel" ? "Reel, vertical" : "YouTube, 16:9"],
    ["Length", `${minutesLabel(b.minutes)}, about ${p.budget.toLocaleString("en-GB")} words at ${p.wpm} words a minute`],
    ["Kind", b.factual ? "True story, fact-checked" : "Fiction"],
    ["Written", ago(b.createdAt)],
    ...(b.notes ? ([["Direction", b.notes]] as [string, string][]) : []),
  ];
  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-12">
      <StepHead stepKey="brief" stage={p.pipeline.stages[0]!} title="The brief">
        <Link href="/new" className={button.secondary}>Start another story</Link>
      </StepHead>
      <section aria-labelledby="sentence-h" className="mt-12 max-w-3xl">
        <h2 id="sentence-h" className="eyebrow text-faint">The sentence</h2>
        <p className="mt-3 text-title font-semibold leading-tight">{b.sentence}</p>
        <dl className="mt-10 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-[8rem_1fr]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="eyebrow pt-0.5 text-faint">{k}</dt>
              <dd className="text-text">{v}</dd>
            </div>
          ))}
        </dl>
        <Link href={`/p/${id}`} className={`${button.primary} mt-10`}>Go to the story</Link>
      </section>
    </div>
  );
}
