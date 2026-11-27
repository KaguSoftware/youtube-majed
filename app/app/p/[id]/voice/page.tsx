import type { Metadata } from "next";
import { WorkerOffline } from "@/components/offline";
import { loadProject } from "@/lib/server";
import { VoiceView } from "./voice-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Voice" };

export default async function VoicePage({ params }: { params: Promise<{ id: string }> }) {
  const r = await loadProject((await params).id);
  if (!r.ok) return <WorkerOffline error={r.error} offline={r.offline} />;
  return <VoiceView initial={r.data} />;
}
