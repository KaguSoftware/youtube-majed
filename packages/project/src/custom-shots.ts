import { CustomShotsFile, LIVE_STATUSES, type CustomShot, type CustomShotLogLine, type ShotCheck } from "@studio/schema";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projectPaths, readJson, writeJson } from "./index";

/** Custom shots (docs/PLAN.md section 6) on disk. The manifest format is `CustomShotsFile` in @studio/schema. */

export type CustomPaths = {
  dir: string;
  manifest: string;
  /** every source ever written for the project, by content hash */
  srcDir: string;
  /** stills each check drew, per shot */
  stillsDir: string;
  log: string;
};

export function customPaths(id: string): CustomPaths {
  const dir = join(projectPaths(id).dir, "custom");
  return { dir, manifest: join(dir, "shots.json"), srcDir: join(dir, "src"), stillsDir: join(dir, "stills"), log: join(dir, "log.jsonl") };
}

/** Where staged sources live for a bundle (remotion/src/custom/registry.ts reads this folder). */
// (not built from REPO_DIR: index.ts re-exports this module, so REPO_DIR is not initialised yet when this line runs)
export const STAGE_DIR = resolve(fileURLToPath(import.meta.url), "../../../../remotion/src/custom/.staged");

export const sourceHash = (source: string): string => createHash("sha256").update(source).digest("hex").slice(0, 16);

export const emptyShots = (): CustomShotsFile => ({ version: 1, shots: [] });

export function readShots(id: string): CustomShotsFile {
  return readJson(customPaths(id).manifest, CustomShotsFile) ?? emptyShots();
}

export function writeShots(id: string, file: CustomShotsFile): void {
  writeJson(customPaths(id).manifest, CustomShotsFile.parse(file));
}

export function saveSource(id: string, source: string): string {
  const hash = sourceHash(source);
  const { srcDir } = customPaths(id);
  mkdirSync(srcDir, { recursive: true });
  const file = join(srcDir, `${hash}.tsx`);
  if (!existsSync(file)) writeFileSync(file, source);
  return hash;
}

export function readSource(id: string, hash: string): string {
  const file = join(customPaths(id).srcDir, `${hash}.tsx`);
  if (!existsSync(file)) throw new Error(`custom shot source ${hash} is missing: ${file}`);
  return readFileSync(file, "utf8");
}

export function appendLog(id: string, line: Omit<CustomShotLogLine, "at"> & { at?: string }): void {
  const { log } = customPaths(id);
  mkdirSync(customPaths(id).dir, { recursive: true });
  appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), ...line }) + "\n");
}

export function readLog(id: string): CustomShotLogLine[] {
  const { log } = customPaths(id);
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as CustomShotLogLine);
}

/** The shots drawn instead of their library scene: live status, and the scene still exists. */
export function liveShots(id: string, sceneIds?: ReadonlySet<string>): CustomShot[] {
  return readShots(id).shots.filter((s) => LIVE_STATUSES.includes(s.status) && (!sceneIds || sceneIds.has(s.sceneId)));
}

/** Scene id → source hash for the shots a render draws (what `planSegments` takes as `custom`). */
export function customHashes(id: string, sceneIds?: ReadonlySet<string>): Record<string, string> {
  return Object.fromEntries(liveShots(id, sceneIds).map((s) => [s.sceneId, s.source]));
}

/** Replaces the staged sources with exactly these (a bundle then holds only them). */
export function stageSources(items: { hash: string; source: string }[]): void {
  mkdirSync(STAGE_DIR, { recursive: true });
  for (const f of readdirSync(STAGE_DIR)) if (f.endsWith(".tsx")) rmSync(join(STAGE_DIR, f), { force: true });
  for (const { hash, source } of items) writeFileSync(join(STAGE_DIR, `${hash}.tsx`), source);
}

/** Stages every live shot of a project; returns scene id → hash. */
export function stageProject(id: string, sceneIds?: ReadonlySet<string>): Record<string, string> {
  const live = liveShots(id, sceneIds);
  stageSources(live.map((s) => ({ hash: s.source, source: readSource(id, s.source) })));
  return Object.fromEntries(live.map((s) => [s.sceneId, s.source]));
}

export function nextShotId(file: CustomShotsFile): string {
  const n = file.shots.reduce((m, s) => Math.max(m, Number(s.id.slice(1))), 0);
  return `C${n + 1}`;
}

export * from "./shot-lint";

/**
 * Records a check on a shot. A failed check puts the library scene back: the
 * shot's status becomes `failed`, its reason is stored and one line goes to
 * custom/log.jsonl. A passing check of a live shot changes nothing but the record.
 */
export function recordCheck(id: string, shotId: string, check: ShotCheck): CustomShot {
  const file = readShots(id);
  const shot = file.shots.find((s) => s.id === shotId);
  if (!shot) throw new Error(`there is no custom shot ${shotId} in ${id}`);
  const at = new Date().toISOString();
  shot.check = check;
  shot.updatedAt = at;
  if (check.ok) {
    shot.history.push({ at, event: "rechecked", detail: "passed" });
    appendLog(id, { shot: shot.id, scene: shot.sceneId, event: "rechecked", message: "passed" });
  } else {
    const failure = check.failure ?? { kind: "other" as const, message: "failed" };
    shot.reason = `${failure.kind}: ${failure.message}`;
    if (LIVE_STATUSES.includes(shot.status) || shot.status === "failed") shot.status = "failed";
    shot.history.push({ at, event: "failed", detail: shot.reason });
    appendLog(id, { shot: shot.id, scene: shot.sceneId, event: "fallback", kind: failure.kind, message: `the library scene ${shot.sceneId} is drawn instead: ${failure.message}` });
  }
  writeShots(id, file);
  return shot;
}

/** A hash of the shots a render draws (scene → source), "" when there are none: part of what makes Render and Export out of date. */
export function customShotsHash(id: string): string {
  const live = Object.entries(customHashes(id)).sort(([a], [b]) => (a < b ? -1 : 1));
  return live.length ? createHash("sha256").update(live.map(([scene, hash]) => `${scene}:${hash}`).join("|")).digest("hex").slice(0, 16) : "";
}
