"use client";
import { use } from "react";
import { WithProject } from "@/components/with-project";
import { VoiceView } from "./voice-view";

export default function VoicePage({ params }: { params: Promise<{ id: string }> }) {
  return <WithProject id={use(params).id} title="Voice">{(p) => <VoiceView initial={p} />}</WithProject>;
}
