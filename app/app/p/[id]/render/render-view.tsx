"use client";
import Link from "next/link";
import { JobError, JobProgress } from "@/components/job-progress";
import { JobBar, StepHead } from "@/components/step-head";
import { button } from "@/components/ui";
import { fileUrl, type ProjectDetail } from "@/lib/api";
import { clock } from "@/lib/format";
import { useAct } from "@/lib/use-act";
import { useProject } from "@/lib/use-project";
import { useRenders } from "@/lib/use-renders";

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;

/**
 * Step 7. The sound is mixed (music ducked under the voice, a riser into every
 * head fake, ambience, effects, one track at -14 LUFS), then the whole video
 * is drawn at preview quality. Watch it here before the long 1080p export.
 */
export function RenderView({ initial }: { initial: ProjectDetail }) {
  const { project: p, active, lastFinished, reload } = useProject(initial);
  const { preview, mix } = useRenders(p.id, lastFinished?.id);
  const { act, cancel, error } = useAct(reload);
  const stage = p.pipeline.stages[6]!;
  const busy = active.length > 0;
  const ready = stage.status !== "waiting";

  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-12">
      <StepHead stepKey="render" stage={stage} title="Render">
        {ready && (
          <button type="button" onClick={() => act(`/projects/${p.id}/render`)} disabled={busy} className={preview && !stage.stale ? button.secondary : button.primary}>
            {preview ? "Render the preview again" : "Mix and render the preview"}
          </button>
        )}
        {preview && <Link href={`/p/${p.id}/export`} className={stage.stale ? button.secondary : button.primary}>Go to the export</Link>}
      </StepHead>

      <JobBar live={busy || Boolean(error) || lastFinished?.status === "failed"}>
        <JobProgress jobs={active} onCancel={cancel} />
        {!busy && <JobError job={lastFinished} />}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </JobBar>

      {!ready ? (
        <section className="mt-12 max-w-xl">
          <h2 className="text-lg font-semibold">Nothing to draw yet</h2>
          <p className="mt-2 text-muted">The render needs the voice and the scenes. Sound design uses both: effects land on words, and the mix ducks under the narration.</p>
          <Link href={`/p/${p.id}/${p.pipeline.stages[4]!.status === "done" ? "storyboard" : "voice"}`} className={`${button.secondary} mt-6`}>Go to the step before</Link>
        </section>
      ) : !preview ? (
        !busy && (
          <section className="mt-12 max-w-xl">
            <h2 className="text-lg font-semibold">Mix, then draw the whole video</h2>
            <p className="mt-2 text-muted">The sound mix takes seconds. Drawing every frame at 720p takes much longer than the video runs; the bar tells you how long, and the machine stays usable meanwhile.</p>
          </section>
        )
      ) : (
        <div className="mt-10 grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section aria-labelledby="preview-h">
            <h2 id="preview-h" className="sr-only">Preview</h2>
            <video key={preview.createdAt} controls preload="metadata" src={fileUrl(p.id, "renders/preview.mp4")} className="aspect-video w-full rounded-lg bg-raised ring-1 ring-hairline" />
            <p className="mt-3 text-sm text-faint">
              {preview.media.video.width}×{preview.media.video.height} preview, {clock(preview.media.durationS)}, {mb(preview.media.sizeBytes)}
            </p>
          </section>
          <aside className="space-y-8 text-sm">
            {mix && (
              <section aria-labelledby="mix-h">
                <h2 id="mix-h" className="eyebrow text-faint">The mix</h2>
                <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5">
                  <dt className="text-muted">Loudness</dt><dd className="tabular text-right">{mix.integratedLufs} LUFS</dd>
                  <dt className="text-muted">True peak</dt><dd className="tabular text-right">{mix.truePeakDbtp} dBTP</dd>
                  <dt className="text-muted">Voice alone</dt><dd className="tabular text-right">{mix.voiceLufs} LUFS</dd>
                  <dt className="text-muted">Music under the voice</dt><dd className="tabular text-right">{mix.musicUnderVoiceDb === null ? "no music" : `${mix.musicUnderVoiceDb} dB`}</dd>
                  <dt className="text-muted">Mixed in</dt><dd className="tabular text-right">{(mix.renderedMs / 1000).toFixed(1)} s</dd>
                </dl>
              </section>
            )}
            <section aria-labelledby="timing-h">
              <h2 id="timing-h" className="eyebrow text-faint">This render</h2>
              <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5">
                <dt className="text-muted">Took</dt><dd className="tabular text-right">{clock(preview.timings.totalMs / 1000)}</dd>
                <dt className="text-muted">Speed</dt><dd className="tabular text-right">{preview.timings.framesPerSecond} frames/s</dd>
                <dt className="text-muted">Frames</dt><dd className="tabular text-right">{preview.timings.frames.toLocaleString("en-GB")}</dd>
                <dt className="text-muted">In parallel</dt><dd className="tabular text-right">{preview.timings.concurrency}</dd>
              </dl>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
