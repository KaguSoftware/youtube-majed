import type { StageState } from "@studio/schema";
import { Check, Circle, CircleDot, TriangleAlert } from "lucide-react";
import { stageWord } from "@/lib/steps";

/** The glyph and the word for a step's state. Colour backs them up, never replaces them. */
export function StatusMark({ stage, className = "" }: { stage: Pick<StageState, "status" | "stale">; className?: string }) {
  const word = stageWord(stage);
  const stale = stage.status === "done" && stage.stale;
  const tone = stale ? "text-caution" : { waiting: "text-faint", running: "text-accent", needs_you: "text-accent", done: "text-ok" }[stage.status];
  return (
    <span className={`inline-flex items-center gap-1.5 ${tone} ${className}`}>
      {stale ? (
        <TriangleAlert aria-hidden size={13} strokeWidth={2.25} />
      ) : stage.status === "done" ? (
        <Check aria-hidden size={13} strokeWidth={2.5} />
      ) : stage.status === "running" ? (
        <span aria-hidden className="relative inline-flex size-[13px] items-center justify-center">
          <span className="absolute size-2 animate-ping rounded-full bg-accent/60 [animation-duration:1.8s]" />
          <span className="size-1.5 rounded-full bg-accent" />
        </span>
      ) : stage.status === "needs_you" ? (
        <CircleDot aria-hidden size={13} strokeWidth={2.5} />
      ) : (
        <Circle aria-hidden size={13} strokeWidth={2} />
      )}
      <span className="font-semibold">{word}</span>
    </span>
  );
}
