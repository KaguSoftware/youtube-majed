import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { LiveRefresh } from "@/components/live-refresh";
import { button } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { latestApproved } from "@/lib/documents";
import { ago } from "@/lib/format";
import { DEFAULT_BOX, lockedStyle, paintingNow, presets, styleRuns } from "@/lib/looks";
import { mediaUrls } from "@/lib/media";
import { getProject } from "@/lib/projects";
import { machineStatus } from "@/lib/studio";

import { CropEditor } from "./crop-editor";
import { PaintForm } from "./paint-form";

export const metadata: Metadata = { title: "Look" };

export default function LookPage({ params, searchParams }: PageProps<"/films/[id]/look">) {
  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-10">
      <Suspense fallback={<div className="h-96 animate-pulse rounded bg-raised" aria-hidden />}>
        <Look params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Look({ params, searchParams }: {
  params: PageProps<"/films/[id]/look">["params"]; searchParams: PageProps<"/films/[id]/look">["searchParams"];
}) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const p = await getProject(id);
  if (!p) notFound();
  const [script, library, runs, painting, locked, status] = await Promise.all([
    latestApproved(id, "script"), presets(), styleRuns(id), paintingNow(id), lockedStyle(id), machineStatus(),
  ]);
  const beats = script?.parsed_json?.beats ?? [];
  const period = (script?.parsed_json?.meta?.period as string | undefined) ?? null;

  const shell = (children: React.ReactNode) => (
    <article className="flex flex-col gap-8">
      <nav aria-label="Breadcrumb" className="flex flex-wrap gap-2 text-sm text-muted">
        <Link href="/" className="hover:text-text">Films</Link>
        <span aria-hidden className="text-faint">/</span>
        <Link href={`/films/${id}`} className="hover:text-text">{p.topic}</Link>
      </nav>
      <h1 className="title-card text-marquee">Look</h1>
      {children}
    </article>
  );

  if (!script) {
    return shell(
      <>
        <p className="max-w-[60ch] text-lg text-muted">The look is painted from a beat of the approved script.</p>
        <Link href={`/films/${id}/script`} className={`${button.primary} self-start`}>Go to the script</Link>
      </>,
    );
  }

  // Candidates painted before the current script was approved belong to a
  // script nobody is reviewing any more (DESIGN.md "Staleness"): never offered.
  const latest = runs[0] && script.approved_at && new Date(runs[0].created_at) > new Date(script.approved_at)
    ? runs[0] : undefined;
  const keys = [...new Set([...(latest?.candidates_json.map((c) => c.key) ?? []), ...(painting?.keys ?? [])])];
  const urls = await mediaUrls(keys).catch(() => ({} as Record<string, string>));
  const chosenIndex = typeof sp.pick === "string" ? Number(sp.pick) : null;
  const chosen = latest && chosenIndex !== null ? latest.candidates_json[chosenIndex] : null;
  const prefix = latest?.prompt_prefix ?? library[0]?.preset_json.prompt_prefix ?? "";
  const presetList = library.map((s) => ({ id: s.id, name: s.name, prefix: s.preset_json.prompt_prefix }));

  return shell(
    <>
      {painting && <LiveRefresh every={4000} />}
      {locked && !chosen && (
        <p className="rounded-md bg-raised px-4 py-3 text-sm text-muted">
          A look is locked for this film. Painting and locking another replaces it for the next render.
        </p>
      )}

      {painting && (
        <section role="status" className="flex flex-col gap-4">
          <p className="title-card text-title">
            {painting.state === "queued"
              ? status.gpu.state === "offline" ? "Waiting for the studio machine" : "Starting the painter"
              : `Painting look ${Math.min((painting.keys?.length ?? 0) + 1, painting.payload.seeds.length)} of ${painting.payload.seeds.length}`}
          </p>
          <p className="text-sm text-muted">
            {painting.state === "queued" && status.gpu.state === "offline"
              ? "The studio machine is offline. Painting starts when it is back."
              : `About fifteen seconds each, plus a minute if the painter is just waking up.${painting.started_at ? ` Started ${ago(painting.started_at)}.` : ""}`}
          </p>
          <Frames keys={painting.keys ?? []} total={painting.payload.seeds.length} urls={urls} />
        </section>
      )}

      {!painting && latest && !chosen && (
        <section aria-labelledby="pick" className="flex flex-col gap-4">
          <h2 id="pick" className="title-card text-title">Pick the one that feels like this film</h2>
          <p className="text-sm text-muted">Painted {ago(latest.created_at)} from {latest.beat_id}. Choose one, then frame its character.</p>
          {period && (
            <p className="max-w-[75ch] text-sm text-caution">
              Check the period before you choose: helmets, clothing, buildings and lights should all belong to {period}.
              The painter does not know history; if none is right, ask for three more or describe the look differently.
            </p>
          )}
          <ul className="grid gap-3 md:grid-cols-3">
            {latest.candidates_json.map((c, i) => (
              <li key={c.key}>
                <Link href={`/films/${id}/look?pick=${i}`} className="group block overflow-hidden rounded-sm ring-1 ring-hairline transition-shadow duration-150 hover:ring-2 hover:ring-accent focus-visible:ring-2 focus-visible:ring-accent">
                  {urls[c.key]
                    // eslint-disable-next-line @next/next/no-img-element -- presigned media
                    ? <img src={urls[c.key]} alt={`Candidate look ${i + 1}`} className="aspect-[832/480] w-full object-cover" />
                    : <div className="aspect-[832/480] w-full bg-raised" />}
                  <span className="block px-3 py-2 text-sm text-muted group-hover:text-text">Look {i + 1}: choose this one</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {chosen && latest && (
        <section aria-labelledby="crop" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <h2 id="crop" className="title-card text-title">Frame the character</h2>
            <Link href={`/films/${id}/look`} className={button.quiet}>Choose a different look</Link>
          </div>
          {urls[chosen.key]
            ? <CropEditor projectId={id} runId={latest.id} index={chosenIndex!} url={urls[chosen.key]}
                initial={locked?.preset_json.hero_full === chosen.key ? locked.preset_json.crop_box : DEFAULT_BOX}
                description={locked?.preset_json.hero_full === chosen.key ? locked.preset_json.prompt_prefix : (latest.prompt_prefix ?? "")} />
            : <p className="text-sm text-danger">This frame is not available from the media store.</p>}
        </section>
      )}

      {!painting && !chosen && (
        <section aria-labelledby="paint" className="flex max-w-2xl flex-col gap-5 border-t border-hairline pt-8">
          <h2 id="paint" className="title-card text-title">{latest ? "Not right yet?" : "Paint three candidate looks"}</h2>
          {!latest && runs[0] && (
            <p className="text-sm text-muted">The script changed since the last looks were painted, so they are set aside.</p>
          )}
          <PaintForm projectId={id} presets={presetList} beats={beats} heroBeat={p.hero_beat} prefix={prefix} again={!!latest} />
        </section>
      )}
    </>,
  );
}

function Frames({ keys, total, urls }: { keys: string[]; total: number; urls: Record<string, string> }) {
  return (
    <ul className="grid gap-3 md:grid-cols-3">
      {Array.from({ length: total }, (_, i) => (
        <li key={i} className="overflow-hidden rounded-sm bg-raised">
          {keys[i] && urls[keys[i]]
            // eslint-disable-next-line @next/next/no-img-element -- presigned media
            ? <img src={urls[keys[i]]} alt={`Candidate look ${i + 1}`} className="aspect-[832/480] w-full object-cover" />
            : <div className="aspect-[832/480] w-full animate-pulse bg-raised" />}
        </li>
      ))}
    </ul>
  );
}
