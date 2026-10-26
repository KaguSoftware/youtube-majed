import Link from "next/link";

import { LiveRefresh } from "@/components/live-refresh";
import { button } from "@/components/ui";
import {
  currentVersion, exportOf, getCut, lastEdit, listCuts, shotMarks, timecode, type Cut,
} from "@/lib/cuts";
import { ago } from "@/lib/format";
import { mediaUrl } from "@/lib/media";
import type { ProjectRow } from "@/lib/projects";

import { chooseCut, prepareDownload } from "./edit-actions";
import { EditingRoom, type CutView, type LiveEdit } from "./editing-room";
import { Publish } from "./publish";

/**
 * The film stage (state `editing` and after): the current cut playing, the
 * change being asked for or made, and every earlier cut a click away.
 * `?cut=N` watches another cut without making it the film.
 */
export async function Editing({ p, cutParam }: { p: ProjectRow; cutParam: string | undefined }) {
  const current = await currentVersion(p.id);
  if (current === null) return <p className="text-muted">The film is not ready yet.</p>;
  const asked = Number(cutParam);
  const viewingVersion = Number.isInteger(asked) && asked > 0 ? asked : current;
  const [cut, cuts, edit] = await Promise.all([getCut(p.id, viewingVersion), listCuts(p.id), lastEdit(p.id)]);
  if (!cut) return <p className="text-muted">That cut does not exist. <Link href={`/films/${p.id}`} className="underline">Back to the film</Link></p>;
  const isCurrent = cut.version === current;
  const parent = cut.parent_version ? await getCut(p.id, cut.parent_version) : null;
  const [viewing, earlier, download] = await Promise.all([
    view(p.id, cut), parent ? view(p.id, parent) : Promise.resolve(null), exportOf(p.id, cut.version),
  ]);
  const live: LiveEdit | null = edit && (edit.state === "queued" || edit.state === "running")
    ? { id: edit.id, request: edit.payload.request, at: edit.payload.at, chunked: !!cut.hls } : null;
  const currentCut = cuts.find((c) => c.version === current);
  const failed = edit && !live && (edit.state === "failed") && currentCut &&
    new Date(edit.created_at) > new Date(currentCut.created_at) ? edit : null;
  const downloadUrl = download?.state === "done" && download.film ? await mediaUrl(download.film).catch(() => null)
    : cut.film ? await mediaUrl(cut.film).catch(() => null) : null;

  return (
    <div className="flex flex-col gap-8">
      {!isCurrent && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-md bg-raised px-5 py-4">
          <p className="text-sm text-text">
            You are watching <strong>cut {cut.version}</strong>. The film is cut {current}.
          </p>
          <div className="flex flex-wrap gap-2">
            <form action={chooseCut.bind(null, p.id, cut.version)}>
              <button type="submit" className={button.secondary}>Make cut {cut.version} the film</button>
            </form>
            <Link href={`/films/${p.id}`} className={button.quiet}>Back to the film</Link>
          </div>
        </div>
      )}

      {isCurrent && cut.change && !live && (
        <div className="flex flex-col gap-3" aria-labelledby="latest-change">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="latest-change" className="eyebrow text-muted">
              Latest change{cut.by ? `, asked by ${cut.by}` : ""} {ago(cut.created_at)}
            </h2>
            {cut.parent_version && (
              <form action={chooseCut.bind(null, p.id, cut.parent_version)}>
                <button type="submit" className={button.quiet}>Undo</button>
              </form>
            )}
          </div>
          <p className="max-w-[70ch] text-lg text-text">{cut.change.summary || "Changed as asked."}</p>
          <p className="text-sm text-faint">You asked: &ldquo;{cut.change.request}&rdquo;</p>
        </div>
      )}

      {failed && (
        <div role="alert" className="flex flex-col gap-2 rounded-md bg-danger-wash p-5">
          <p className="font-semibold text-danger">The last change was not made</p>
          <p className="max-w-[80ch] text-sm text-text">
            {explainEditFailure(failed.error)} You asked: &ldquo;{failed.payload.request}&rdquo;
          </p>
        </div>
      )}

      <EditingRoom projectId={p.id} viewing={viewing} earlier={earlier} isCurrent={isCurrent} live={live} />

      <Download projectId={p.id} version={cut.version} state={download?.state ?? null} url={downloadUrl}
        size={download?.size ?? null} />

      {isCurrent && <Publish p={p} cut={cut} />}

      <Cuts projectId={p.id} cuts={cuts} current={current} viewing={cut.version} />
    </div>
  );
}

