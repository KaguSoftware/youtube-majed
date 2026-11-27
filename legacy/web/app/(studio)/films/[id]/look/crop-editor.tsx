"use client";

import { useActionState, useRef, useState } from "react";

import { button } from "@/components/ui";

import { lockLook } from "./actions";
import type { ActionState } from "../actions";

type Box = [number, number, number, number];

const MIN_W = 0.08;
const MIN_H = 0.12;
/** Above this share of the frame the crop carries the scene, not just the
 *  character, and shots start copying the hero's setting (HANDOFF.md 4). */
const TOO_MUCH = 0.45;

function clampBox([x0, y0, x1, y1]: Box): Box {
  const w = Math.max(MIN_W, Math.min(1, x1 - x0));
  const h = Math.max(MIN_H, Math.min(1, y1 - y0));
  const nx = Math.min(Math.max(0, x0), 1 - w);
  const ny = Math.min(Math.max(0, y0), 1 - h);
  return [nx, ny, nx + w, ny + h];
}

/**
 * The character crop. Every shot in the film is painted with this crop as its
 * reference, so it should hold the face and costume and as little of the
 * scene as possible: a crop that includes the setting makes shots copy it.
 */
export function CropEditor({ projectId, runId, index, url, initial, description }: {
  projectId: string; runId: string; index: number; url: string; initial: Box; description: string;
}) {
  const [box, setBox] = useState<Box>(initial);
  const [state, action, pending] = useActionState<ActionState, FormData>(lockLook.bind(null, projectId), {});
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: "move" | "nw" | "se"; x: number; y: number; start: Box } | null>(null);

  // One handler for the box and its corners; the element says which it is.
  const onDown = (e: React.PointerEvent<HTMLElement>) => {
    const mode = (e.target as HTMLElement).dataset.drag as "move" | "nw" | "se" | undefined;
    if (!mode) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, y: e.clientY, start: box };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const rect = frame.current?.getBoundingClientRect();
    if (!d || !rect) return;
    const dx = (e.clientX - d.x) / rect.width;
    const dy = (e.clientY - d.y) / rect.height;
    const [x0, y0, x1, y1] = d.start;
    if (d.mode === "move") setBox(clampBox([x0 + dx, y0 + dy, x1 + dx, y1 + dy]));
    else if (d.mode === "nw") setBox(clampBox([Math.min(x0 + dx, x1 - MIN_W), Math.min(y0 + dy, y1 - MIN_H), x1, y1]));
    else setBox(clampBox([x0, y0, Math.max(x1 + dx, x0 + MIN_W), Math.max(y1 + dy, y0 + MIN_H)]));
  };
  const onUp = () => { drag.current = null; };
  const onKey = (e: React.KeyboardEvent) => {
    const step = 0.01;
    const k = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!k) return;
    e.preventDefault();
    const [x0, y0, x1, y1] = box;
    setBox(clampBox(e.shiftKey ? [x0, y0, x1 + k[0], y1 + k[1]] : [x0 + k[0], y0 + k[1], x1 + k[0], y1 + k[1]]));
  };

  const [x0, y0, x1, y1] = box;
  const area = (x1 - x0) * (y1 - y0);
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  // The frame is 832x480; the preview keeps the crop's true proportions.
  const cropAspect = ((x1 - x0) * 832) / ((y1 - y0) * 480);

  return (
    <form action={action} className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <input type="hidden" name="run" value={runId} />
      <input type="hidden" name="candidate" value={index} />
      <input type="hidden" name="box" value={box.map((v) => v.toFixed(4)).join(",")} />
      <div>
        <div ref={frame} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          className="relative aspect-[832/480] w-full touch-none select-none overflow-hidden rounded-sm bg-raised">
          {/* eslint-disable-next-line @next/next/no-img-element -- presigned media, not optimisable */}
          <img src={url} alt="The chosen look" className="absolute inset-0 size-full object-cover" draggable={false} />
          <div
            role="group" aria-roledescription="crop box" tabIndex={0} data-drag="move"
            aria-label={`Character crop, ${Math.round(area * 100)}% of the frame. Arrow keys move it; Shift and arrow keys resize it.`}
            onPointerDown={onDown} onKeyDown={onKey}
            className="absolute cursor-move outline-2 outline-accent focus-visible:outline-offset-0"
            style={{ left: pct(x0), top: pct(y0), width: pct(x1 - x0), height: pct(y1 - y0),
              boxShadow: "0 0 0 9999px oklch(0.12 0.005 85 / 0.66)" }}
          >
            {(["nw", "se"] as const).map((h) => (
              <span key={h} data-drag={h} aria-hidden
                className={"absolute size-4 rounded-sm bg-accent " +
                  (h === "nw" ? "-left-2 -top-2 cursor-nwse-resize" : "-bottom-2 -right-2 cursor-nwse-resize")} />
            ))}
          </div>
        </div>
        <p className="mt-3 text-sm text-muted">
          Drag the box over the character: face and costume, as little background as you can. Drag a yellow corner to resize.
        </p>
      </div>
      <div className="flex flex-col gap-4">
        <p className="eyebrow text-muted">Every shot uses this</p>
        <div className="w-full overflow-hidden rounded-sm bg-raised" style={{ aspectRatio: String(cropAspect), maxHeight: "18rem" }}>
          <div className="size-full" style={{
            backgroundImage: `url(${url})`,
            backgroundSize: `${100 / (x1 - x0)}% ${100 / (y1 - y0)}%`,
            backgroundPosition: `${x1 - x0 < 1 ? (x0 / (1 - (x1 - x0))) * 100 : 0}% ${y1 - y0 < 1 ? (y0 / (1 - (y1 - y0))) * 100 : 0}%`,
          }} />
        </div>
        <p className={`text-sm ${area > TOO_MUCH ? "text-caution" : "text-muted"}`} aria-live="polite">
          {area > TOO_MUCH
            ? `The crop covers ${Math.round(area * 100)}% of the frame. That much background makes shots copy this scene; tighten it to the character.`
            : `${Math.round(area * 100)}% of the frame.`}
        </p>
        <label htmlFor="look-words" className="eyebrow mt-2 text-muted">This look, in words</label>
        <textarea id="look-words" name="prompt_prefix" rows={3} defaultValue={description}
          className="w-full rounded-md bg-raised px-3 py-2 text-sm text-text ring-1 ring-inset ring-edge focus:outline-none focus:ring-2 focus:ring-accent" />
        <p className="text-xs text-faint">
          Describe what you see in this frame: its medium, line and colour. Every shot is told to look like this, so the
          closer it matches the frame, the more consistent the film. Measured: matching words held one look across lake,
          reeds and desert shots that otherwise drifted.
        </p>
        {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
        <button type="submit" disabled={pending} className={button.primary}>
          {pending ? "Locking the look…" : "Lock this look"}
        </button>
      </div>
    </form>
  );
}
