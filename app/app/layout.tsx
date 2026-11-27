import type { Metadata } from "next";
import { Mona_Sans } from "next/font/google";
import Link from "next/link";
import "./globals.css";

// One family carries everything: its width axis gives title cards (condensed,
// heavy) and plain interface text without a second typeface.
const mona = Mona_Sans({ subsets: ["latin"], axes: ["wdth"], variable: "--font-mona", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Studio", template: "%s · Studio" },
  description: "Story engine: from one sentence to a locked script.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={mona.variable}>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-ink">
          Skip to content
        </a>
        <header className="sticky top-0 z-30 border-b border-hairline bg-room/95 backdrop-blur-[2px]">
          <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-6 px-6">
            <Link href="/" className="title-card text-lg tracking-wide text-text hover:text-accent">
              STUDIO
            </Link>
            <nav aria-label="Main" className="flex items-center gap-1 text-sm">
              <Link href="/" className="rounded-md px-3 py-1.5 text-muted hover:bg-raised hover:text-text">
                Stories
              </Link>
              <Link href="/new" className="rounded-md px-3 py-1.5 text-muted hover:bg-raised hover:text-text">
                New story
              </Link>
            </nav>
          </div>
        </header>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
