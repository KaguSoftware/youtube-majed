import { ExternalLink } from "lucide-react";

import { CopyButton } from "@/components/copy-button";
import { LiveRefresh } from "@/components/live-refresh";
import { button } from "@/components/ui";
import type { Cut } from "@/lib/cuts";
import { one } from "@/lib/db";
import { ago } from "@/lib/format";
import { mediaUrl, mediaUrls, stillKey } from "@/lib/media";
import { publishDraft } from "@/lib/pipeline";
import type { ProjectRow } from "@/lib/projects";
import {
  cutShots, explainPublishFailure, lastPosted, latestPublication, postedCuts, publishChannel,
  type Channel, type Publication,
} from "@/lib/publications";

import { PublishForm, type Initial } from "./publish-form";
import { retryPublish, stopPublish } from "./publish-actions";

const LIVE = new Set(["queued", "running"]);

/**
 * Publishing the film to YouTube: the last stage, and an occasion. The upload
 * runs on the studio machine (it alone holds the channel's credentials), so
 * this shows what it is doing and, once the film is up, where it is.
 */
export async function Publish({ p, cut }: { p: ProjectRow; cut: Cut }) {
  const [latest, posted, channel, postedList] = await Promise.all([
    latestPublication(p.id), lastPosted(p.id), publishChannel(), postedCuts(p.id),
  ]);
  const live = latest?.job && LIVE.has(latest.job.state) ? latest : null;
  const stopped = latest && !live && !latest.video_id && latest.job &&
    (latest.job.state === "failed" || latest.job.state === "cancelled") ? latest : null;
  const thisCutPosted = postedList.some((c) => c.version === cut.version);

  return (
    <section aria-labelledby="youtube" className="flex flex-col gap-8 border-t border-hairline pt-8">
      <h2 id="youtube" className="eyebrow text-muted">YouTube</h2>

      {live ? (
        <Publishing p={p} pub={live} />
      ) : (
        <>
          {posted && <Posted pub={posted} current={cut.version} fresh={posted.id === latest?.id} />}
          {stopped && <Stopped p={p} pub={stopped} />}
          {channel.state !== "connected" ? (
            !posted && <NotConnected channel={channel} />
          ) : (
            <FormArea p={p} cut={cut} channel={channel.title} from={stopped} alreadyPosted={thisCutPosted}
              collapsed={thisCutPosted && !stopped} />
          )}
        </>
      )}
    </section>
  );
}

function NotConnected({ channel }: { channel: Channel }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="title-card text-title">Ready to publish, once a channel is connected</p>
      <p className="max-w-[65ch] text-muted">
        The studio machine uploads films to YouTube, and it has not been connected to a channel yet. That is a
        one-time step for whoever looks after the machine; the film waits here until then.
      </p>
      <details className="text-xs text-muted">
        <summary className="cursor-pointer select-none text-faint hover:text-text">Details for whoever looks after the machine</summary>
        <div className="mt-2 flex max-w-[110ch] flex-col gap-1 font-mono">
          {channel.state === "disconnected" && <p className="break-words">{channel.problem}</p>}
          {channel.state === "unknown" && <p>No studio machine reports that it can publish: re-run deploy/install-worker.sh.</p>}
          <p>python -m pipeline.youtube connect   (then deploy/install-worker.sh)</p>
        </div>
      </details>
    </div>
  );
}

