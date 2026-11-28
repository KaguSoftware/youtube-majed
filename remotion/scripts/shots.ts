/**
 * What the render scripts do about custom shots (docs/PLAN.md section 6):
 * check again every live shot whose check is stale, put the library scene back
 * for any that fail now, then stage the survivors for the bundle.
 *
 * A check goes stale when the render code changed (the library the shot draws
 * with) or the scene's frames, word times or library scene changed (the shot
 * was drawn with others). Each stale shot is checked in a child process with a
 * time limit, so a shot that hangs cannot hang the render.
 */
import { GROUP, killTree, packageBin, readShots, recordCheck, renderCodeHash, scratchEnv, stageProject } from "@studio/project";
import type { Project, ShotCheck } from "@studio/schema";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shotInputsHash } from "../src/scene/segments";
import { buildTimeline } from "../src/scene/timeline";
import { REMOTION_DIR } from "./load";

export const CHECK_TIMEOUT_MS = Number(process.env.STUDIO_SHOT_TIMEOUT_S ?? 120) * 1000;

/** Runs scripts/check-shot.ts with a time limit; the whole process group is killed on a timeout (Chrome included). */
export function runCheck(projectId: string, shotId: string, say: (m: string) => void): Promise<ShotCheck> {
  return new Promise((resolve) => {
    // the checker's bundle and browser profile go in a folder of its own, removed afterwards even if it had to be killed
    const scratch = mkdtempSync(join(tmpdir(), "studio-shot-"));
    const [node, tsx] = packageBin(REMOTION_DIR, "tsx");
    const child = spawn(node, [...tsx, join(REMOTION_DIR, "scripts/check-shot.ts"), projectId, "--shot", shotId], { cwd: REMOTION_DIR, ...GROUP, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...scratchEnv(scratch) } });
    let out = "";
    let err = "";
    let timedOut = false;
    child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
    const kill = setTimeout(() => {
      timedOut = true;
      killTree(child.pid, "SIGKILL");
    }, CHECK_TIMEOUT_MS);
    child.on("close", () => {
      clearTimeout(kill);
      rmSync(scratch, { recursive: true, force: true });
      const failed = (kind: "timeout" | "crash", message: string): ShotCheck => ({ at: new Date().toISOString(), codeHash: renderCodeHash(), inputs: "", ok: false, failure: { kind, message }, imports: [], stills: { landscape: [], portrait: [] }, renderMs: CHECK_TIMEOUT_MS, warnings: [] });
      if (timedOut) return resolve(failed("timeout", `the shot did not finish drawing within ${CHECK_TIMEOUT_MS / 1000} s`));
      const line = out.trim().split("\n").at(-1) ?? "";
      try {
        resolve((JSON.parse(line) as { check: ShotCheck }).check);
      } catch {
        say(err.trim().slice(-600));
        resolve(failed("crash", `the checker died: ${(err.trim().split("\n").at(-1) ?? "no output").slice(0, 300)}`));
      }
    });
  });
}

/**
 * Before a render: re-check stale live shots, fall back for the ones that fail, stage the rest.
 * Returns scene id → source hash of the shots this render draws (what planSegments takes as `custom`).
 */
export async function prepareShots(projectId: string, project: Project, say: (m: string) => void): Promise<Record<string, string>> {
  const sceneIds = new Set(project.scenes.scenes.map((s) => s.id));
  const code = renderCodeHash();
  const timeline = buildTimeline(project);
  const indexOf = new Map(project.scenes.scenes.map((s, i) => [s.id, i]));
  for (const shot of readShots(projectId).shots) {
    if (!["verified", "accepted"].includes(shot.status) || !sceneIds.has(shot.sceneId)) continue;
    const inputs = shotInputsHash(project, timeline, indexOf.get(shot.sceneId)!);
    const stale = !shot.check?.ok ? "never checked" : shot.check.codeHash !== code ? "the library changed" : shot.check.inputs !== inputs ? "its scene changed" : "";
    if (!stale) continue;
    say(`custom shot ${shot.id} on ${shot.sceneId}: checking again (${stale})`);
    const check = await runCheck(projectId, shot.id, say);
    // keep the stills the check drew; a failed check is recorded and the library scene is drawn
    const after = recordCheck(projectId, shot.id, check);
    if (after.status === "failed") say(`custom shot ${shot.id} fell back to the library scene ${shot.sceneId}: ${after.reason}`);
  }
  const custom = stageProject(projectId, sceneIds);
  // the composition reads which scenes have a shot from public/projects/<id>/custom.json (scripts/project-entry.tsx)
  const publicDir = join(REMOTION_DIR, "public", "projects", projectId);
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(join(publicDir, "custom.json"), JSON.stringify({ scenes: custom }) + "\n");
  return custom;
}
