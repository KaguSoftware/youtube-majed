import Link from "next/link";

import { button } from "@/components/ui";

export default function FilmNotFound() {
  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-16">
      <h1 className="title-card text-title">There is no film at this address.</h1>
      <p className="mt-3 max-w-[55ch] text-muted">It may have been typed wrong, or the link is from another studio.</p>
      <Link href="/" className={`${button.secondary} mt-8`}>Back to films</Link>
    </div>
  );
}
