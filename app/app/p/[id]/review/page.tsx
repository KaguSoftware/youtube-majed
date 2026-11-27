import type { Metadata } from "next";
import { WorkerOffline } from "@/components/offline";
import { loadProject } from "@/lib/server";
import { ReviewView } from "./review-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review" };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const r = await loadProject((await params).id);
  if (!r.ok) return <WorkerOffline error={r.error} offline={r.offline} />;
  return <ReviewView initial={r.data} />;
}