async function view(projectId: string, cut: Cut): Promise<CutView> {
  const [marks, sheetUrl, filmUrl] = await Promise.all([
    shotMarks(projectId, cut.version),
    cut.sheet ? mediaUrl(cut.sheet.key).catch(() => null) : Promise.resolve(null),
    !cut.hls && cut.film ? mediaUrl(cut.film).catch(() => null) : Promise.resolve(null),
  ]);
  const touched = new Set([
    ...(cut.change?.shots ?? []),
    ...(cut.change?.ops ?? []).map((o) => String(o.args.shot_id ?? "")).filter(Boolean),
  ]);
  const starts = marks.filter((m) => touched.has(m.id)).map((m) => m.start);
  return {
    version: cut.version,
    source: cut.hls ? { kind: "hls", url: `/api/films/${projectId}/cuts/${cut.version}/master.m3u8` }
      : filmUrl ? { kind: "mp4", url: filmUrl } : null,
    sheet: cut.sheet && sheetUrl ? { url: sheetUrl, cols: cut.sheet.cols, rows: cut.sheet.rows,
      thumb: cut.sheet.thumb, shots: cut.sheet.shots } : null,
    marks,
    changed: [...touched],
    focus: starts.length ? Math.min(...starts) : null,
    change: cut.change ? { request: cut.change.request, summary: cut.change.summary } : null,
    duration: cut.duration,
  };
}

function Download({ projectId, version, state, url, size }: {
  projectId: string; version: number; state: string | null; url: string | null; size: number | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      {url ? (
        <a href={url} download className={button.secondary}>
          Download this cut{size ? ` (${Math.round(size / 1e6)} MB)` : ""}
        </a>
      ) : state === "queued" || state === "running" ? (
        <p className="text-sm text-muted" aria-live="polite">
          <LiveRefresh every={5000} />
          <span className="mr-2 inline-block size-2 rounded-full bg-accent motion-safe:animate-pulse" aria-hidden />
          Preparing the download. The link appears here when it is ready, in about a minute.
        </p>
      ) : (
        <form action={prepareDownload.bind(null, projectId, version)} className="flex flex-wrap items-center gap-3">
          <button type="submit" className={button.secondary}>Prepare a download</button>
          <span className="text-sm text-faint">An mp4 of this cut, ready in about a minute.</span>
        </form>
      )}
    </div>
  );
}

/** Every cut, newest first: what was asked, what Claude did, who and when. */
function Cuts({ projectId, cuts, current, viewing }: {
  projectId: string; cuts: Cut[]; current: number; viewing: number;
}) {
  if (cuts.length < 2) return null;
  return (
    <section aria-labelledby="cuts" className="flex flex-col gap-3 border-t border-hairline pt-8">
      <h2 id="cuts" className="eyebrow text-muted">Cuts</h2>
      <ol className="flex flex-col divide-y divide-hairline">
        {cuts.map((c) => {
          const isFilm = c.version === current;
          return (
            <li key={c.version} className={"flex flex-wrap items-start gap-x-6 gap-y-2 py-4 " + (c.version === viewing ? "-mx-3 rounded-sm bg-raised px-3" : "")}>
              <div className="w-20 shrink-0">
                <p className="tabular font-semibold text-text">Cut {c.version}</p>
                {isFilm && <p className="eyebrow text-accent">The film</p>}
              </div>
              <div className="min-w-0 flex-1">
                {c.change ? (
                  <>
                    <p className="text-text">&ldquo;{c.change.request}&rdquo;</p>
                    {c.change.summary && <p className="mt-1 max-w-[75ch] text-sm text-muted">{c.change.summary}</p>}
                  </>
                ) : (
                  <p className="text-text">Rendered from the script</p>
                )}
                <p className="mt-1 text-xs text-faint">
                  {c.by ? `${c.by}, ` : ""}{ago(c.created_at)}
                  {c.parent_version ? `, made from cut ${c.parent_version}` : ""}
                  {c.change?.at != null ? `, at ${timecode(c.change.at)}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                {c.version !== viewing && (
                  <Link href={c.version === current ? `/films/${projectId}` : `/films/${projectId}?cut=${c.version}`}
                    className={button.quiet}>Watch</Link>
                )}
                {!isFilm && (
                  <form action={chooseCut.bind(null, projectId, c.version)}>
                    <button type="submit" className={button.quiet}>Make this the film</button>
                  </form>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The worker's reasons, in the studio's words. */
function explainEditFailure(error: string | null): string {
  const e = error ?? "";
  if (/film is at version/.test(e)) return "The film changed while this was being made (another cut was chosen), so it was not applied.";
  if (/Claude did not run/.test(e)) return "Claude is not available right now (usually a usage limit). Try again later.";
  if (/took over/.test(e)) return "Claude took too long on this request. Try asking for one change at a time.";
  if (/unplayable|edit:/.test(e)) return "The change would have broken the film, so nothing was changed.";
  return "Something went wrong on the studio machine. The film is unchanged; try again.";
}
