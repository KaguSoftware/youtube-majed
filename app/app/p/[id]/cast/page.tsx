import type { Metadata } from "next";
import { WorkerOffline } from "@/components/offline";
import { loadProject } from "@/lib/server";
import { CastView } from "./cast-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cast" };

export default async function CastPage({ params }: { params: Promise<{ id: string }> }) {
  const r = await loadProject((await params).id);
  if (!r.ok) return <WorkerOffline error={r.error} offline={r.offline} />;
  return <CastView initial={r.data} />;
}