async function FormArea({ p, cut, channel, from, alreadyPosted, collapsed }: {
  p: ProjectRow; cut: Cut; channel: string; from: Publication | null; alreadyPosted: boolean; collapsed: boolean;
}) {
  const shots = await cutShots(p.id, cut.version);
  const research = from ? null : await one<{ markdown_raw: string }>(
    "SELECT markdown_raw FROM artifacts WHERE project_id = $1 AND kind = 'research' AND doc_status = 'approved' " +
    "ORDER BY version DESC LIMIT 1", [p.id]);
  const [draft, stills, sheetUrl] = await Promise.all([
    from ? null : publishDraft({ topic: p.topic, angle: p.angle }, research?.markdown_raw,
      [...new Set(cut.sounds.flatMap((c) => (c.credit ? [c.credit] : [])))]).catch(() => null),
    mediaUrls(shots.flatMap((s) => (s.still ? [stillKey(s.still)] : []))).catch(() => ({} as Record<string, string>)),
    cut.sheet ? mediaUrl(cut.sheet.key).catch(() => null) : Promise.resolve(null),
  ]);
  // The thumbnail starts on the beat the look was chosen from: the frame
  // that defined the film's character.
  const hero = shots.find((s) => s.beat === p.hero_beat)?.id ?? shots[0]?.id ?? null;
  const initial: Initial = from ? {
    title: from.title, description: from.description, tags: from.tags.join(", "), privacy: from.privacy,
    thumbnail: from.thumbnail_shot, synthetic: from.synthetic, madeForKids: from.made_for_kids,
  } : {
    title: draft?.title ?? p.topic, description: draft?.description ?? "", tags: "", privacy: "private",
    thumbnail: hero, synthetic: true, madeForKids: null,
  };
  const form = (
    <PublishForm projectId={p.id} version={cut.version} duration={cut.duration} channel={channel}
      frames={shots.map((s) => ({ id: s.id, start: s.start, still: s.still ? stills[stillKey(s.still)] ?? null : null }))}
      sheet={cut.sheet && sheetUrl ? { url: sheetUrl, ...cut.sheet } : null}
      initial={initial} alreadyPosted={alreadyPosted} />
  );
  if (collapsed) {
    return (
      <details className="group">
        <summary className={`${button.quiet} -ml-3 cursor-pointer list-none`}>Upload this cut again</summary>
        <div className="pt-6">{form}</div>
      </details>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {!from && (
        <div className="flex flex-col gap-2">
          <p className="title-card text-title">Publish to {channel}</p>
          <p className="max-w-[65ch] text-muted">
            Check what YouTube will be told, choose the thumbnail and who can see it. Private is the safe start:
            you can watch it on YouTube before anyone else does.
          </p>
        </div>
      )}
      {form}
    </div>
  );
}

const STEPS = [
  { key: "waiting", label: "Waiting for the studio machine" },
  { key: "preparing", label: "Preparing the film" },
  { key: "uploading", label: "Uploading" },
  { key: "thumbnail", label: "Setting the thumbnail" },
  { key: "processing", label: "YouTube is processing it" },
] as const;

async function Publishing({ p, pub }: { p: ProjectRow; pub: Publication }) {
  const job = pub.job!;
  const stage = job.state === "queued" ? "waiting" : job.progress.stage ?? "preparing";
  const at = Math.max(0, STEPS.findIndex((s) => s.key === stage));
  const { done = 0, total = 0 } = job.progress;
  const pct = stage === "uploading" && total ? Math.floor((100 * done) / total) : null;
  const still = await thumbUrl(pub);
  return (
    <div className="grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <LiveRefresh every={3000} />
      <Thumb url={still} title={pub.title} />
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="title-card text-title" aria-live="polite">
            {pct !== null ? `Uploading, ${pct}%` : STEPS[at].label}
          </p>
          <p className="text-muted">
            &ldquo;{pub.title}&rdquo;, cut {pub.version}, as {pub.privacy}. You can leave this page; it carries on.
          </p>
        </div>
        {pct !== null && (
          <div className="flex flex-col gap-1.5">
            <div className="h-1.5 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuenow={pct}
              aria-valuemin={0} aria-valuemax={100} aria-label="Uploaded">
              <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out-quart" style={{ width: `${pct}%` }} />
            </div>
            <p className="tabular text-xs text-faint">{(done / 1e6).toFixed(0)} of {(total / 1e6).toFixed(0)} MB</p>
          </div>
        )}
        <ol className="flex flex-col gap-2 text-sm">
          {STEPS.map((s, i) => (
            <li key={s.key} className={"flex items-center gap-3 " + (i < at ? "text-muted" : i === at ? "text-text" : "text-faint")}>
              <span aria-hidden className={"size-2 shrink-0 rounded-full " + (i < at ? "bg-muted" : i === at
                ? "bg-accent motion-safe:animate-pulse" : "ring-1 ring-inset ring-hairline")} />
              {s.label}
              <span className="sr-only">{i < at ? " (done)" : i === at ? " (now)" : ""}</span>
            </li>
          ))}
        </ol>
        {job.attempts > 1 && (
          <p className="text-sm text-muted">The connection dropped once; it is carrying on where it stopped.</p>
        )}
        {at < 3 && (
          <form action={stopPublish.bind(null, p.id)}>
            <button type="submit" className={`${button.quiet} -ml-3`}>{at < 2 ? "Stop" : "Stop the upload"}</button>
          </form>
        )}
      </div>
    </div>
  );
}

const PRIVACY_NOW: Record<string, string> = {
  private: "Private: only the channel can see it. Make it public in YouTube Studio when you are ready.",
  unlisted: "Unlisted: anyone with the link can watch it.",
  public: "Public: everyone can find it.",
};

async function Posted({ pub, current, fresh }: { pub: Publication; current: number; fresh: boolean }) {
  const url = `https://youtu.be/${pub.video_id}`;
  const studio = `https://studio.youtube.com/video/${pub.video_id}/edit`;
  const yt = pub.youtube ?? {};
  // Only show our still as the thumbnail if YouTube took it.
  const still = yt.thumbnail ? await thumbUrl(pub) : null;
  const privacy = yt.privacy ?? pub.privacy;
  const processing = yt.upload_status === "uploaded" || (yt.processing && yt.processing !== "succeeded");
  const problem = yt.upload_status === "rejected" || yt.upload_status === "failed";
  return (
    <div className={"grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] " +
      (fresh ? "motion-safe:animate-[fadein_500ms_var(--ease-out-quart)]" : "")}>
      <a href={url} target="_blank" rel="noreferrer" className="group block">
        <Thumb url={still} title={pub.title} hover
          empty={pub.thumbnail_shot ? "YouTube shows a frame it chose" : "YouTube chose the thumbnail"} />
      </a>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <p className={"eyebrow " + (problem ? "text-danger" : "text-accent")}>
            {problem ? "YouTube turned it down" : "On YouTube"}
          </p>
          <p className="title-card text-title">{pub.title}</p>
          <p className="max-w-[65ch] text-muted">{PRIVACY_NOW[privacy] ?? privacy}</p>
          {processing && !problem && (
            <p className="text-sm text-muted">YouTube is still processing it; full quality can take a few more minutes.</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <a href={url} target="_blank" rel="noreferrer" className={button.primary}>
            Watch on YouTube <ExternalLink className="size-4" aria-hidden />
          </a>
          <a href={studio} target="_blank" rel="noreferrer" className={button.secondary}>
            Open in YouTube Studio <ExternalLink className="size-4" aria-hidden />
          </a>
          <CopyButton text={url} label="Copy the link" />
        </div>
        {(yt.notes?.length ?? 0) > 0 && (
          <ul className="flex flex-col gap-1.5 text-sm">
            {yt.notes!.map((n) => (
              <li key={n} className="flex gap-2.5">
                <span aria-hidden className={"mt-1.5 size-1.5 shrink-0 rounded-full " + (/rejected|could not/.test(n) ? "bg-danger" : "bg-caution")} />
                <span className="text-text">{n}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-faint">
          Cut {pub.version}, published by {pub.by ?? "someone"} {ago(pub.uploaded_at)}
          {yt.channel_title ? ` to ${yt.channel_title}` : ""}.
          {pub.synthetic ? " Labelled as containing AI-generated material." : ""}
          {current !== pub.version ? ` The film has changed since: it is now cut ${current}.` : ""}
        </p>
      </div>
    </div>
  );
}

function Stopped({ p, pub }: { p: ProjectRow; pub: Publication }) {
  const cancelled = pub.job?.state === "cancelled";
  const why = cancelled
    ? { text: "The upload was stopped. Nothing is on YouTube. Trying again carries on from where it stopped.", retry: true }
    : explainPublishFailure(pub.job?.error ?? null);
  return (
    <div role={cancelled ? "status" : "alert"}
      className={"flex flex-col gap-3 rounded-md p-5 " + (cancelled ? "bg-raised" : "bg-danger-wash")}>
      <p className={"font-semibold " + (cancelled ? "text-text" : "text-danger")}>
        {cancelled ? "Publishing stopped" : "The film was not published"}
      </p>
      <p className="max-w-[80ch] text-sm text-text">{why.text}</p>
      <div className="flex flex-wrap items-center gap-3">
        {why.retry && (
          <form action={retryPublish.bind(null, p.id, pub.id)}>
            <button type="submit" className={button.secondary}>Try again</button>
          </form>
        )}
        <span className="text-sm text-muted">Or change the details below and publish.</span>
      </div>
      {!cancelled && pub.job?.error && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer select-none hover:text-text">Technical details</summary>
          <p className="mt-2 break-words font-mono">{pub.job.error}</p>
        </details>
      )}
    </div>
  );
}

function Thumb({ url, title, hover = false, empty }: { url: string | null; title: string; hover?: boolean; empty?: string }) {
  return (
    <div className="flex aspect-video items-center justify-center overflow-hidden rounded-md bg-raised">
      {!url && empty && <span className="p-6 text-center text-sm text-muted">{empty}</span>}
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Thumbnail for ${title}`}
          className={"size-full object-cover " + (hover ? "transition-opacity duration-150 group-hover:opacity-90" : "")} />
      )}
    </div>
  );
}

/** The chosen thumbnail's still, from the cut it was published from. */
async function thumbUrl(pub: Publication): Promise<string | null> {
  if (!pub.thumbnail_shot) return null;
  const row = await one<{ still: string | null }>(
    `SELECT s->'image'->>'path' AS still FROM publications p
     JOIN timelines t ON t.project_id = p.project_id AND t.version = p.version,
     jsonb_array_elements(t.timeline_json->'shots') s
     WHERE p.id = $1 AND s->>'shot_id' = p.thumbnail_shot`, [pub.id]);
  return row?.still ? mediaUrl(stillKey(row.still)).catch(() => null) : null;
}
