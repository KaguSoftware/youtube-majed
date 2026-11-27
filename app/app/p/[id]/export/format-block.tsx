"use client";
import type { MediaInfo } from "@studio/schema";
import { Download, FolderOpen } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { JobError, JobProgress } from "@/components/job-progress";
import { button } from "@/components/ui";
import { call, fileUrl, type Job } from "@/lib/api";
import { clock } from "@/lib/format";

const mb = (bytes: number) => (bytes >= 100 * 1_048_576 ? `${(bytes / 1_048_576).toFixed(0)} MB` : `${(bytes / 1_048_576).toFixed(1)} MB`);
/** "/…/projects/x/renders/reel/x.mp4" → "renders/reel/x.mp4", the path the worker serves and reveals. */
export const rel = (file: string) => file.slice(file.indexOf("/renders/") + 1);

/** What both exports leave behind, the part the page shows. */
export type Made = {
  file: string;
  media: MediaInfo;
  encode: { crf: number; preset: string; reencoded: boolean; capMB: number; firstPassMB: number };
  timings: { totalMs: number };
};

/** The outline of the frame the file is drawn in: wide or tall, so the two exports tell apart before a word is read. */
function Frame({ tall }: { tall: boolean }) {
  return <span aria-hidden className={`inline-block shrink-0 rounded-[3px] bg-raised ring-1 ring-edge ${tall ? "h-11 w-[25px]" : "h-[25px] w-11"}`} />;
}

const REVEAL = z.object({ ok: z.boolean() }).loose();

/**
 * One deliverable on the Export page: a file in one frame, with its own button, its own progress, and once it exists
 * its size, length, encode and the ways to get at it. `extras` are the files that go with it (the Reel's subtitles).
 */
export function FormatBlock(p: {
  project: string;
  tall: boolean;
  title: string;
  /** one line of what the file is, in plain words */
  spec: string;
  /** the format this project was written for gets the primary button and goes first */
  native: boolean;
  made: Made | null;
  stale: boolean;
  /** why the button is off, when it is */
  blocked?: string;
  /** names the action: "Export the YouTube file" */
  action: string;
  jobs: Job[];
  lastFinished: Job | undefined;
  onExport: () => void;
  /** files that go with this one, shown under its facts (the Reel's subtitles) */
  extras?: React.ReactNode;
  /** anything else this deliverable needs under its own block */
  children?: React.ReactNode;
}) {
  const [revealError, setRevealError] = useState<string | null>(null);
  const busy = p.jobs.length > 0;
  const reveal = (file: string) => {
    setRevealError(null);
    void call(`/projects/${p.project}/reveal`, REVEAL, { body: { file: rel(file) } }).catch((e: Error) => setRevealError(e.message));
  };
  const m = p.made?.media;
  const e = p.made?.encode;
  const again = Boolean(p.made);
  const headingId = `${p.tall ? "reel" : "yt"}-h`;

  return (
    <section aria-labelledby={headingId} className={`border-t border-hairline pt-6 ${p.native ? "lg:order-first" : ""}`}>
      <div className="flex items-start gap-4">
        <Frame tall={p.tall} />
        <div className="min-w-0">
          <h2 id={headingId} className="text-lg font-semibold">
            {p.title}
          </h2>
          <p className="mt-1 text-sm text-muted">{p.spec}</p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" onClick={p.onExport} disabled={busy || Boolean(p.blocked)} className={p.native && (!again || p.stale) ? button.primary : button.secondary}>
          {again ? "Export again" : p.action}
        </button>
        {p.made && (
          <>
            <a href={fileUrl(p.project, rel(p.made.file), true)} className={p.native ? button.primary : button.secondary}>
              <Download aria-hidden size={16} />
              Download
            </a>
            <button type="button" onClick={() => reveal(p.made!.file)} className={button.quiet}>
              <FolderOpen aria-hidden size={16} />
              Show in Finder
            </button>
          </>
        )}
      </div>
      {p.blocked && !busy && <p className="mt-3 text-sm text-muted">{p.blocked}</p>}
      {revealError && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {revealError}
        </p>
      )}

      <div className="mt-5 space-y-4 empty:hidden">
        <JobProgress jobs={p.jobs} />
        {!busy && <JobError job={p.lastFinished} />}
      </div>

      {p.made && m && e && (
        <div className="mt-7">
          <p className="tabular break-all font-mono text-xs text-faint">{p.made.file}</p>
          <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
            <div>
              <dt className="eyebrow text-faint">Size</dt>
              <dd className="tabular mt-1 text-lg font-semibold">{mb(m.sizeBytes)}</dd>
              <dd className="tabular text-xs text-faint">{e.capMB ? `of ${e.capMB} MB allowed` : ""}</dd>
            </div>
            <div>
              <dt className="eyebrow text-faint">Length</dt>
              <dd className="tabular mt-1 text-lg font-semibold">{clock(m.durationS)}</dd>
            </div>
            <div>
              <dt className="eyebrow text-faint">Picture</dt>
              <dd className="tabular mt-1 text-lg font-semibold">
                {m.video.width}×{m.video.height}
              </dd>
              <dd className="tabular text-xs text-faint">{m.video.fps} frames a second</dd>
            </div>
            <div>
              <dt className="eyebrow text-faint">Made in</dt>
              <dd className="tabular mt-1 text-lg font-semibold">{clock(p.made.timings.totalMs / 1000)}</dd>
            </div>
          </dl>
          <ul className="mt-5 space-y-1.5 text-sm text-muted">
            <li>
              <span className="font-semibold text-text">Video</span> {m.video.codec.toUpperCase()} {m.video.profile}, CRF {e.crf}, {m.video.kbps.toLocaleString("en-GB")} kb/s
            </li>
            <li>
              <span className="font-semibold text-text">Sound</span> {m.audio ? `${m.audio.codec.toUpperCase()}, ${m.audio.kbps} kb/s, ${m.audio.channels === 2 ? "stereo" : `${m.audio.channels} ch`}` : "none"}
            </li>
            <li>
              <span className="font-semibold text-text">Size check</span>{" "}
              {e.reencoded ? `the first pass was ${e.firstPassMB} MB, over the ${e.capMB} MB cap, so it was encoded once more at CRF ${e.crf}` : `${e.firstPassMB} MB on the first pass${e.capMB ? `, under the ${e.capMB} MB cap` : ""}`}
            </li>
            <li>
              <span className="font-semibold text-text">Streams before it finishes downloading</span> {m.fastStart ? "yes" : "no"}
            </li>
          </ul>
          {p.stale && <p className="mt-4 text-sm text-caution">The scenes, voice or sound changed after this export. Export again to match.</p>}
          {p.extras}
        </div>
      )}
      {p.children}
    </section>
  );
}
