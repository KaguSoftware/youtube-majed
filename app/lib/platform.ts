"use client";
import { useEffect, useState } from "react";

export type OS = "mac" | "windows" | "other";

/** The computer the page is open on (the helper runs on the same one). "mac" until the browser says otherwise, so server and first client render agree. */
export function useOS(): OS {
  const [os, setOS] = useState<OS>("mac");
  useEffect(() => {
    const ua = navigator.userAgent;
    setOS(/Windows/i.test(ua) ? "windows" : /Mac OS X|Macintosh/i.test(ua) ? "mac" : "other");
  }, []);
  return os;
}

/** What the file manager is called here. */
export const fileManager = (os: OS) => (os === "windows" ? "Explorer" : os === "mac" ? "Finder" : "the file manager");
