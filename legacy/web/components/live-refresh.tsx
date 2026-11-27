"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** While something is being made elsewhere, re-render the server view on an
 *  interval. Pauses when the tab is hidden. */
export function LiveRefresh({ every = 5000 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") router.refresh(); };
    const id = setInterval(tick, every);
    return () => clearInterval(id);
  }, [router, every]);
  return null;
}
