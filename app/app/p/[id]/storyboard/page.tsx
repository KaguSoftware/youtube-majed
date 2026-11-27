import type { Metadata } from "next";
import { WorkerOffline } from "@/components/offline";
import { loadProject } from "@/lib/server";
import { StoryboardView } from "./storyboard-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Storyboard" };

export default async function StoryboardPage({ params }: { params: Promise<{ id: string }> }) {
  const r = await loadProject((await params).id);
  if (!r.ok) return <WorkerOffline error={r.error} offline={r.offline} />;
  return <StoryboardView initial={r.data} />;
}
