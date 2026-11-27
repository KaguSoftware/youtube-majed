import type { Metadata } from "next";
import { BriefForm } from "./brief-form";

export const metadata: Metadata = { title: "New story" };

export default function NewStory() {
  return (
    <div className="mx-auto max-w-3xl px-6 pb-24 pt-14">
      <p className="eyebrow text-faint">Step 1 · Brief</p>
      <h1 className="title-card mt-2 text-marquee">What happens?</h1>
      <BriefForm />
    </div>
  );
}
