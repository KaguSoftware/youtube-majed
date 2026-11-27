import type { Metadata } from "next";
import { WorkerOffline } from "@/components/offline";
import { loadProject } from "@/lib/server";
import { RenderView } from "./render-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Render" };

export default async function RenderPage({ params }: { params: Promise<{ id: string }> }) {
  const r = await loadProject((await params).id);
  if (!r.ok) return <WorkerOffline error={r.error} offline={r.offline} />;
  return <RenderView initial={r.data} />;
}
