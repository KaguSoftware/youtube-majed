import type { Metadata } from "next";
import { WorkerOffline } from "@/components/offline";
import { loadProject } from "@/lib/server";
import { EditorView } from "./editor-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Editor" };

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const r = await loadProject((await params).id);
  if (!r.ok) return <WorkerOffline error={r.error} offline={r.offline} />;
  return <EditorView initial={r.data} />;
}
