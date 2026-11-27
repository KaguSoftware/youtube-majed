import Link from "next/link";
import { NARRATIVES } from "@studio/schema";
import { WorkerOffline } from "@/components/offline";
import { button } from "@/components/ui";
import { ago, minutesLabel } from "@/lib/format";
import { loadProjects } from "@/lib/server";

export const dynamic = "force-dynamic";

const STATE: Record<string, { word: string; tone: string }> = {
  brief: { word: "Writing options", tone: "text-muted" },
  options: { word: "Pick a story", tone: "text-accent" },
  writing: { word: "Writing the script", tone: "text-muted" },
  script: { word: "In the editor", tone: "text-text" },
  locked: { word: "Locked", tone: "text-ok" },
};

export default async function Home() {
  const r = await loadProjects();
  if (!r.ok) return <WorkerOffline error={r.error} offline={r.offline} />;
  const projects = r.data;

  return (
    <div className="mx-auto max-w-5xl px-6 pb-24 pt-14">
      <div className="flex items-end justify-between gap-6">
        <div>
          <p className="eyebrow text-faint">Stories</p>
          <h1 className="title-card mt-2 text-marquee">One sentence in.</h1>
        </div>
        <Link href="/new" className={button.primary}>
          New story
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="mt-16 max-w-xl border-t border-hairline pt-10">
          <h2 className="text-lg font-semibold">No stories yet</h2>
          <p className="mt-2 text-muted">
            Start with one sentence: a premise, a true event, a "what if". Claude writes three ways to tell it, you pick one, and it comes back as a script you can shape line by line before it goes to the voice.
          </p>
          <Link href="/new" className={`${button.secondary} mt-6`}>
            Write the first sentence
          </Link>
        </div>
      ) : (
        <ul className="mt-12 divide-y divide-hairline border-y border-hairline">
          {projects.map((p) => {
            const s = STATE[p.state]!;
            return (
              <li key={p.id}>
                <Link href={p.state === "script" || p.state === "locked" ? `/p/${p.id}/script` : `/p/${p.id}`} className="group grid grid-cols-[1fr_auto] items-baseline gap-x-8 gap-y-1 px-2 py-5 hover:bg-raised sm:grid-cols-[1fr_9rem_9rem]">
                  <span className="min-w-0">
                    <span className="block truncate text-lg font-semibold text-text group-hover:text-accent">{p.title ?? p.brief.sentence}</span>
                    {p.title && <span className="mt-0.5 block truncate text-sm text-faint">{p.brief.sentence}</span>}
                  </span>
                  <span className="tabular text-sm text-muted">
                    {p.brief.format === "reel" ? "Reel" : "YouTube"} · {minutesLabel(p.brief.minutes)}
                    <span className="block text-faint">{NARRATIVES[p.brief.narrative].label}</span>
                  </span>
                  <span className="col-start-2 row-start-1 text-right text-sm sm:col-start-3">
                    <span className={`font-semibold ${s.tone}`}>{s.word}</span>
                    <span className="block text-faint">{ago(p.updatedAt)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
