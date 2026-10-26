import Link from "next/link";

import { requireUser } from "@/lib/auth";
import { ago } from "@/lib/format";
import { machineHealth, machineStatus, waitingWork } from "@/lib/studio";

/** Always visible in the header: can the studio machine take work right now? */
export async function MachineStatus() {
  await requireUser();
  const [{ gpu, light }, health] = await Promise.all([machineStatus(), machineHealth()]);
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
  if (gpu.state === "ready" && health?.refusing) {
    // HealthBanner says why; the header only has to stop saying "ready".
    return (
      <span className="flex items-center gap-2 whitespace-nowrap px-2 py-1 text-sm text-muted">
        <span className="size-2 shrink-0 rounded-full bg-danger" aria-hidden />
        <span><span className="hidden sm:inline">Studio machine </span>needs attention</span>
      </span>
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
  if (status.light.state === "offline" && waiting.light > waiting.publishes) {
    lines.push(
      "Research and scripts that Claude is writing are waiting for the studio machine. " +
      "You can paste your own instead and carry on.",
    );
  }
  if (status.light.state === "offline" && waiting.publishes > 0) {
    lines.push(`${waiting.publishes === 1 ? "A film is" : `${waiting.publishes} films are`} waiting to be published to YouTube, and will upload when the machine is back.`);
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

/**
 * When the studio machine has found something wrong with itself (its nightly
 * test film, or software that no longer matches what was tested). Shown
 * while it is online: offline is OfflineBanner's. Plain words first; the
 * machine's own words folded away for whoever looks after it.
 */
export async function HealthBanner() {
  await requireUser();
  const [status, health] = await Promise.all([machineStatus(), machineHealth()]);
  if (!health || status.gpu.state === "offline") return null;
  const checked = health.checkedAt ? ` Last test ${ago(health.checkedAt)}.` : "";
  const details = (
    <details className="mt-1 text-xs text-muted">
      <summary className="cursor-pointer select-none text-faint hover:text-text">Details for whoever looks after the machine</summary>
      <ul className="mt-2 flex max-w-[110ch] flex-col gap-1 font-mono">
        {health.details.slice(0, 8).map((d, i) => <li key={i} className="break-words">{d}</li>)}
      </ul>
    </details>
  );
  if (health.refusing) {
    const why = health.refusing === "all"
      ? "Its software no longer matches the version that was tested, so it is not starting any work until that is put right."
      : "Its nightly test film failed, so it is not starting renders, looks or changes until a test passes. It tries again every hour.";
    return (
      <div role="alert" className="border-b border-danger/30 bg-danger-wash">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-6 py-3 text-sm text-text sm:flex-row sm:items-baseline sm:gap-6">
          <p className="shrink-0 whitespace-nowrap font-semibold text-danger">Studio machine needs attention</p>
          <div className="min-w-0">
            <p className="max-w-[90ch]">
              {why}
              {health.refusing === "gpu" && " Research and scripts carry on."}
              {" Nothing already made is affected."}
              <span className="text-muted">{checked}</span>
            </p>
            {details}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div role="status" className="border-b border-hairline">
      <div className="mx-auto flex max-w-6xl flex-col gap-1 px-6 py-2.5 text-sm text-muted sm:flex-row sm:items-baseline sm:gap-6">
        <p className="shrink-0 whitespace-nowrap font-semibold text-caution">Test film changed</p>
        <div className="min-w-0">
          <p className="max-w-[90ch]">
            The studio machine&rsquo;s nightly test film came out differently from before. Films still render;
            whoever looks after the machine should compare the two.{checked}
          </p>
          {details}
        </div>
      </div>
    </div>
  );
}
