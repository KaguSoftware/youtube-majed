/** The cross-platform child-process helpers (packages/project/src/proc.ts). CI runs these on macOS, Linux and Windows. */
import { GROUP, IS_WINDOWS, REPO_DIR, killTree, packageBin, scratchEnv, scriptCommand } from "@studio/project";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REMOTION_DIR = join(REPO_DIR, "remotion");

describe("packageBin", () => {
  it("runs a package's CLI with this Node, not the .bin shim", () => {
    const [node, args] = packageBin(REMOTION_DIR, "tsx");
    expect(node).toBe(process.execPath);
    expect(existsSync(args[0]!)).toBe(true);
    const r = spawnSync(node, [...args, "--version"], { encoding: "utf8", windowsHide: true });
    expect(r.status).toBe(0);
  });
  it("picks a named command of a package with several", () => {
    const [, [entry]] = packageBin(REMOTION_DIR, "@remotion/cli", "remotion");
    expect(entry).toMatch(/remotion-cli\.js$/);
  });
  it("says so when a package is missing", () => {
    expect(() => packageBin(REMOTION_DIR, "no-such-package-studio")).toThrow(/not installed/);
  });
});

describe("scriptCommand", () => {
  it("runs scripts with Node and programs as they are", () => {
    expect(scriptCommand("/x/fake/claude.mjs")).toEqual([process.execPath, ["/x/fake/claude.mjs"]]);
    expect(scriptCommand("claude")).toEqual(["claude", []]);
  });
});

describe("killTree", () => {
  it("stops a child and the process it started", async () => {
    // a parent that starts a grandchild and prints its pid, then both wait forever
    const code = `const c = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); console.log(c.pid); setInterval(() => {}, 1000);`;
    const parent = spawn(process.execPath, ["-e", code], { ...GROUP, stdio: ["ignore", "pipe", "ignore"] });
    const grandchild = await new Promise<number>((done) => parent.stdout.once("data", (d: Buffer) => done(Number(d.toString().trim()))));
    const exited = new Promise((done) => parent.once("exit", done));
    killTree(parent.pid);
    await exited;
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let i = 0; i < 40 && alive(grandchild); i++) await new Promise((r) => setTimeout(r, 50));
    expect(alive(grandchild)).toBe(false);
  });
});

describe("scratchEnv", () => {
  it("sets the temp folder for both platforms", () => {
    expect(scratchEnv("/s")).toEqual({ TMPDIR: "/s", TEMP: "/s", TMP: "/s" });
    expect(typeof IS_WINDOWS).toBe("boolean");
  });
});
