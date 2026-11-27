"use client";

import { useActionState, useState } from "react";

import { button, field } from "@/components/ui";

import { publishFilm, type PublishState } from "./publish-actions";

export type Frame = { id: string; start: number; still: string | null };
export type Sheet = { url: string; cols: number; rows: number; thumb: [number, number]; shots: string[] };
export type Initial = {
  title: string; description: string; tags: string; privacy: "private" | "unlisted" | "public";
  thumbnail: string | null; synthetic: boolean; madeForKids: boolean | null;
};

const PRIVACY = [
  { value: "private", label: "Private", hint: "Only the channel sees it. Make it public in YouTube Studio when you are ready." },
  { value: "unlisted", label: "Unlisted", hint: "Anyone with the link can watch. It is not listed or searchable." },
  { value: "public", label: "Public", hint: "Everyone can find it, and subscribers are told." },
] as const;

/** pipeline/publish.py: YouTube's limits, counted the way YouTube counts. */
const TITLE_MAX = 100;
const DESCRIPTION_MAX = 5000;
const bytes = (s: string) => new TextEncoder().encode(s).length;

function tc(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** One frame out of the contact sheet, by background position. */
function spriteStyle(sheet: Sheet, id: string): React.CSSProperties {
  const i = Math.max(0, sheet.shots.indexOf(id));
  const col = i % sheet.cols;
  const row = Math.floor(i / sheet.cols);
  return {
    backgroundImage: `url(${sheet.url})`,
    backgroundSize: `${sheet.cols * 100}% ${sheet.rows * 100}%`,
    backgroundPosition: `${sheet.cols > 1 ? (col / (sheet.cols - 1)) * 100 : 0}% ${sheet.rows > 1 ? (row / (sheet.rows - 1)) * 100 : 0}%`,
  };
}

/**
 * What YouTube is told about the film. The thumbnail is the largest thing on
 * it, because it is what people see first; the words sit beside it, already
 * drafted from the film's topic and its sources, to be checked rather than
 * written. Two declarations YouTube asks for are asked here too, in plain
 * words, and recorded with the name of whoever publishes.
 */
export function PublishForm({ projectId, version, duration, channel, frames, sheet, initial, alreadyPosted }: {
  projectId: string; version: number; duration: number; channel: string;
  frames: Frame[]; sheet: Sheet | null; initial: Initial;
  /** This cut is already on YouTube: publishing it again needs a tick. */
  alreadyPosted: boolean;
}) {
  const [state, action, pending] = useActionState<PublishState, FormData>(publishFilm.bind(null, projectId), {});
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [privacy, setPrivacy] = useState(initial.privacy);
  const [thumb, setThumb] = useState<string | null>(initial.thumbnail);
  const [again, setAgain] = useState(false);
  const chosen = frames.find((f) => f.id === thumb) ?? null;
  const descBytes = bytes(description);
  const needsAgain = alreadyPosted || state.again;

  return (
    <form action={action} className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* The thumbnail, as it will be seen, and the frame it is taken from. */}
      <div className="flex flex-col gap-5 lg:sticky lg:top-6 lg:self-start">
        <figure className="flex flex-col gap-3">
          <div className="relative aspect-video overflow-hidden rounded-md bg-raised">
            {chosen?.still ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={chosen.still} alt={`Thumbnail: the frame at ${tc(chosen.start)}`}
                className="size-full object-cover motion-safe:animate-[fadein_200ms_var(--ease-out-quart)]" key={chosen.id} />
            ) : chosen && sheet ? (
              <span className="block size-full" style={spriteStyle(sheet, chosen.id)} role="img"
                aria-label={`Thumbnail: the frame at ${tc(chosen.start)}`} />
            ) : (
              <div className="flex size-full items-center justify-center p-6 text-center text-sm text-muted">
                YouTube will pick a frame from the film.
              </div>
            )}
            <span className="tabular absolute bottom-2 right-2 rounded-sm bg-room/85 px-1.5 py-0.5 text-xs font-semibold text-text">
              {tc(duration)}
            </span>
          </div>
          <figcaption className="flex flex-col gap-1">
            <span className="line-clamp-2 text-lg font-semibold leading-snug text-text">
              {title || <span className="text-faint">Untitled</span>}
            </span>
            <span className="text-sm text-muted">
              {channel} <span aria-hidden>·</span> {PRIVACY.find((p) => p.value === privacy)?.label}
            </span>
          </figcaption>
        </figure>

        <fieldset className="flex flex-col gap-3">
          <legend className="eyebrow mb-3 text-muted">Thumbnail</legend>
          {sheet ? (
            <div className="grid max-h-64 grid-cols-5 gap-1.5 overflow-y-auto p-1 sm:grid-cols-6 lg:grid-cols-5">
              {frames.map((f) => (
                <label key={f.id} title={`${f.id} at ${tc(f.start)}`} className="group relative cursor-pointer">
                  <input type="radio" name="thumbnail" value={f.id} checked={f.id === thumb}
                    onChange={() => setThumb(f.id)} className="peer sr-only" />
                  <span className="sr-only">{f.id}, at {tc(f.start)}</span>
                  <span aria-hidden style={spriteStyle(sheet, f.id)}
                    className={"block aspect-video rounded-sm bg-raised opacity-75 transition-[opacity,box-shadow] duration-150 ease-out-quart " +
                      "group-hover:opacity-100 peer-checked:opacity-100 peer-checked:ring-2 peer-checked:ring-accent " +
                      "peer-checked:ring-offset-2 peer-checked:ring-offset-room peer-focus-visible:outline-2 " +
                      "peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"} />
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">This film has no frame sheet, so YouTube will choose the thumbnail.</p>
          )}
          <label className="flex cursor-pointer items-center gap-2 self-start text-sm text-muted hover:text-text">
            <input type="radio" name="thumbnail" value="" checked={thumb === null} onChange={() => setThumb(null)}
              className="accent-[var(--color-accent)]" />
            Let YouTube choose a frame
          </label>
        </fieldset>
      </div>

      {/* The words, and the two declarations. */}
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="pub-title" className="text-sm font-semibold text-text">Title</label>
            <span className={"tabular text-xs " + (title.length > TITLE_MAX ? "text-danger" : "text-faint")}>
              {title.length}/{TITLE_MAX}
            </span>
          </div>
          <input id="pub-title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} required
            className={`${field} text-lg`} aria-invalid={title.length > TITLE_MAX || undefined} />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="pub-description" className="text-sm font-semibold text-text">Description</label>
            <span className={"tabular text-xs " + (descBytes > DESCRIPTION_MAX ? "text-danger" : "text-faint")}>
              {descBytes > DESCRIPTION_MAX * 0.8 ? `${descBytes.toLocaleString()} of ${DESCRIPTION_MAX.toLocaleString()} bytes` : ""}
            </span>
          </div>
          <textarea id="pub-description" name="description" rows={10} value={description}
            onChange={(e) => setDescription(e.target.value)} aria-describedby="pub-description-help"
            aria-invalid={descBytes > DESCRIPTION_MAX || undefined}
            className={`${field} min-h-48 resize-y font-[inherit] text-sm leading-relaxed`} />
          <p id="pub-description-help" className="text-xs text-faint">
            Drafted from the film&rsquo;s angle and every source its research cites, so a viewer can check any line.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="pub-tags" className="text-sm font-semibold text-text">Tags <span className="font-normal text-faint">(optional)</span></label>
          <input id="pub-tags" name="tags" defaultValue={initial.tags} placeholder="history, documentary"
            aria-describedby="pub-tags-help" className={field} />
          <p id="pub-tags-help" className="text-xs text-faint">Separate them with commas.</p>
        </div>

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-2 text-sm font-semibold text-text">Who can see it</legend>
          {PRIVACY.map((p) => (
            <label key={p.value}
              className="flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 hover:bg-raised has-[:checked]:bg-raised">
              <input type="radio" name="privacy" value={p.value} checked={privacy === p.value}
                onChange={() => setPrivacy(p.value)} className="mt-1 accent-[var(--color-accent)]" />
              <span className="flex flex-col">
                <span className="text-sm font-semibold text-text">{p.label}</span>
                <span className="text-sm text-muted">{p.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-4 border-t border-hairline pt-5">
          <legend className="sr-only">What YouTube asks every uploader to declare</legend>
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" name="synthetic" defaultChecked={initial.synthetic}
              className="mt-1 accent-[var(--color-accent)]" />
            <span className="flex flex-col">
              <span className="text-sm font-semibold text-text">Label it as containing AI-generated material</span>
              <span className="max-w-[60ch] text-sm text-muted">
                YouTube asks uploaders to say when realistic-looking material was made by AI. The narration voice and
                every picture here were. Leave this on unless you are sure the label does not apply.
              </span>
            </span>
          </label>
          <div className="flex flex-col gap-2" role="radiogroup" aria-labelledby="kids-label" aria-describedby="kids-help">
            <span id="kids-label" className="text-sm font-semibold text-text">Is it made for children?</span>
            <span id="kids-help" className="max-w-[60ch] text-sm text-muted">
              A legal declaration YouTube requires. Made for children turns off comments and personalised ads.
            </span>
            <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-text">
                <input type="radio" name="made_for_kids" value="no" required defaultChecked={initial.madeForKids === false}
                  className="accent-[var(--color-accent)]" />
                No, it is for a general audience
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-text">
                <input type="radio" name="made_for_kids" value="yes" defaultChecked={initial.madeForKids === true}
                  className="accent-[var(--color-accent)]" />
                Yes, it is made for children
              </label>
            </div>
          </div>
        </fieldset>

        {needsAgain && (
          <label className="flex items-start gap-3 rounded-md bg-raised p-4 text-sm">
            <input type="checkbox" name="again" value="yes" checked={again} onChange={(e) => setAgain(e.target.checked)}
              className="mt-0.5 accent-[var(--color-accent)]" />
            <span>
              <span className="font-semibold text-text">Cut {version} is already on YouTube.</span>{" "}
              <span className="text-muted">Tick to upload it again as a second, separate video.</span>
            </span>
          </label>
        )}

        {state.errors && state.errors.length > 0 && (
          <ul role="alert" className="flex flex-col gap-1 text-sm text-danger">
            {state.errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}

        <div className="flex flex-col gap-2 border-t border-hairline pt-5 sm:flex-row sm:items-center sm:gap-5">
          <button type="submit" disabled={pending || (needsAgain && !again)} className={`${button.primary} shrink-0 whitespace-nowrap`}>
            {pending ? "Sending to the studio machine…" : needsAgain ? `Upload cut ${version} again` : "Publish to YouTube"}
          </button>
          <p className="text-sm text-faint">
            The studio machine uploads cut {version}. A few minutes for the upload, then YouTube processes it.
          </p>
        </div>
      </div>
    </form>
  );
}
