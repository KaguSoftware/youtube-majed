import Link from "next/link";
import { Suspense } from "react";

import { Filmstrip } from "@/components/filmstrip";
import { StageStrip } from "@/components/stage-strip";
import { button } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { ago, minutes } from "@/lib/format";
import { mediaUrls } from "@/lib/media";
import { listProjects, nextStep, type NextStep, type ProjectRow } from "@/lib/projects";

import { NewFilmForm } from "./new/new-film-form";

export default function FilmsPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-12">
      <Suspense fallback={<ListSkeleton />}>
        <Films />
      </Suspense>
    </div>
  );
}

async function Films() {
  await requireUser();
  const projects = await listProjects();
  if (projects.length === 0) return <FirstFilm />;

  const sheets = projects.flatMap((p) => (p.sheet ? [p.sheet.key] : []));
  const urls = await mediaUrls(sheets).catch(() => ({} as Record<string, string>));
  const waitingOnYou = projects.filter((p) => nextStep(p).tone !== "machine" && nextStep(p).tone !== "done").length;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-6 pb-10">
        <div>
          <h1 className="title-card text-marquee">Films</h1>
          <p className="mt-2 text-muted">
            {projects.length} {projects.length === 1 ? "film" : "films"}
            {waitingOnYou ? `, ${waitingOnYou} waiting on you` : ""}
          </p>
        </div>
        <Link href="/new" className={button.primary}>New film</Link>
      </div>
      <ul className="flex flex-col border-t border-hairline">
        {projects.map((p) => (
          <FilmRow key={p.id} project={p} sheetUrl={p.sheet ? urls[p.sheet.key] : undefined} />
        ))}
      </ul>
    </>
  );
}

const TONE: Record<NextStep["tone"], { dot: string; text: string; word: string }> = {
  you: { dot: "bg-accent", text: "text-text", word: "Your turn" },
  machine: { dot: "bg-muted", text: "text-muted", word: "In progress" },
  problem: { dot: "ring-2 ring-inset ring-danger", text: "text-danger", word: "Needs attention" },
  done: { dot: "bg-ok", text: "text-muted", word: "Done" },
};

function FilmRow({ project: p, sheetUrl }: { project: ProjectRow; sheetUrl?: string }) {
  const step = nextStep(p);
  const tone = TONE[step.tone];
  return (
    <li className="border-b border-hairline">
      <Link
        href={`/films/${p.id}`}
        className="group grid gap-x-10 gap-y-5 px-3 py-6 -mx-3 rounded-sm transition-colors duration-150 ease-out-quart hover:bg-raised md:grid-cols-[1fr_auto]"
      >
        <div className="min-w-0">
          <h2 className="title-card text-title text-text group-hover:text-accent transition-colors duration-150">
            {p.topic}
          </h2>
          <p className="mt-1.5 flex flex-wrap gap-x-3 text-sm text-faint">
            {p.angle && <span className="min-w-0 max-w-full truncate text-muted md:max-w-[60ch]">{p.angle}</span>}
            {p.target_duration && <span>{minutes(p.target_duration)}</span>}
            <span>Updated {ago(p.activity_at)}</span>
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-start gap-x-8 gap-y-4 md:justify-end">
          <StageStrip state={p.state} />
          <p className={`flex items-start gap-2 text-sm md:w-60 ${tone.text}`}>
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
            <span><span className="sr-only">{tone.word}: </span>{step.text}</span>
          </p>
        </div>
        {p.sheet && sheetUrl && (
          <div className="min-w-0 md:col-span-2">
            <Filmstrip sheet={p.sheet} url={sheetUrl} title={p.topic} count={8} />
          </div>
        )}
      </Link>
    </li>
  );
}

function FirstFilm() {
  return (
    <div className="grid gap-12 pt-6 lg:grid-cols-[1fr_minmax(0,34rem)]">
      <div>
        <p className="eyebrow text-accent">Studio</p>
        <h1 className="title-card mt-4 text-marquee">Your first film starts with a question.</h1>
        <p className="mt-6 max-w-[52ch] text-lg text-muted">
          Give it a topic. Claude researches it with sources, writes a narrated script for you to
          approve, then the studio paints every shot and cuts the film.
        </p>
      </div>
      <NewFilmForm />
    </div>
  );
}

function ListSkeleton() {
  return (
    <div aria-hidden>
      <div className="h-14 w-48 animate-pulse rounded bg-raised" />
      <div className="mt-3 h-4 w-36 animate-pulse rounded bg-raised" />
      <div className="mt-10 flex flex-col border-t border-hairline">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-3 border-b border-hairline py-6">
            <div className="h-8 w-2/3 animate-pulse rounded bg-raised" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-raised" />
          </div>
        ))}
      </div>
    </div>
  );
}
