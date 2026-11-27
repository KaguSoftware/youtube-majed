"use client";
import type { AvoidLists, Verdict, VarietyDimensionId, VarietyFile, VarietyReport } from "@studio/schema";
import { VARIETY_BANDS, VARIETY_DIMENSIONS } from "@studio/schema";
import { ArrowRight, CircleCheck, CircleDot, CircleX, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useVariety } from "@/lib/use-variety";

const words = (s: string) => s.replaceAll("_", " ");
/** Library ids read as plain words: `city|walk|static` becomes "city · walk · static", `transition:whoosh_wipe` "whoosh wipe (transition)". */
const pretty = (s: string) =>
  words(s.replace(/\b(transition|framing|weather|overlay):(\w+)/g, (_, kind: string, id: string) => `${id} (${kind})`))
    .replace(/chars:(\d+)/g, (_, n: string) => `${n} ${n === "1" ? "character" : "characters"}`)
    .replace(/(\w)\|(?=\S)/g, "$1 · ")
    .replace(/\|/g, " · ");

const VERDICT: Record<Verdict, { word: string; Icon: typeof CircleCheck; tone: string; say: string }> = {
  distinct: { word: "Distinct", Icon: CircleCheck, tone: "text-ok", say: "This looks like a different video from the last ones." },
  similar: { word: "Similar", Icon: TriangleAlert, tone: "text-caution", say: "Part of the look repeats. The repeats are listed below." },
  too_similar: { word: "Too similar", Icon: CircleX, tone: "text-danger", say: "This looks like the last videos. Change the repeats before you upload." },
  first: { word: "First video", Icon: CircleDot, tone: "text-muted", say: "There is nothing earlier to compare with yet." },
};

/** One dimension's own reading, by the same bands as the whole score: a glyph and a word, so colour is never alone. */
function band(distinct: number | null): { word: string; Icon: typeof CircleCheck; tone: string; fill: string } {
  if (distinct === null) return { word: "no data", Icon: CircleDot, tone: "text-faint", fill: "bg-faint" };
  if (distinct >= VARIETY_BANDS.distinct) return { word: "distinct", Icon: CircleCheck, tone: "text-ok", fill: "bg-text" };
  if (distinct >= VARIETY_BANDS.similar) return { word: "similar", Icon: TriangleAlert, tone: "text-caution", fill: "bg-caution" };
  return { word: "too similar", Icon: CircleX, tone: "text-danger", fill: "bg-danger" };
}

function noData(d: VarietyDimensionId, f: VarietyReport["features"], against: number): string {
  if (!against) return "nothing to compare with";
  if (d === "musicBeds") return f.musicBeds.length ? "no earlier video has been mixed" : "not mixed yet";
  if (d === "customShots") return "no custom shots in this video";
  return "no data";
}

