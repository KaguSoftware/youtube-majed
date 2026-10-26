import Link from "next/link";
import { Suspense } from "react";

import { MachineStatus, OfflineBanner } from "@/components/machine-status";
import { UserMenu } from "@/components/user-menu";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-ink">
        Skip to content
      </a>
      <header className="border-b border-hairline">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-6">
          <Link href="/" className="title-card text-xl tracking-tight text-text hover:text-accent">
            Studio
          </Link>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <Suspense fallback={<span className="h-5 w-40 animate-pulse rounded bg-raised" />}>
              <MachineStatus />
            </Suspense>
            <span className="h-5 w-px bg-hairline" aria-hidden />
            <Suspense fallback={<span className="h-5 w-20 animate-pulse rounded bg-raised" />}>
              <UserMenu />
            </Suspense>
          </div>
        </div>
      </header>
      <Suspense fallback={null}>
        <OfflineBanner />
      </Suspense>
      <main id="main" className="flex-1">{children}</main>
    </div>
  );
}
