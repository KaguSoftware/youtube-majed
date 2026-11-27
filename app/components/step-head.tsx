import type { StageState } from "@studio/schema";
import { STEPS } from "@/lib/steps";
import { StatusMark } from "./status";

/** The top of every step page: where you are, what state it is in (word and glyph), and what to do about it. */
export function StepHead({ stepKey, stage, title, children }: { stepKey: StageState["key"]; stage: StageState; title: string; children?: React.ReactNode }) {
  const step = STEPS.find((s) => s.key === stepKey)!;
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
      <div className="max-w-2xl">
        <p className="eyebrow text-faint">
          Step {step.n} of {STEPS.length} · {step.who === "You" ? "Your call" : step.who === "Claude" ? "Claude writes" : "Runs on this Mac"}
        </p>
        <h1 className="title-card mt-2 text-marquee">{title}</h1>
        <p className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-base">
          <StatusMark stage={stage} />
          <span className="text-muted">{stage.note}</span>
        </p>
      </div>
      {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
    </header>
  );
}

/** A quiet stack for the job bar and its error, sticky under the header while something runs. */
export function JobBar({ live, children }: { live: boolean; children: React.ReactNode }) {
  return <div className={`${live ? "sticky top-14 z-20 -mx-6 border-b border-hairline bg-room/95 px-6 py-3 backdrop-blur-[2px]" : ""} mt-8 space-y-4 empty:hidden`}>{children}</div>;
}
