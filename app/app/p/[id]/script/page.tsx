"use client";
import Link from "next/link";
import { use } from "react";
import { WithProject } from "@/components/with-project";
import { button } from "@/components/ui";
import type { ProjectDetail } from "@/lib/api";
import { ScriptEditor } from "./editor";

export default function ScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <WithProject id={id} title={(p) => `Script · ${p.title ?? p.id}`}>{(p) => <Script id={id} p={p} />}</WithProject>;
}

function Script({ id, p }: { id: string; p: ProjectDetail }) {
  if (!p.narration || !p.loopmap) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24">
        <p className="eyebrow text-faint">Script</p>
        <h1 className="title-card mt-2 text-title">No script yet</h1>
        <p className="mt-3 text-muted">Pick one of the three stories first; Claude writes the loop map and the narration from it.</p>
        <Link href={`/p/${id}`} className={`${button.secondary} mt-6`}>Back to the story</Link>
      </div>
    );
  }
  return <ScriptEditor initial={p} />;
}
