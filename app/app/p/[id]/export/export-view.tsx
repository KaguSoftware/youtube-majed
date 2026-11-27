"use client";
import { chapterText } from "./chapters";
import { Download } from "lucide-react";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { StepHead } from "@/components/step-head";
import { VarietyPanel } from "@/components/variety-panel";
import { button } from "@/components/ui";
import { fileUrl, type ProjectDetail } from "@/lib/api";
import { clock } from "@/lib/format";
import { useAct } from "@/lib/use-act";
import { useProject } from "@/lib/use-project";
import { useReel } from "@/lib/use-reel";
import { useRenders } from "@/lib/use-renders";
import { FormatBlock, rel } from "./format-block";
import { ReelCutSection } from "./reel-cut";

/**
 * Step 9. Two files from one project: the YouTube video (16:9, 1080p, CRF 20) and the Reel (9:16, 1080×1920, CRF 21,
 * captions burned in). The same scenes, voice and sound feed both; the Reel is laid out for the tall frame, not
 * cropped. Each has its own button, progress and file facts. Beside the YouTube file: subtitles, chapters from the
 * loop map and three thumbnail frames. A long video can also give a Reel cut (its own project).
 */
export function ExportView({ initial }: { initial: ProjectDetail }) {
  const { project: p, active, jobs, lastFinished, reload } = useProject(initial);
  const { preview, export: out } = useRenders(p.id, lastFinished?.id);
  const { reel, unavailable } = useReel(p.id, lastFinished?.id);
  const { act, error } = useAct(reload);
  const stage = p.pipeline.stages[8]!;
  const ready = p.pipeline.stages[6]!.status !== "waiting"; // there are scenes and a voice to draw
  const ofKind = (kind: string) => active.filter((j) => j.kind === kind);
  const lastOf = (kind: string) => jobs.filter((j) => j.kind === kind && j.finishedAt).at(-1);
  const side = out?.sidecars;
  const native = p.brief.format;

  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-12">
      <StepHead stepKey="export" stage={stage} title="Export" />

      {error && (
        <p role="alert" className="mt-6 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="mt-10 grid gap-x-14 gap-y-12 lg:grid-cols-2">
        <FormatBlock
          project={p.id}
          tall={false}
          title="YouTube, 16:9"
          spec="1920×1080, 30 frames a second, H.264 High, sound at 320 kb/s. Over 250 MB it is encoded once more, a little smaller."
          native={native === "youtube"}
          made={out ?? null}
          stale={Boolean(out) && stage.stale}
          blocked={!preview ? "Watch the preview first: the export draws every frame again in 1080p with the slow encoder." : undefined}
          action="Export the YouTube file"
          jobs={ofKind("export")}
          lastFinished={lastOf("export")}
          onExport={() => act(`/projects/${p.id}/export`)}
        >
          {!preview && (
            <Link href={`/p/${p.id}/render`} className={`${button.secondary} mt-4`}>
              Go to the render
            </Link>
          )}
        </FormatBlock>

        <FormatBlock
          project={p.id}
          tall
          title="Reel, 9:16"
          spec="1080×1920, 30 frames a second, H.264 High, captions burned in clear of the Shorts and Instagram buttons. Laid out for the tall frame, not cropped. Over 40 MB it is encoded once more."
          native={native === "reel"}
          made={reel?.reel ?? null}
          stale={Boolean(reel?.stale)}
          blocked={unavailable ? "The worker was started before Reels existed. Restart it (pnpm worker) to export one." : !ready ? "Waiting for the voice and the scenes." : undefined}
          action="Export the Reel"
          jobs={ofKind("reelexport")}
          lastFinished={lastOf("reelexport")}
          onExport={() => act(`/projects/${p.id}/reel/export`)}
          extras={
            reel?.reel && (
              <p className="mt-4 text-sm text-muted">
                <span className="font-semibold text-text">Subtitles</span> {reel.reel.sidecars.captions.toLocaleString("en-GB")} cues for the post, from the spoken word times.{" "}
                <a href={fileUrl(p.id, rel(reel.reel.sidecars.srt), true)} className="inline-flex items-center gap-1.5 text-text underline underline-offset-4 hover:text-accent">
                  <Download aria-hidden size={14} />
                  Download the .srt
                </a>
              </p>
            )
          }
        />
      </div>

      <VarietyPanel project={p.id} trigger={lastFinished?.id} compact />

      {reel && !unavailable && (
        <div className="mt-12">
          <ReelCutSection
            project={p.id}
            state={reel}
            blocked={!ready ? "Waiting for the voice and the scenes." : !p.narration?.lockedAt ? "Lock the script first." : undefined}
            jobs={ofKind("reelcut")}
            lastFinished={lastOf("reelcut")}
            onCut={() => act(`/projects/${p.id}/reel/cut`)}
          />
        </div>
      )}

      {out && side && (
        <div className="mt-16">
          <h2 className="eyebrow text-faint">With the YouTube file</h2>

          <section aria-labelledby="thumbs-h" className="mt-6">
            <h3 id="thumbs-h" className="text-lg font-semibold">
              Thumbnail frames
            </h3>
            <p className="mt-1 text-sm text-muted">From head-fake moments, without captions. The last one is the ending twist.</p>
            <ol className="mt-5 grid gap-6 sm:grid-cols-3">
              {side.thumbnails.map((t, i) => (
                <li key={t.file}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={fileUrl(p.id, rel(t.file))} alt={`Thumbnail suggestion ${i + 1}, at ${clock(t.atS)}`} className="aspect-video w-full rounded-md bg-raised object-cover ring-1 ring-hairline" />
                  <p className="mt-2 text-sm">
                    <span className="tabular font-semibold">{clock(t.atS)}</span> <span className="text-faint">{t.lineId}</span>
                  </p>
                  <p className="text-xs text-muted">{t.why}</p>
                  <a href={fileUrl(p.id, rel(t.file), true)} className="mt-1 inline-block text-xs text-muted underline-offset-2 hover:text-text hover:underline">
                    Download
                  </a>
                </li>
              ))}
            </ol>
          </section>

          <div className="mt-12 grid gap-x-12 gap-y-10 lg:grid-cols-2">
            <section aria-labelledby="chapters-h">
              <div className="flex items-baseline justify-between gap-4">
                <h3 id="chapters-h" className="text-lg font-semibold">
                  Chapters
                </h3>
                <CopyButton text={chapterText(side.chapterList)} label="Copy for the description" />
              </div>
              <pre className="tabular mt-3 whitespace-pre-wrap rounded-md bg-raised px-4 py-3 font-sans text-sm leading-6">{chapterText(side.chapterList)}</pre>
            </section>
            <section aria-labelledby="subs-h">
              <h3 id="subs-h" className="text-lg font-semibold">
                Subtitles
              </h3>
              <p className="mt-1 text-sm text-muted">{side.captions.toLocaleString("en-GB")} cues from the spoken word times, at most 38 characters each.</p>
              <a href={fileUrl(p.id, rel(side.srt), true)} className={`${button.secondary} mt-4`}>
                <Download aria-hidden size={16} />
                Download the .srt
              </a>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
