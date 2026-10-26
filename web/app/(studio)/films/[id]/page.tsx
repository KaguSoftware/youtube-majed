import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Filmstrip } from "@/components/filmstrip";
import { LiveRefresh } from "@/components/live-refresh";
import { StageStrip } from "@/components/stage-strip";
import { button } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { lastWriting, latestApproved, type DocKind, type DocVersion } from "@/lib/documents";
import { ago, minutes } from "@/lib/format";
import { lockedStyle } from "@/lib/looks";
import { mediaUrl } from "@/lib/media";
import { one } from "@/lib/db";
import { getProject, nextStep, type ProjectRow } from "@/lib/projects";

import { AskClaudeForm } from "./[doc]/forms";
import { Editing } from "./editing";
import { Progress } from "./progress";
import { RenderButton } from "./render-button";
import { stopRender } from "./look/actions";

export default function FilmPage({ params, searchParams }: PageProps<"/films/[id]">) {
  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-10">
      <Suspense fallback={<div className="h-40 animate-pulse rounded bg-raised" aria-hidden />}>
        <Film params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const FILM_STATES = new Set(["editing", "finalized", "posted"]);

async function Film({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const { id } = await params;
  const { cut } = await searchParams;
  const p = await getProject(id);
  if (!p) notFound();
  const step = nextStep(p);
  const [sheetUrl, research, script] = await Promise.all([
    p.sheet ? mediaUrl(p.sheet.key).catch(() => null) : Promise.resolve(null),
    latestApproved(id, "research"),
    latestApproved(id, "script"),
  ]);
  const live = p.job && (p.job.state === "queued" || p.job.state === "running");

  return (
    <article className="flex flex-col gap-10">
      {live && <LiveRefresh every={6000} />}
      <nav aria-label="Breadcrumb">
        <Link href="/" className="text-sm text-muted hover:text-text">Films</Link>
      </nav>
      <header className="flex flex-col gap-4">
        <h1 className="title-card text-marquee max-w-[22ch]">{p.topic}</h1>
        <p className="flex flex-wrap gap-x-4 text-sm text-faint">
          {p.target_duration && <span>{minutes(p.target_duration)}</span>}
          <span>Started {ago(p.created_at)}</span>
        </p>
        {p.angle && <p className="max-w-[65ch] text-lg text-muted">{p.angle}</p>}
      </header>
      <StageStrip state={p.state} size="full" />

      {FILM_STATES.has(p.state) ? (
        <Editing p={p} cutParam={typeof cut === "string" ? cut : undefined} />
      ) : (
        <section aria-labelledby="next" className="flex flex-col gap-5 border-t border-hairline pt-8">
          <h2 id="next" className="eyebrow text-muted">Next</h2>
          <StagePanel p={p} step={step} />
        </section>
      )}

      {(research || script) && (
        <section aria-labelledby="docs" className="flex flex-col gap-3 border-t border-hairline pt-8">
          <h2 id="docs" className="eyebrow text-muted">Approved</h2>
          <ul className="flex flex-col divide-y divide-hairline">
            {research && <DocLine p={p} kind="research" doc={research} />}
            {script && <DocLine p={p} kind="script" doc={script} />}
          </ul>
        </section>
      )}

      {p.sheet && sheetUrl && !FILM_STATES.has(p.state) && <Filmstrip sheet={p.sheet} url={sheetUrl} title={p.topic} count={10} />}
    </article>
  );
}

function DocLine({ p, kind, doc }: { p: ProjectRow; kind: DocKind; doc: DocVersion }) {
  const n = kind === "research" ? doc.parsed_json?.claims?.length : doc.parsed_json?.beats?.length;
  return (
    <li>
      <Link href={`/films/${p.id}/${kind}`} className="group flex flex-wrap items-baseline gap-x-4 py-3">
        <span className="title-card text-lg group-hover:text-accent">{kind === "research" ? "Research" : "Script"}</span>
        <span className="text-sm text-muted">
          v{doc.version}, {n ?? 0} {kind === "research" ? "claims" : "beats"}, approved by {doc.approved_by_name ?? "someone"} {ago(doc.approved_at)}
          {doc.override ? ", past its problems" : ""}
        </span>
      </Link>
    </li>
  );
}

async function StagePanel({ p, step }: { p: ProjectRow; step: ReturnType<typeof nextStep> }) {
  const headline = (
    <p className={`title-card text-title ${step.tone === "problem" ? "text-danger" : "text-text"}`}>{step.text}</p>
  );

  if (p.state === "idea") {
    return (
      <div className="flex flex-col gap-5">
        {headline}
        <p className="max-w-[60ch] text-muted">
          Claude searches the web, reads the sources and writes the claims the film will rest on. You check
          them before a word of the script is written.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <AskClaudeForm projectId={p.id} kind="research" again={false} />
          <Link href={`/films/${p.id}/research?paste=1`} className={button.quiet}>Paste research instead</Link>
        </div>
      </div>
    );
  }

  if (p.state === "staging" || p.state === "scripting") {
    const kind: DocKind = p.state === "staging" ? "research" : "script";
    const job = await lastWriting(p.id, kind);
    const doc = kind === "research" ? p.research : p.script;
    const writing = job && (job.state === "queued" || job.state === "running");
    return (
      <div className="flex flex-col gap-5">
        {headline}
        {kind === "script" && !doc && !writing && (
          <p className="max-w-[60ch] text-muted">
            The research is approved. The script is written from it, beat by beat, each beat citing its claims.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {doc || writing || job?.state === "failed" ? (
            <Link href={`/films/${p.id}/${kind}`} className={button.primary}>
              {writing ? `Watch the ${kind === "research" ? "research" : "script"} progress`
                : doc?.doc_status === "invalid" ? `See the problems` : `Review the ${kind === "research" ? "research" : "script"}`}
            </Link>
          ) : (
            <>
              <AskClaudeForm projectId={p.id} kind={kind} again={false} />
              <Link href={`/films/${p.id}/${kind}?paste=1`} className={button.quiet}>Paste {kind === "research" ? "research" : "a script"} instead</Link>
            </>
          )}
        </div>
      </div>
    );
  }

  if (p.state === "style") {
    return (
      <div className="flex flex-col gap-5">
        {headline}
        <p className="max-w-[60ch] text-muted">
          The script is approved{p.hero_beat ? `. Three candidate looks are painted from ${p.hero_beat}` : ""}; you choose one
          and frame its character, and every shot in the film is painted to match.
        </p>
        <Link href={`/films/${p.id}/look`} className={`${button.primary} self-start`}>
          {p.job?.kind === "style" && (p.job.state === "queued" || p.job.state === "running") ? "Watch the looks being painted" : "Choose the look"}
        </Link>
      </div>
    );
  }

  const shotsFor = (seconds: number | null) => Math.max(6, Math.round(((seconds ?? 180) / 60) * 10));
  const renderMinutes = Math.ceil((shotsFor(p.target_duration) * 1.2 * 15.3) / 60) + 2;

  if (p.state === "production") {
    const job = p.job?.kind === "production" ? p.job : null;
    const live = job && (job.state === "queued" || job.state === "running");
    if (live) {
      const total = await one<{ n: number }>(
        "SELECT coalesce((payload->>'target_shots')::int, 0) AS n FROM jobs WHERE id = $1", [job.id]);
      return (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            {headline}
            <form action={stopRender.bind(null, p.id)}>
              <button type="submit" className={button.quiet}>Stop the render</button>
            </form>
          </div>
          <Progress projectId={p.id} totalHint={total?.n ?? 0} />
        </div>
      );
    }
    const look = await lockedStyle(p.id);
    const lookUrl = look ? await mediaUrl(look.preset_json.hero_full).catch(() => null) : null;
    return (
      <div className="flex flex-col gap-6">
        {job?.state === "failed" ? (
          <div role="alert" className="flex flex-col gap-2 rounded-md bg-danger-wash p-5">
            <p className="font-semibold text-danger">The last render stopped</p>
            <p className="max-w-[80ch] text-sm text-text">{explainFailure(job.error)}</p>
            <details className="text-xs text-muted">
              <summary className="cursor-pointer hover:text-text">Technical details</summary>
              <p className="mt-2 font-mono">{job.error}</p>
            </details>
          </div>
        ) : headline}
        {look && lookUrl && <LookSummary url={lookUrl} box={look.preset_json.crop_box} projectId={p.id} />}
        {look
          ? <RenderButton projectId={p.id} again={job?.state === "failed"} minutes={renderMinutes} />
          : <Link href={`/films/${p.id}/look`} className={`${button.primary} self-start`}>Choose the look</Link>}
      </div>
    );
  }

  // Editing and beyond are the editing room (./editing.tsx), not a panel.
  return headline;
}

/** The worker's gate messages, in the studio's words (web/PRODUCT.md). */
function explainFailure(error: string | null): string {
  const e = error ?? "";
  if (e.startsWith("narration")) {
    return "The check that listens back to the narration thought some words were missing from the recording. " +
      "Rendering again often clears it; if it keeps happening, rephrase the beats it names in the script.";
  }
  if (e.startsWith("validate")) return "The research or script has problems that block the render. Open them to see what to fix.";
  if (e.startsWith("inputs")) return "The research or script changed after this render was started. Render again to use the latest approved versions.";
  if (e.startsWith("plan")) return "The shots could not be planned from the narration timing. Rendering again usually works.";
  if (/worker lost|attempt/.test(e)) return "The studio machine was interrupted several times. Check that it is plugged in and awake, then render again.";
  return "Something went wrong on the studio machine. Rendering again keeps every frame already painted.";
}

function LookSummary({ url, box, projectId }: { url: string; box: [number, number, number, number]; projectId: string }) {
  const [x0, y0, x1, y1] = box;
  return (
    <div className="flex items-center gap-5">
      <div className="h-28 overflow-hidden rounded-sm bg-raised" style={{ aspectRatio: String(((x1 - x0) * 832) / ((y1 - y0) * 480)) }}>
        <div className="size-full" style={{
          backgroundImage: `url(${url})`, backgroundSize: `${100 / (x1 - x0)}% ${100 / (y1 - y0)}%`,
          backgroundPosition: `${x1 - x0 < 1 ? (x0 / (1 - (x1 - x0))) * 100 : 0}% ${y1 - y0 < 1 ? (y0 / (1 - (y1 - y0))) * 100 : 0}%`,
        }} />
      </div>
      <div className="text-sm text-muted">
        <p className="text-text">The look is locked.</p>
        <p>Every shot is painted with this character as its reference.</p>
        <Link href={`/films/${projectId}/look`} className="text-text underline underline-offset-2">Change the look</Link>
      </div>
    </div>
  );
}
