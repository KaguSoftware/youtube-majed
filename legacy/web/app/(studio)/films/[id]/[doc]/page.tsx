import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CopyButton } from "@/components/copy-button";
import { LiveRefresh } from "@/components/live-refresh";
import { button } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import {
  type Beat, type Claim, type DocKind, type DocVersion, lastWriting, latestApproved, splitReport, versions,
} from "@/lib/documents";
import { ago, minutes } from "@/lib/format";
import { buildPrompt } from "@/lib/pipeline";
import { narrativeLabel } from "@/lib/narratives";
import { getProject } from "@/lib/projects";
import { machineStatus } from "@/lib/studio";

import { stopClaude } from "../actions";
import { ApproveForm, AskClaudeForm, DemoteForm, PasteForm } from "./forms";

const KINDS: Record<string, DocKind> = { research: "research", script: "script" };
const TITLE: Record<DocKind, string> = { research: "Research", script: "Script" };
const STAGE_OF: Record<DocKind, string> = { research: "staging", script: "scripting" };

export async function generateMetadata({ params }: PageProps<"/films/[id]/[doc]">): Promise<Metadata> {
  const { doc } = await params;
  return { title: KINDS[doc] ? TITLE[KINDS[doc]] : "Document" };
}

export default function DocumentPage({ params, searchParams }: PageProps<"/films/[id]/[doc]">) {
  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-10">
      <Suspense fallback={<div className="h-96 animate-pulse rounded bg-raised" aria-hidden />}>
        <Document params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Document({ params, searchParams }: {
  params: PageProps<"/films/[id]/[doc]">["params"]; searchParams: PageProps<"/films/[id]/[doc]">["searchParams"];
}) {
  await requireUser();
  const { id, doc } = await params;
  const kind = KINDS[doc];
  if (!kind) notFound();
  const sp = await searchParams;
  const p = await getProject(id);
  if (!p) notFound();

  const [all, job, status, research] = await Promise.all([
    versions(id, kind), lastWriting(id, kind), machineStatus(),
    kind === "script" ? latestApproved(id, "research") : Promise.resolve(null),
  ]);
  const live = job && (job.state === "queued" || job.state === "running");
  const wanted = typeof sp.v === "string" ? Number(sp.v) : null;
  const current = (wanted ? all.find((d) => d.version === wanted) : all[0]) ?? null;
  const pasting = sp.paste === "1";
  const base = `/films/${id}/${kind}`;
  const failedAfter = job?.state === "failed" && (!all[0] || new Date(job.created_at) > new Date(all[0].created_at));

  if (kind === "script" && !research) {
    return (
      <Shell p={p} kind={kind}>
        <p className="max-w-[60ch] text-lg text-muted">
          The script is written from approved research, and its citations are checked against it.
        </p>
        <Link href={`/films/${id}/research`} className={`${button.primary} mt-8`}>Go to the research</Link>
      </Shell>
    );
  }

  if (pasting) {
    const project = { id: p.id, topic: p.topic, angle: p.angle, narrative: p.narrative, target_duration: p.target_duration };
    const { system, prompt } = await buildPrompt(kind, project, { researchMarkdown: research?.markdown_raw });
    return (
      <Shell p={p} kind={kind}>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <PasteForm projectId={id} kind={kind} cancelHref={base} />
          <aside className="flex flex-col gap-4 text-sm text-muted lg:pt-7">
            <h2 className="eyebrow text-text">No document to paste yet?</h2>
            <p>
              Copy the studio&rsquo;s own instructions and give them to Claude on claude.ai with web search
              switched on. Paste back the document it returns.
            </p>
            <CopyButton label="Copy instructions for Claude" text={`${system}\n\n${prompt}`} />
            <p className="text-faint">
              It is checked exactly as if the studio had written it{kind === "research" ? ", including whether every source page exists" : ""}.
            </p>
          </aside>
        </div>
      </Shell>
    );
  }

  return (
    <Shell p={p} kind={kind}>
      {live && <LiveRefresh every={5000} />}
      {live && <Writing kind={kind} job={job} offline={status.light.state === "offline"} projectId={id} />}
      {failedAfter && !live && <Failed error={job.error} base={base} />}

      {!current && !live && (
        <Choose projectId={id} kind={kind} base={base} narrative={p.narrative} />
      )}

      {current && (
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="flex min-w-0 flex-col gap-4">
            <Versions all={all} current={current} base={base} />
            <Sheet doc={current} research={research} target={p.target_duration} />
          </div>
          <Rail p={p} kind={kind} doc={current} latest={all[0]} research={research} live={!!live} base={base} />
        </div>
      )}
    </Shell>
  );
}

function Shell({ p, kind, children }: { p: { id: string; topic: string }; kind: DocKind; children: React.ReactNode }) {
  return (
    <article className="flex flex-col gap-8">
      <nav aria-label="Breadcrumb" className="flex flex-wrap gap-2 text-sm text-muted">
        <Link href="/" className="hover:text-text">Films</Link>
        <span aria-hidden className="text-faint">/</span>
        <Link href={`/films/${p.id}`} className="hover:text-text">{p.topic}</Link>
      </nav>
      <h1 className="title-card text-marquee">{TITLE[kind]}</h1>
      {children}
    </article>
  );
}

function Writing({ kind, job, offline, projectId }: {
  kind: DocKind; job: { state: string; started_at: Date | null; created_at: Date }; offline: boolean; projectId: string;
}) {
  const waiting = job.state === "queued";
  const doing = kind === "research" ? "researching" : "writing the script";
  return (
    <section role="status" className="flex flex-col gap-3 rounded-md bg-raised p-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="relative mt-2 flex size-2.5 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex size-2.5 rounded-full bg-accent" />
        </span>
        <div>
          <p className="title-card text-lg">
            {waiting ? (offline ? "Waiting for the studio machine" : "Starting Claude") : `Claude is ${doing}`}
          </p>
          <p className="mt-1 text-sm text-muted">
            {waiting
              ? offline
                ? "The studio machine is offline. Claude starts as soon as it is back, or paste a document yourself."
                : "It will begin in a few seconds."
              : `Started ${ago(job.started_at)}. ${kind === "research"
                ? "Reading sources usually takes five to fifteen minutes."
                : "Usually two to five minutes."} You can leave this page.`}
          </p>
        </div>
      </div>
      <form action={stopClaude.bind(null, projectId, kind)}>
        <button type="submit" className={button.quiet}>Stop</button>
      </form>
    </section>
  );
}

function Failed({ error, base }: { error: string | null; base: string }) {
  const limit = /did not run/i.test(error ?? "");
  return (
    <section role="alert" className="flex flex-col gap-3 rounded-md bg-danger-wash p-6">
      <p className="font-semibold text-danger">
        {limit ? "Claude could not run on the studio machine" : "Claude stopped before finishing"}
      </p>
      <p className="max-w-[75ch] text-sm text-text">{error}</p>
      <p className="text-sm text-muted">
        {limit ? "Usage limits reset on their own. Meanwhile you can paste a document instead." : "You can ask again, or paste a document instead."}
      </p>
      <Link href={`${base}?paste=1`} className={`${button.secondary} self-start`}>Paste a document instead</Link>
    </section>
  );
}

function Choose({ projectId, kind, base, narrative }: { projectId: string; kind: DocKind; base: string; narrative: string | null }) {
  return (
    <div className="grid max-w-4xl gap-10 md:grid-cols-2">
      <div className="flex flex-col gap-4">
        <h2 className="title-card text-title">Have Claude {kind === "research" ? "research it" : "write it"}</h2>
        <p className="text-muted">
          {kind === "research"
            ? "Claude searches the web, reads the sources and writes a list of claims, each tied to a page it read. Every source is checked before you see it."
            : "Claude writes the narration beat by beat from the approved research, each beat citing the claims it relies on."}
        </p>
        <AskClaudeForm projectId={projectId} kind={kind} again={false} narrative={narrative} />
      </div>
      <div className="flex flex-col gap-4">
        <h2 className="title-card text-title">Paste your own</h2>
        <p className="text-muted">Already have it, or Claude is unavailable? Paste a document and it is checked the same way.</p>
        <Link href={`${base}?paste=1`} className={`${button.secondary} self-start`}>Paste a document</Link>
      </div>
    </div>
  );
}

function Versions({ all, current, base }: { all: DocVersion[]; current: DocVersion; base: string }) {
  if (all.length < 2) return null;
  return (
    <nav aria-label="Versions" className="flex flex-wrap gap-1.5">
      {all.slice(0, 8).map((d) => (
        <Link key={d.id} href={d.version === all[0].version ? base : `${base}?v=${d.version}`}
          aria-current={d.id === current.id ? "page" : undefined}
          className={"rounded-md px-2.5 py-1 text-xs ring-1 ring-inset transition-colors duration-150 " +
            (d.id === current.id ? "bg-lifted text-text ring-edge" : "text-muted ring-hairline hover:text-text")}>
          v{d.version} · {d.source === "claude" ? "Claude" : d.source === "paste" ? "pasted" : "seed"} · {STATUS_WORD[d.doc_status]}
        </Link>
      ))}
    </nav>
  );
}

const STATUS_WORD: Record<DocVersion["doc_status"], string> = {
  awaiting: "waiting", invalid: "has problems", valid: "ready to review", approved: "approved",
};

/* ------------------------------------------------------------- the paper */

function Sheet({ doc, research, target }: { doc: DocVersion; research: DocVersion | null; target: number | null }) {
  const errors = splitReport(doc.validator_report?.errors);
  const warnings = splitReport(doc.validator_report?.warnings);
  const claims = doc.parsed_json?.claims ?? [];
  const beats = doc.parsed_json?.beats ?? [];
  const known = Object.fromEntries((research?.parsed_json?.claims ?? []).map((c) => [c.id, c]));
  return (
    <div className="rounded-sm bg-paper text-ink shadow-[0_1px_0_oklch(1_0_0_/_0.04)]">
      {(errors.general.length > 0 || warnings.general.length > 0) && (
        <div className="flex flex-col gap-2 border-b border-ink/10 px-8 py-5 sm:px-12">
          {errors.general.map((e) => <Note key={e} tone="error">{e}</Note>)}
          {warnings.general.map((w) => <Note key={w} tone="warn">{w}</Note>)}
        </div>
      )}
      {doc.kind === "script" && beats.length > 0 && <ScriptStats beats={beats} target={target} />}
      <div className="flex flex-col px-8 py-8 sm:px-12 sm:py-10">
        {doc.kind === "research"
          ? claims.map((c) => <ClaimItem key={c.id} c={c} errors={errors.byItem[c.id]} warnings={warnings.byItem[c.id]} />)
          : beats.map((b) => <BeatItem key={b.id} b={b} claims={known} errors={errors.byItem[b.id]} warnings={warnings.byItem[b.id]} />)}
        {claims.length === 0 && beats.length === 0 && (
          <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-ink/80">{doc.markdown_raw}</pre>
        )}
      </div>
      <details className="border-t border-ink/10 px-8 py-4 text-sm sm:px-12">
        <summary className="cursor-pointer text-ink/60 hover:text-ink">The document as text</summary>
        <pre className="mt-4 max-h-[32rem] overflow-auto whitespace-pre-wrap font-mono text-[12.5px] leading-relaxed text-ink/80">{doc.markdown_raw}</pre>
      </details>
    </div>
  );
}

function Note({ tone, children }: { tone: "error" | "warn"; children: React.ReactNode }) {
  return (
    <p className={"flex gap-2 text-sm " + (tone === "error" ? "text-[oklch(0.48_0.17_25)]" : "text-[oklch(0.5_0.1_70)]")}>
      <span className="font-semibold">{tone === "error" ? "Problem" : "Check"}</span>
      <span className="text-ink/80">{children}</span>
    </p>
  );
}

function Notes({ errors, warnings }: { errors?: string[]; warnings?: string[] }) {
  if (!errors?.length && !warnings?.length) return null;
  return (
    <div className="mt-3 flex flex-col gap-1.5 rounded-sm bg-ink/[0.045] px-3 py-2">
      {errors?.map((e) => <Note key={e} tone="error">{e}</Note>)}
      {warnings?.map((w) => <Note key={w} tone="warn">{w}</Note>)}
    </div>
  );
}

function domain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function ClaimItem({ c, errors, warnings }: { c: Claim; errors?: string[]; warnings?: string[] }) {
  return (
    <section id={c.id} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 border-b border-ink/10 py-5 first:pt-0 last:border-0 last:pb-0">
      <span className="tabular pt-0.5 text-sm font-semibold text-ink/45">{c.id}</span>
      <div className="max-w-[68ch]">
        <p className="text-[1.0625rem] leading-relaxed">{c.claim}</p>
        {c.source && (
          <a href={c.source} target="_blank" rel="noreferrer noopener"
            className="mt-1.5 inline-block max-w-full truncate text-sm text-ink/60 underline decoration-ink/25 underline-offset-2 hover:text-ink hover:decoration-ink">
            {domain(c.source)}<span className="text-ink/40">{c.source.replace(/^https?:\/\/[^/]+/, "").slice(0, 60)}</span>
          </a>
        )}
        <Notes errors={errors} warnings={warnings} />
      </div>
    </section>
  );
}

function ScriptStats({ beats, target }: { beats: Beat[]; target: number | null }) {
  const words = beats.reduce((n, b) => n + b.narration.split(/\s+/).filter(Boolean).length, 0);
  const seconds = Math.round((words / 150) * 60);
  return (
    <p className="flex flex-wrap gap-x-6 gap-y-1 border-b border-ink/10 px-8 py-4 text-sm text-ink/60 sm:px-12">
      <span>{beats.length} beats</span>
      <span className="tabular">{words} words</span>
      <span className="tabular">about {minutes(seconds) || `${seconds}s`} spoken{target ? `, aiming for ${minutes(target)}` : ""}</span>
    </p>
  );
}

function BeatItem({ b, claims, errors, warnings }: {
  b: Beat; claims: Record<string, Claim>; errors?: string[]; warnings?: string[];
}) {
  return (
    <section id={b.id} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 border-b border-ink/10 py-7 first:pt-0 last:border-0 last:pb-0">
      <span className="tabular pt-1 text-sm font-semibold text-ink/45">{b.id}</span>
      <div className="max-w-[68ch]">
        {b.title && <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink/55">{b.title}</h3>}
        <p className="mt-2 text-[1.1875rem] leading-[1.65]">{b.narration}</p>
        <dl className="mt-4 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-ink/45">Picture</dt><dd className="text-ink/75">{b.visual}</dd>
          <dt className="text-ink/45">Mood</dt><dd className="text-ink/75">{b.mood}</dd>
          <dt className="text-ink/45">Backed by</dt>
          <dd className="text-ink/75">
            {b.tone ? <span className="italic">Atmosphere only, no facts asserted</span> : (
              <ul className="flex flex-col gap-1">
                {b.cites.map((id) => (
                  <li key={id}>
                    <span className="tabular font-semibold text-ink/55">{id}</span>{" "}
                    {claims[id] ? claims[id].claim : <span className="text-[oklch(0.48_0.17_25)]">not in the approved research</span>}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </dl>
        <Notes errors={errors} warnings={warnings} />
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- the rail */

function Rail({ p, kind, doc, latest, research, live, base }: {
  p: { id: string; state: string; narrative: string | null; hero_beat?: string | null }; kind: DocKind; doc: DocVersion; latest: DocVersion;
  research: DocVersion | null; live: boolean; base: string;
}) {
  const errors = doc.validator_report?.errors ?? [];
  const warnings = doc.validator_report?.warnings ?? [];
  const isLatest = doc.id === latest.id;
  const stale = kind === "script" && research && doc.upstream_hash && doc.upstream_hash !== research.content_sha;
  const atThisStage = p.state === STAGE_OF[kind];
  const beats = doc.parsed_json?.beats;
  // The look's frame becomes every shot's character reference, so default to
  // the first beat whose picture shows a person.
  const PERSON = /\b(soldier|figure|man|woman|boy|girl|officer|farmer|warrior|traveller|he|she|person|people)\b/i;
  const lead = doc.parsed_json?.meta?.protagonist as string | undefined;
  const defaultBeat = (lead && beats?.find((b) => new RegExp(`\\b${lead.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(b.visual))?.id)
    ?? beats?.find((b) => PERSON.test(b.visual))?.id ?? beats?.[0]?.id;

  return (
    <aside className="flex flex-col gap-6 lg:sticky lg:top-6 lg:self-start">
      <div className="flex flex-col gap-1.5">
        <p className="eyebrow text-muted">Version {doc.version}</p>
        <p className={"title-card text-title " + (doc.doc_status === "invalid" ? "text-danger" : doc.doc_status === "approved" ? "text-ok" : "text-text")}>
          {doc.doc_status === "approved" ? "Approved" : doc.doc_status === "invalid"
            ? `${errors.length} ${errors.length === 1 ? "problem" : "problems"}` : "Ready to review"}
        </p>
        <p className="text-sm text-muted">
          {kind === "research" && (
            <span className="block text-text">
              {doc.parsed_json?.claims?.length ?? 0} claims
              {doc.validator_report?.sources_checked
                ? `, ${doc.validator_report.sources_checked} source ${doc.validator_report.sources_checked === 1 ? "page" : "pages"} checked`
                : ""}
            </span>
          )}
          {kind === "script" && narrativeLabel(doc.parsed_json?.meta?.narrative as string | undefined) && (
            <span className="block text-text">Told as {narrativeLabel(doc.parsed_json?.meta?.narrative as string)?.toLowerCase()}</span>
          )}
          {doc.source === "claude" ? "Written by Claude" : doc.source === "paste" ? `Pasted by ${doc.created_by_name ?? "someone"}` : "Loaded from a file"}
          {" "}{ago(doc.created_at)}.
          {warnings.length > 0 && ` ${warnings.length} ${warnings.length === 1 ? "thing" : "things"} worth checking.`}
        </p>
        {doc.doc_status === "approved" && (
          <p className="text-sm text-muted">Approved by {doc.approved_by_name ?? "someone"} {ago(doc.approved_at)}.</p>
        )}
        {doc.override && (
          <p className="mt-1 rounded-md bg-danger-wash px-3 py-2 text-sm text-text">
            Approved past {doc.override.errors.length} {doc.override.errors.length === 1 ? "problem" : "problems"} by {doc.override.by}.
          </p>
        )}
      </div>

      {stale && (
        <p className="rounded-md bg-lifted px-3 py-2 text-sm text-caution">
          The research changed after this script was written. Its citations may point at claims that moved or no longer exist.
        </p>
      )}

      {!isLatest && (
        <p className="text-sm text-muted">
          An older version. <Link href={base} className="text-text underline underline-offset-2">See the latest</Link>.
        </p>
      )}

      {isLatest && atThisStage && doc.doc_status !== "approved" && !live && (
        <ApproveForm projectId={p.id} kind={kind} artifactId={doc.id} errors={errors}
          beats={kind === "script" ? beats : undefined} defaultBeat={defaultBeat} />
      )}

      {atThisStage && !live && (
        <div className="flex flex-col gap-3 border-t border-hairline pt-6">
          <AskClaudeForm projectId={p.id} kind={kind} again narrative={p.narrative} />
          <Link href={`${base}?paste=1`} className={button.quiet}>Paste a new version</Link>
        </div>
      )}

      {!atThisStage && p.state !== "idea" && p.state !== "staging" && !(kind === "script" && p.state === "scripting") && (
        <div className="border-t border-hairline pt-6">
          <DemoteForm projectId={p.id} to={STAGE_OF[kind] as "staging" | "scripting"}
            label={kind === "research" ? "Go back to the research" : "Go back to the script"} />
          <p className="mt-2 text-xs text-faint">Later work is kept and marked as needing another look.</p>
        </div>
      )}
    </aside>
  );
}