/** Where the score sits among the three verdicts. The zone is named in words under the bar; the marker is a line, not a colour. */
function Gauge({ score, verdict }: { score: number | null; verdict: Verdict }) {
  const zones = [
    { flex: VARIETY_BANDS.similar, name: "too similar", range: `under ${VARIETY_BANDS.similar}`, on: verdict === "too_similar" },
    { flex: VARIETY_BANDS.distinct - VARIETY_BANDS.similar, name: "similar", range: `${VARIETY_BANDS.similar} to ${VARIETY_BANDS.distinct}`, on: verdict === "similar" },
    { flex: 100 - VARIETY_BANDS.distinct, name: "distinct", range: `${VARIETY_BANDS.distinct} and up`, on: verdict === "distinct" },
  ];
  return (
    <div role="img" aria-label={score === null ? "No score yet" : `Score ${score.toFixed(1)} of 100. Below ${VARIETY_BANDS.similar} is too similar, ${VARIETY_BANDS.similar} to ${VARIETY_BANDS.distinct} similar, ${VARIETY_BANDS.distinct} and above distinct.`} className="mt-4 max-w-lg">
      <div className="relative flex h-2">
        {zones.map((z) => (
          <span key={z.name} style={{ flex: z.flex }} className={`border-r-2 border-room first:rounded-l-full last:rounded-r-full last:border-r-0 ${z.on ? "bg-muted" : "bg-hairline"}`} />
        ))}
        {score !== null && <span aria-hidden style={{ left: `${Math.min(99.5, score)}%` }} className="absolute -top-1.5 h-5 w-0.5 -translate-x-1/2 rounded-full bg-text" />}
      </div>
      <div aria-hidden className="mt-1.5 flex text-xs">
        {zones.map((z) => (
          <span key={z.name} style={{ flex: z.flex }} className={`flex flex-col pr-1 ${z.on ? "text-muted" : "text-faint"}`}>
            <span className={z.on ? "font-semibold" : ""}>{z.name}</span>
            <span className="tabular">{z.range}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Dimensions({ report }: { report: VarietyReport }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm">
        <caption className="sr-only">How distinct each part of the look is from the last {report.against.length} videos, 0 to 100, higher is more distinct</caption>
        <thead>
          <tr className="text-left text-xs text-faint">
            <th scope="col" className="w-44 py-1.5 pr-4 font-semibold">Part of the look</th>
            <th scope="col" className="py-1.5 pr-4 font-semibold">Distinct from the last videos</th>
            <th scope="col" className="py-1.5 pr-4 font-semibold">This video leans on</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {report.dimensions.map((d) => {
            // the caption style is the channel's look on purpose (word pop on every scene): shown, never flagged
            const b = d.dimension === "captions" && d.distinct !== null ? { word: "series style", Icon: CircleDot, tone: "text-muted", fill: "bg-muted" } : band(d.distinct);
            return (
              <tr key={d.dimension}>
                <th scope="row" className="py-2 pr-4 text-left font-normal text-text">{VARIETY_DIMENSIONS[d.dimension].label}</th>
                <td className="py-2 pr-4">
                  {d.distinct === null ? (
                    <span className="inline-flex items-center gap-1.5 text-faint">
                      <b.Icon aria-hidden size={13} strokeWidth={2} />
                      {noData(d.dimension, report.features, report.against.length)}
                    </span>
                  ) : (
                    <span className="flex items-center gap-3">
                      <span aria-hidden className="h-1.5 w-32 shrink-0 overflow-hidden rounded-full bg-hairline sm:w-44">
                        <span style={{ width: `${Math.max(2, d.distinct)}%` }} className={`block h-full rounded-full ${b.fill}`} />
                      </span>
                      <span className={`inline-flex items-center gap-1.5 ${b.tone}`}>
                        <b.Icon aria-hidden size={13} strokeWidth={2.25} />
                        <span className="tabular w-7 text-right font-semibold">{Math.round(d.distinct)}</span>
                        <span className="whitespace-nowrap text-xs">{b.word}</span>
                      </span>
                    </span>
                  )}
                </td>
                <td className="py-2 pr-4 text-muted">{d.top.length ? d.top.map(pretty).join(", ") : <span className="text-faint">none</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Repeats({ report, limit }: { report: VarietyReport; limit: number }) {
  if (!report.repeats.length) return report.against.length ? <p className="mt-6 text-sm text-muted">Nothing here repeats what the last {report.against.length === 1 ? "video" : `${report.against.length} videos`} did.</p> : null;
  const item = (r: VarietyReport["repeats"][number], i: number) => (
    <li key={i} className="text-muted">
      <span className="eyebrow mr-2 text-faint">{VARIETY_DIMENSIONS[r.dimension].label}</span>
      {pretty(r.message)}
    </li>
  );
  const rest = report.repeats.slice(limit);
  return (
    <section aria-labelledby="repeats-h" className="mt-8">
      <h3 id="repeats-h" className="text-base font-semibold">What repeats ({report.repeats.length})</h3>
      <ul className="mt-3 max-w-3xl space-y-1.5 text-sm">{report.repeats.slice(0, limit).map(item)}</ul>
      {rest.length > 0 && (
        <details className="mt-3 max-w-3xl text-sm">
          <summary className="cursor-pointer select-none text-muted hover:text-text">{rest.length} more</summary>
          <ul className="mt-3 space-y-1.5">{rest.map((r, i) => item(r, i + limit))}</ul>
        </details>
      )}
    </section>
  );
}

const AVOID_LABELS: [keyof Omit<AvoidLists, "against">, string][] = [
  ["backgrounds", "Backgrounds"],
  ["actionPairs", "Actions"],
  ["cameras", "Cameras"],
  ["grades", "Grades"],
  ["musicMoods", "Music moods"],
  ["openings", "First picture"],
  ["endings", "Last picture"],
  ["thumbnails", "Thumbnails"],
];

const scoreText = (r: VarietyReport | null | undefined) => (r?.score == null ? "no score" : r.score.toFixed(1));

/** What the last storyboard run was asked to avoid, how the score moved, and the swaps code made. */
function WhatChanged({ file }: { file: VarietyFile }) {
  const lists = file.avoid ? AVOID_LABELS.filter(([k]) => file.avoid![k].length) : [];
  const steps = [file.previous && { name: "Previous storyboard", r: file.previous }, { name: "Claude's draft", r: file.firstPass }, { name: "Final", r: file.final }].filter(Boolean) as { name: string; r: VarietyReport }[];
  return (
    <section aria-labelledby="changed-h" className="mt-10 max-w-3xl">
      <h3 id="changed-h" className="text-base font-semibold">What this storyboard did about it</h3>
      {file.against.length === 0 ? (
        <p className="mt-2 text-sm text-muted">It had no earlier videos to avoid, so nothing was steered.</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted">Claude was asked to avoid what {file.against.join(", ")} leaned on, as a strong preference. Code then swapped what was still repeated; no shot is moved to another place.</p>
          {lists.length > 0 && (
            <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1.5 text-sm">
              {lists.map(([k, label]) => (
                <div key={k} className="contents">
                  <dt className="text-faint">{label}</dt>
                  <dd className="text-muted">{file.avoid![k].map(pretty).join(", ")}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {steps.map((s, i) => (
              <span key={s.name} className="inline-flex items-center gap-3">
                {i > 0 && <ArrowRight aria-hidden size={14} className="text-faint" />}
                <span><span className="text-muted">{s.name}</span> <span className="tabular font-semibold text-text">{scoreText(s.r)}</span></span>
              </span>
            ))}
          </p>
          {file.swaps.length > 0 && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer select-none text-muted hover:text-text">What code swapped ({file.swaps.length})</summary>
              <ul className="mt-3 space-y-1.5">
                {file.swaps.map((s, i) => (
                  <li key={i} className="text-muted"><span className="tabular mr-2 font-semibold text-text">{s.sceneId}</span>{pretty(s.what)}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Variety across videos (docs/PLAN.md sections 6 and 12). YouTube demotes channels whose videos look mass-produced, so
 * every video is scored against the last few: a word and glyph for the verdict, a bar per part of the look, the
 * specific repeats. On the Storyboard step it also says what the storyboard run changed; on Export it is the short
 * version to read before uploading.
 */
export function VarietyPanel({ project, trigger, compact = false }: { project: string; trigger?: string; compact?: boolean }) {
  const state = useVariety(project, trigger);
  if (state === undefined) return <div aria-hidden className="mt-10 h-24 max-w-3xl animate-pulse rounded-md bg-raised motion-reduce:animate-none" />;
  const report = state.report;
  if (!report) return compact ? null : (
    <section aria-labelledby="variety-h" className="mt-10 max-w-3xl">
      <h2 id="variety-h" className="text-lg font-semibold">Variety</h2>
      <p className="mt-2 text-sm text-muted">Plan the scenes and the check against the last videos runs on them.</p>
    </section>
  );
  const v = VERDICT[report.verdict];
  const n = report.against.length;
  return (
    <section aria-labelledby="variety-h" className="mt-10">
      <div className="max-w-3xl">
        <h2 id="variety-h" className="eyebrow text-faint">Variety</h2>
        <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={`inline-flex items-center gap-2 text-lg font-semibold ${v.tone}`}>
            <v.Icon aria-hidden size={18} strokeWidth={2.25} className="self-center" />
            {v.word}
          </span>
          {report.score !== null && <span className="tabular text-lg font-semibold text-text">{report.score.toFixed(1)}<span className="text-sm font-normal text-faint"> of 100</span></span>}
        </p>
        <p className="mt-1 text-sm text-muted">
          {v.say} {n > 0 && <>Compared with {n === 1 ? "the video before it" : `the ${n} videos before it`}: {report.against.join(", ")}.</>}
        </p>
        <Gauge score={report.score} verdict={report.verdict} />
      </div>

      {n > 0 && (
        compact ? (
          <details className="mt-6 text-sm">
            <summary className="cursor-pointer select-none text-muted hover:text-text">Every part of the look, one by one</summary>
            <div className="mt-3"><Dimensions report={report} /></div>
          </details>
        ) : (
          <div className="mt-8"><Dimensions report={report} /></div>
        )
      )}
      <Repeats report={report} limit={compact ? 3 : 6} />
      {compact ? (
        <p className="mt-6 text-sm text-muted">What the storyboard avoided and swapped is on <Link href={`/p/${project}/storyboard`} className="text-text underline underline-offset-4 hover:text-accent">the Storyboard step</Link>.</p>
      ) : (
        state.storyboard && <WhatChanged file={state.storyboard} />
      )}
    </section>
  );
}
