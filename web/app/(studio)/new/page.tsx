import type { Metadata } from "next";

import { NewFilmForm } from "./new-film-form";

export const metadata: Metadata = { title: "New film" };

export default function NewFilmPage() {
  return (
    <div className="mx-auto grid max-w-6xl gap-12 px-6 pb-24 pt-12 lg:grid-cols-[1fr_minmax(0,34rem)]">
      <div>
        <p className="eyebrow text-accent">New film</p>
        <h1 className="title-card mt-4 text-marquee">What is it about?</h1>
        <p className="mt-6 max-w-[48ch] text-lg text-muted">
          The topic becomes the film&rsquo;s title. Research comes next: Claude gathers sourced
          facts for you to check before a word of the script is written.
        </p>
      </div>
      <NewFilmForm cancel />
    </div>
  );
}
