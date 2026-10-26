import Link from "next/link";

import { requireUser } from "@/lib/auth";
import { ago } from "@/lib/format";
import { machineStatus, waitingWork } from "@/lib/studio";

/** Always visible in the header: can the studio machine take work right now? */
export async function MachineStatus() {
  await requireUser();
  const { gpu, light } = await machineStatus();
  // Busy on either lane is what the machine is doing; a research run on the
  // light lane must not read as "offline" just because nothing is rendering.
  const busy = gpu.state === "busy" ? gpu : light.state === "busy" ? light : null;
  if (busy) {
    return (
      <Link href={`/films/${busy.projectId}`}
        className="group flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-raised">
        <span className="relative flex size-2 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex size-2 rounded-full bg-accent" />
        </span>
        <span className="truncate text-text">{busy.doing}</span>
      </Link>
    );
  }
  if (gpu.state === "ready") {
    return (
      <span className="flex items-center gap-2 whitespace-nowrap px-2 py-1 text-sm text-muted">
        <span className="size-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <span><span className="hidden sm:inline">Studio machine </span>ready</span>
      </span>
    );
  }
  // Muted on purpose: an offline machine with nothing waiting is information,
  // not an alarm. OfflineBanner raises it when work is actually stuck.
  const lastSeen = gpu.state === "offline" ? gpu.lastSeen : null;
  return (
    <span className="flex items-center gap-2 whitespace-nowrap px-2 py-1 text-sm text-muted"
      title={lastSeen ? `Last seen ${ago(lastSeen)}` : undefined}>
      <span className="size-2 shrink-0 rounded-full ring-2 ring-inset ring-danger" aria-hidden />
      <span><span className="hidden sm:inline">Studio machine </span>offline</span>
    </span>
  );
}

/**
 * Only when work is actually waiting on an offline machine. An offline
 * machine with nothing queued needs no banner: the header already says so.
 */
export async function OfflineBanner() {
  await requireUser();
  const [status, waiting] = await Promise.all([machineStatus(), waitingWork()]);
  const lines: string[] = [];
  if (status.gpu.state === "offline" && waiting.gpu > 0) {
    // Name what is actually waiting: painting looks is not a render.
    const parts = [
      waiting.renders && (waiting.renders === 1 ? "one render" : `${waiting.renders} renders`),
      waiting.looks && (waiting.looks === 1 ? "one set of looks to paint" : `${waiting.looks} sets of looks to paint`),
    ].filter(Boolean).join(" and ");
    const what = parts.charAt(0).toUpperCase() + parts.slice(1);
    lines.push(`${what} ${waiting.gpu === 1 ? "is" : "are"} waiting for it and will start on ${waiting.gpu === 1 ? "its" : "their"} own when the machine is back.`);
    lines.push("You can keep working on research and scripts in the meantime.");
  }
  if (status.light.state === "offline" && waiting.light > 0) {
    lines.push(
      "Research and scripts that Claude is writing are waiting for the studio machine. " +
      "You can paste your own instead and carry on.",
    );
  }
  if (!lines.length) return null;
  // "Last seen" for the lane whose waiting work the banner is about.
  const lane = status.gpu.state === "offline" && waiting.gpu > 0 ? status.gpu : status.light;
  const seen = lane.state === "offline" ? lane.lastSeen : null;
  return (
    <div role="status" className="border-b border-danger/30 bg-danger-wash">
      <div className="mx-auto flex max-w-6xl flex-col gap-1 px-6 py-3 text-sm text-text sm:flex-row sm:items-baseline sm:gap-6">
        <p className="shrink-0 whitespace-nowrap font-semibold text-danger">Studio machine offline</p>
        <p className="max-w-[90ch]">
          {lines.join(" ")}
          {seen && <span className="text-muted"> Last seen {ago(seen)}.</span>}
        </p>
      </div>
    </div>
  );
}
