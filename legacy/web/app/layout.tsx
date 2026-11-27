import type { Metadata } from "next";
import { Mona_Sans } from "next/font/google";

import "./globals.css";

// One family carries everything: its width axis gives film-title cards
// (condensed, heavy) and plain interface text (normal width) without a second
// typeface. See .title-card in globals.css.
const mona = Mona_Sans({ subsets: ["latin"], axes: ["wdth"], variable: "--font-mona", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Studio", template: "%s · Studio" },
  description: "Researched history films, from topic to finished video.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={mona.variable}>
      <body>{children}</body>
    </html>
  );
}
