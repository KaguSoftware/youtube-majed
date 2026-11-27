import { validateProject, type Project, type Result } from "@studio/schema";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REMOTION_DIR = resolve(fileURLToPath(import.meta.url), "../..");
export const REPO_DIR = resolve(REMOTION_DIR, "..");

/** A sample id ("lighthouse") or a path to a folder holding scenes.json, script.json, timing.json. */
export function sampleDir(arg: string): string {
  const asSample = join(REMOTION_DIR, "samples", arg);
  return existsSync(asSample) ? asSample : resolve(arg);
}

function readJson(dir: string, file: string): unknown {
  const path = join(dir, file);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { __invalidJson: `${file} is not valid JSON: ${(e as Error).message}` };
  }
}

export function loadProject(dir: string): Result<Project> {
  const raw = { scenes: readJson(dir, "scenes.json"), script: readJson(dir, "script.json"), timing: readJson(dir, "timing.json") };
  const broken = Object.entries(raw).flatMap(([k, v]) =>
    v === undefined ? [`${k}.json is missing in ${dir}`] : typeof v === "object" && v && "__invalidJson" in v ? [String(v.__invalidJson)] : [],
  );
  return broken.length ? { ok: false, errors: broken } : validateProject(raw);
}
