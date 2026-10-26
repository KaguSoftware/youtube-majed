"use client";

import { useEffect, type RefObject } from "react";

export type FilmSource = { kind: "hls" | "mp4"; url: string };

/**
 * Attach a film to a <video>: a cut's HLS playlist (per-shot chunks beside
 * one narration stream, pipeline/assemble.py) or, for a film from before
 * chunks, its mp4. hls.js where Media Source Extensions exist, the browser's
 * own HLS otherwise (Safari on iOS). Loaded only on pages that play a film.
 *
 * `resume` puts the playhead back where it was, playing or paused, when the
 * source changes: switching between this cut and the earlier one keeps the
 * same moment of the film on screen.
 */
export function useFilmSource(
  ref: RefObject<HTMLVideoElement | null>,
  source: FilmSource | null,
  resume?: { time: number; playing: boolean } | null,
) {
  const url = source?.url;
  const kind = source?.kind;
  useEffect(() => {
    const video = ref.current;
    if (!video || !url) return;
    let destroyed = false;
    let detach = () => {};
    // Native playback: put the playhead back once the browser knows the
    // film. hls.js would override that with its own start position, so it
    // is given the moment as its start position instead.
    const restore = () => {
      if (!resume) return;
      video.currentTime = resume.time;
      if (resume.playing) video.play().catch(() => {});
    };
    const native = () => {
      video.addEventListener("loadedmetadata", restore, { once: true });
      video.src = url;
      detach = () => {
        video.removeEventListener("loadedmetadata", restore);
        video.removeAttribute("src");
        video.load();
      };
    };

    if (kind === "mp4") {
      native();
    } else {
      import("hls.js").then(({ default: Hls }) => {
        if (destroyed) return;
        if (Hls.isSupported()) {
          const hls = new Hls({ maxBufferLength: 30, enableWorker: true, startPosition: resume?.time ?? -1 });
          if (resume?.playing) {
            hls.once(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
          }
          hls.loadSource(url);
          hls.attachMedia(video);
          detach = () => hls.destroy();
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          native();
        }
      });
    }
    return () => {
      destroyed = true;
      detach();
    };
    // `resume` is read when the source changes, not followed afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, url, kind]);
}
