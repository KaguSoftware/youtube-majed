import type { Metadata } from "next";
import { WorkerOffline } from "@/components/offline";
import { loadProject } from "@/lib/server";
import { ExportView } from "./export-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Export" };

export default async function ExportPage({ params }: { params: Promise<{ id: string }> }) {
  const r = await loadProject((await params).id);
  if (!r.ok) return <WorkerOffline error={r.error} offline={r.offline} />;
  return <ExportView initial={r.data} />;
}
