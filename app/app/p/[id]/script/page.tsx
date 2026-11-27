import type { Metadata } from "next";
import Link from "next/link";
import { WorkerOffline } from "@/components/offline";
import { button } from "@/components/ui";
import { loadProject } from "@/lib/server";
import { ScriptEditor } from "./editor";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const r = await loadProject((await params).id);
  return { title: r.ok ? `Script · ${r.data.title ?? r.data.id}` : "Script" };
}

export default async function ScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await loadProject(id);
  if (!r.ok) return <WorkerOffline error={r.error} offline={r.offline} />;
  if (!r.data.narration || !r.data.loopmap) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24">
        <p className="eyebrow text-faint">Script</p>
        <h1 className="title-card mt-2 text-title">No script yet</h1>
        <p className="mt-3 text-muted">Pick one of the three stories first; Claude writes the loop map and the narration from it.</p>
        <Link href={`/p/${id}`} className={`${button.secondary} mt-6`}>Back to the story</Link>
      </div>
    );
  }
  return <ScriptEditor initial={r.data} />;
}
