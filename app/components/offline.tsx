"use client";
import { RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { type OS, useOS } from "@/lib/platform";
import { CopyButton } from "./copy-button";
import { button } from "./ui";

/** One line installs the helper on a Mac: the repo into ~/Studio, its tools, and a login item that keeps the worker running (scripts/install-helper.sh). */
export const INSTALL_MAC = "curl -fsSL https://raw.githubusercontent.com/KaguSoftware/youtube-majed/main/scripts/install-helper.sh | bash";
/** The same on Windows, in PowerShell: the repo into %USERPROFILE%\Studio, tools from winget, a Startup shortcut (scripts/install-helper.ps1). */
export const INSTALL_WINDOWS = "irm https://raw.githubusercontent.com/KaguSoftware/youtube-majed/main/scripts/install-helper.ps1 | iex";

const INSTALL: Record<"mac" | "windows", { where: string; how: string; command: string; start: string }> = {
  mac: { where: "Mac", how: "paste this into Terminal. It installs the helper into ~/Studio and starts it at every login.", command: INSTALL_MAC, start: "~/Studio/scripts/helper.sh start" },
  windows: { where: "Windows PC", how: "paste this into PowerShell (no administrator needed). It installs the helper into your Studio folder and starts it at every login. An NVIDIA graphics card makes the voice much faster.", command: INSTALL_WINDOWS, start: "~\\Studio\\scripts\\helper.cmd start" },
};
const other = (os: OS): "mac" | "windows" => (os === "windows" ? "mac" : "windows");
const here = (os: OS): "mac" | "windows" => (os === "windows" ? "windows" : "mac");

/** The page is served from somewhere other than this computer (Vercel), so the helper may simply not be installed here. */
export function useHosted() {
  const [hosted, setHosted] = useState(false);
  useEffect(() => setHosted(!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)), []);
  return hosted;
}

function Command({ text }: { text: string }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-md bg-raised py-1.5 pl-4 pr-1.5 ring-1 ring-inset ring-hairline">
      <code className="min-w-0 flex-1 break-all py-1.5 font-mono text-sm text-text">{text}</code>
      <CopyButton text={text} />
    </div>
  );
}

/**
 * What a page shows when it can't reach the worker. `offline` means nothing
 * answered: the helper isn't running on this computer, or the browser blocked
 * the call. The page that shows this keeps checking (components/with-project.tsx)
 * and replaces it on its own once the helper answers.
 */
export function WorkerOffline({ error, offline, onRetry, retrying }: { error: string; offline: boolean; onRetry?: () => void; retrying?: boolean }) {
  const hosted = useHosted();
  const os = useOS();
  const mine = INSTALL[here(os)];
  const theirs = INSTALL[other(os)];

  if (!offline) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24">
        <p className="eyebrow text-danger">Couldn&apos;t load</p>
        <h1 className="title-card mt-3 text-title">Something went wrong</h1>
        <p className="mt-4 text-muted">{error}</p>
        {onRetry && (
          <button type="button" className={`${button.secondary} mt-8`} onClick={onRetry} disabled={retrying}>
            <RotateCw aria-hidden size={14} className={retrying ? "motion-safe:animate-spin" : ""} />
            Try again
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 pb-24 pt-20">
      <p className="eyebrow text-danger">{hosted ? "Helper not running" : "Worker offline"}</p>
      <h1 className="title-card mt-3 text-title">{hosted ? "This computer isn't running the Studio" : "The studio machine isn't listening"}</h1>
      <p className="mt-4 max-w-[62ch] text-muted">
        {hosted
          ? "This site is only the screen. Claude, the voice and the renders run on the computer in front of you, in the Studio helper, and your stories stay on its disk."
          : "The worker runs Claude, the voice and the renders. Start it in a terminal at the repo root:"}
      </p>
      {!hosted && <Command text="pnpm worker" />}

      {hosted && (
        <ol className="mt-12 divide-y divide-hairline border-y border-hairline">
          <li className="grid gap-x-6 gap-y-1 py-6 sm:grid-cols-[11rem_1fr]">
            <h2 className="font-semibold text-text">First time on this computer</h2>
            <div className="min-w-0">
              <p className="text-muted">On a {mine.where}, {mine.how}</p>
              <Command text={mine.command} />
              <p className="mt-5 text-sm text-faint">On a {theirs.where} instead:</p>
              <Command text={theirs.command} />
            </div>
          </li>
          <li className="grid gap-x-6 gap-y-1 py-6 sm:grid-cols-[11rem_1fr]">
            <h2 className="font-semibold text-text">Installed already</h2>
            <div className="min-w-0">
              <p className="text-muted">The helper starts at login. If it stopped, start it again:</p>
              <Command text={mine.start} />
            </div>
          </li>
          <li className="grid gap-x-6 gap-y-1 py-6 sm:grid-cols-[11rem_1fr]">
            <h2 className="font-semibold text-text">Browser asked about devices</h2>
            <p className="min-w-0 text-muted">
              Chrome and Edge ask once whether this site may reach devices on your local network: allow it, since that&apos;s how the page reaches the helper. If you blocked it, turn it back on under the site settings (the icon left of the address). Safari blocks this; use Chrome, Edge or Firefox.
            </p>
          </li>
        </ol>
      )}

      <p className="mt-8 flex items-center gap-3 text-sm text-faint" aria-live="polite">
        <span aria-hidden className={`inline-block size-2 shrink-0 rounded-full bg-caution ${retrying ? "motion-safe:animate-pulse" : ""}`} />
        <span className="min-w-0">Checking again every few seconds. The page opens by itself once the {hosted ? "helper" : "worker"} answers.</span>
        {onRetry && (
          <button type="button" className={`${button.quiet} -my-2 shrink-0 whitespace-nowrap`} onClick={onRetry} disabled={retrying}>
            Check now
          </button>
        )}
      </p>
    </div>
  );
}
