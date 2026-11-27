"use client";
import Link from "next/link";
import { StepHead } from "@/components/step-head";
import { button } from "@/components/ui";
import { PreviewPlayer } from "@/components/preview-player";
import { fileUrl, type ProjectDetail } from "@/lib/api";
import { useProject } from "@/lib/use-project";
import { useRenders } from "@/lib/use-renders";

/**
 * Step 8 is the video editor, built in Phase 4. Until then this is the place to
 * watch the render in a Remotion Player, the same player the editor will use.
 */
export function EditorView({ initial }: { initial: ProjectDetail }) {
  const { project: p, lastFinished } = useProject(initial);
  const { preview } = useRenders(p.id, lastFinished?.id);
  const stage = p.pipeline.stages[7]!;

  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-12">
      <StepHead stepKey="editor" stage={stage} title="Editor">
        <Link href={`/p/${p.id}/export`} className={button.secondary}>Skip to the export</Link>
      </StepHead>

      <div className="mt-10 grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section aria-labelledby="player-h">
          <h2 id="player-h" className="sr-only">The render</h2>
          {preview ? (
            <PreviewPlayer src={fileUrl(p.id, "renders/preview.mp4")} seconds={preview.media.durationS} width={preview.media.video.width} height={preview.media.video.height} />
          ) : (
            <div className="grid aspect-video place-items-center rounded-lg bg-raised px-8 text-center ring-1 ring-hairline">
              <div>
                <p className="font-semibold">No render to play yet</p>
                <p className="mt-1 text-sm text-muted">Render the preview and it plays here.</p>
                <Link href={`/p/${p.id}/render`} className={`${button.secondary} mt-5`}>Go to the render</Link>
              </div>
            </div>
          )}
        </section>
        <aside className="text-sm">
          <h2 className="eyebrow text-faint">Coming in Phase 4</h2>
          <ul className="mt-3 space-y-2 text-muted">
            <li>A timeline with tracks for scenes, voice, effects and music</li>
            <li>Swap a clip, regenerate a scene, insert a beat in plain words</li>
            <li>Fixes re-render only the scenes they touch</li>
          </ul>
          <p className="mt-6 text-faint">Nothing here changes your video yet. The export does not wait for this step.</p>
        </aside>
      </div>
    </div>
  );
}
