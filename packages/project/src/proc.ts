/**
 * Child processes that behave the same on macOS and Windows.
 *
 * - `packageBin`: a package's CLI run as `node <its JS entry>` instead of the
 *   node_modules/.bin shim. The shim is a shell script on macOS and a .cmd
 *   file on Windows, which Node cannot spawn without a shell (and a shell
 *   would mangle paths with spaces).
 * - `GROUP` and `killTree`: start a child so that it can be stopped with
 *   everything it started (Remotion starts Chrome). macOS uses a process
 *   group; Windows has no groups, so taskkill /T walks the tree instead, and
 *   the child is not detached (that would open a console window).
 * - `scratchEnv`: point the temp folder somewhere; Node reads TMPDIR on macOS
 *   and TEMP/TMP on Windows.
 * - `scriptCommand`: run a .js/.mjs file (the fake claude in tests) with this
 *   Node; Windows cannot execute a script by its shebang.
 * - `reveal`: show a file in Finder or Explorer.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const IS_WINDOWS = process.platform === "win32";

/** Spawn options for a child that `killTree` can stop with its whole tree. */
export const GROUP = { detached: !IS_WINDOWS, windowsHide: true } as const;

/** Finds `pkg` from `fromDir` the way Node does (node_modules up the tree) and returns its CLI as [node, [entry]]. */
export function packageBin(fromDir: string, pkg: string, bin?: string): [string, string[]] {
  for (let dir = resolve(fromDir); ; dir = dirname(dir)) {
    const manifest = join(dir, "node_modules", pkg, "package.json");
    if (existsSync(manifest)) {
      const field = (JSON.parse(readFileSync(manifest, "utf8")) as { bin?: string | Record<string, string> }).bin;
      const rel = typeof field === "string" ? field : field?.[bin ?? pkg.split("/").pop()!];
      if (!rel) throw new Error(`${pkg} has no "${bin ?? pkg}" command`);
      return [process.execPath, [join(dirname(manifest), rel)]];
    }
    if (dirname(dir) === dir) throw new Error(`${pkg} is not installed (looked up from ${fromDir}); run pnpm install`);
  }
}

/** Stops a child started with GROUP, and everything it started. */
export function killTree(pid: number | undefined, signal: NodeJS.Signals = "SIGTERM"): void {
  if (!pid) return;
  try {
    if (IS_WINDOWS) spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else process.kill(-pid, signal);
  } catch {
    /* already gone */
  }
}

/** Environment that sends a child's temp files (Remotion bundles, Chrome profiles) to `dir`. */
export const scratchEnv = (dir: string): NodeJS.ProcessEnv => ({ TMPDIR: dir, TEMP: dir, TMP: dir });

/** [command, leading args] for a program that may be a .js/.mjs script. */
export function scriptCommand(bin: string): [string, string[]] {
  return /\.(c|m)?js$/i.test(bin) ? [process.execPath, [bin]] : [bin, []];
}

/** Opens Finder (macOS) or Explorer (Windows) with the file selected; elsewhere opens its folder. */
export function reveal(file: string): void {
  const [cmd, args, verbatim] =
    process.platform === "darwin" ? ["open", ["-R", file], false] : IS_WINDOWS ? ["explorer.exe", [`/select,"${file}"`], true] : ["xdg-open", [dirname(file)], false];
  const child = spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true, windowsVerbatimArguments: verbatim });
  child.on("error", () => undefined);
  child.unref();
}
