"use client";
import { chapterText } from "./chapters";
import { Download } from "lucide-react";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { JobError, JobProgress } from "@/components/job-progress";
import { JobBar, StepHead } from "@/components/step-head";
import { button } from "@/components/ui";
import { fileUrl, type ProjectDetail } from "@/lib/api";
import { clock } from "@/lib/format";
import { useAct } from "@/lib/use-act";
import { useProject } from "@/lib/use-project";
import { useRenders } from "@/lib/use-renders";

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(0)} MB`;
const rel = (file: string) => file.slice(file.indexOf("/renders/") + 1);

/**
 * Step 9. The YouTube file: 1080p, 30 fps, H.264 High, CRF 20, preset slow,
 * AAC 320 kbps, fast start. Over the size cap it is re-encoded once at CRF 22.
 * Beside it: subtitles, chapters from the loop map and three thumbnail frames
 * from head-fake moments.
 */
export function ExportView({ initial }: { initial: ProjectDetail }) {
  const { project: p, active, lastFinished, reload } = useProject(initial);
  const { preview, export: out } = useRenders(p.id, lastFinished?.id);
  const { act, cancel, error } = useAct(reload);
  const stage = p.pipeline.stages[8]!;
  const busy = active.length > 0;
  const m = out?.media;
  const side = out?.sidecars;

  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-12">
      <StepHead stepKey="export" stage={stage} title="Export">
        {preview && (
          <button type="button" onClick={() => act(`/projects/${p.id}/export`)} disabled={busy} className={out && !stage.stale ? button.secondary : button.primary}>
            {out ? "Export again" : "Export the YouTube file"}
          </button>
        )}
        {out && (
          <a href={fileUrl(p.id, rel(out.file), true)} className={button.primary}>
            <Download aria-hidden size={16} />
            Download the video
          </a>
        )}
      </StepHead>

      <JobBar live={busy || Boolean(error) || lastFinished?.status === "failed"}>
        <JobProgress jobs={active} onCancel={cancel} />
        {!busy && <JobError job={lastFinished} />}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </JobBar>

      {!preview ? (
        <section className="mt-12 max-w-xl">
          <h2 className="text-lg font-semibold">Watch the preview first</h2>
          <p className="mt-2 text-muted">The export draws every frame again in 1080p with the slow encoder. Look at the cheap preview before spending that time.</p>
          <Link href={`/p/${p.id}/render`} className={`${button.secondary} mt-6`}>Go to the render</Link>
        </section>
      ) : !out || !m || !side ? (
        !busy && (
          <section className="mt-12 max-w-xl">
            <h2 className="text-lg font-semibold">One file for YouTube, and what goes with it</h2>
            <p className="mt-2 text-muted">1920×1080 at 30 frames a second, H.264 High, AAC 320 kbps, ready to stream before it finishes downloading. Subtitles, a chapter list and three thumbnail frames are written next to it.</p>
          </section>
        )
      ) : (
        <>
          <section aria-labelledby="file-h" className="mt-10">
            <h2 id="file-h" className="eyebrow text-faint">The file</h2>
            <p className="tabular mt-3 break-all font-mono text-sm text-text">{out.file}</p>
            <dl className="mt-6 grid max-w-4xl grid-cols-2 gap-x-10 gap-y-4 text-sm sm:grid-cols-4">
              <div><dt className="eyebrow text-faint">Size</dt><dd className="tabular mt-1 text-lg font-semibold">{mb(m.sizeBytes)}</dd></div>
              <div><dt className="eyebrow text-faint">Length</dt><dd className="tabular mt-1 text-lg font-semibold">{clock(m.durationS)}</dd></div>
              <div><dt className="eyebrow text-faint">Picture</dt><dd className="tabular mt-1 text-lg font-semibold">{m.video.width}×{m.video.height}, {m.video.fps} fps</dd></div>
              <div><dt className="eyebrow text-faint">Made in</dt><dd className="tabular mt-1 text-lg font-semibold">{clock(out.timings.totalMs / 1000)}</dd></div>
            </dl>
            <ul className="mt-6 max-w-3xl space-y-1.5 text-sm text-muted">
              <li>
                <span className="font-semibold text-text">Video</span> {m.video.codec.toUpperCase()} {m.video.profile}, {m.video.pixFmt}, {m.video.kbps.toLocaleString("en-GB")} kb/s, CRF {out.encode.crf}, preset {out.encode.preset}
              </li>
              <li>
                <span className="font-semibold text-text">Audio</span> {m.audio ? `${m.audio.codec.toUpperCase()} ${m.audio.profile}, ${m.audio.kbps} kb/s, ${m.audio.sampleRate / 1000} kHz, ${m.audio.channels === 2 ? "stereo" : `${m.audio.channels} ch`}` : "none"}
              </li>
              <li>
                <span className="font-semibold text-text">Fast start</span> {m.fastStart ? "yes, the index is at the front" : "no"}
              </li>
              <li>
                <span className="font-semibold text-text">Size check</span>{" "}
                {out.encode.reencoded
                  ? `the first pass was ${out.encode.firstPassMB} MB, over the ${out.encode.capMB} MB cap, so it was encoded once more at CRF ${out.encode.crf}`
                  : `${out.encode.firstPassMB} MB, under the ${out.encode.capMB} MB cap`}
              </li>
            </ul>
            {stage.stale && <p className="mt-4 text-sm text-caution">The scenes, voice or sound changed after this export. Export again to match.</p>}
          </section>

          <section aria-labelledby="thumbs-h" className="mt-14">
            <h2 id="thumbs-h" className="text-lg font-semibold">Thumbnail frames</h2>
            <p className="mt-1 text-sm text-muted">From head-fake moments, without captions. The last one is the ending twist.</p>
            <ol className="mt-5 grid gap-6 sm:grid-cols-3">
              {side.thumbnails.map((t, i) => (
                <li key={t.file}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={fileUrl(p.id, rel(t.file))} alt={`Thumbnail suggestion ${i + 1}, at ${clock(t.atS)}`} className="aspect-video w-full rounded-md bg-raised object-cover ring-1 ring-hairline" />
                  <p className="mt-2 text-sm"><span className="tabular font-semibold">{clock(t.atS)}</span> <span className="text-faint">{t.lineId}</span></p>
                  <p className="text-xs text-muted">{t.why}</p>
                  <a href={fileUrl(p.id, rel(t.file), true)} className="mt-1 inline-block text-xs text-muted underline-offset-2 hover:text-text hover:underline">Download</a>
                </li>
              ))}
            </ol>
          </section>

          <div className="mt-14 grid gap-x-12 gap-y-10 lg:grid-cols-2">
            <section aria-labelledby="chapters-h">
              <div className="flex items-baseline justify-between gap-4">
                <h2 id="chapters-h" className="text-lg font-semibold">Chapters</h2>
                <CopyButton text={chapterText(side.chapterList)} label="Copy for the description" />
              </div>
              <pre className="tabular mt-3 whitespace-pre-wrap rounded-md bg-raised px-4 py-3 font-sans text-sm leading-6">{chapterText(side.chapterList)}</pre>
            </section>
            <section aria-labelledby="subs-h">
              <h2 id="subs-h" className="text-lg font-semibold">Subtitles</h2>
              <p className="mt-1 text-sm text-muted">{side.captions.toLocaleString("en-GB")} cues from the spoken word times, at most 38 characters each.</p>
              <a href={fileUrl(p.id, rel(side.srt), true)} className={`${button.secondary} mt-4`}>
                <Download aria-hidden size={16} />
                Download the .srt
              </a>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
