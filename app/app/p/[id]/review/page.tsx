"use client";
import { use } from "react";
import { WithProject } from "@/components/with-project";
import { ReviewView } from "./review-view";

export default function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  return <WithProject id={use(params).id} title="Review">{(p) => <ReviewView initial={p} />}</WithProject>;
}
