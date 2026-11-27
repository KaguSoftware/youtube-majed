import { projectPaths } from "@studio/project";
import { validateProject, type Project, type Result } from "@studio/schema";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REMOTION_DIR = resolve(fileURLToPath(import.meta.url), "../..");
export const REPO_DIR = resolve(REMOTION_DIR, "..");

/** A sample id ("lighthouse") or a path to a folder holding scenes.json, script.json, timing.json. */
export function sampleDir(arg: string): string {
  const asSample = join(REMOTION_DIR, "samples", arg);
  return existsSync(asSample) ? asSample : resolve(arg);
}

function readFile(path: string, label: string): unknown {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { __invalidJson: `${label} is not valid JSON: ${(e as Error).message}` };
  }
}

/**
 * Loads a sample. voice.json comes from projects/<id>/audio/ (written by
 * `pnpm voice <id>`); when it is there, it decides timing and timing.json is
 * not needed. Without it, timing.json is required.
 */
export function loadProject(dir: string): Result<Project> {
  const id = basename(dir);
  const voiceFile = projectPaths(id).voiceJson;
  const files = {
    scenes: [join(dir, "scenes.json"), "scenes.json"],
    script: [join(dir, "script.json"), "script.json"],
    timing: [join(dir, "timing.json"), "timing.json"],
    voice: [voiceFile, "voice.json"],
  } as const;
  const raw = Object.fromEntries(Object.entries(files).map(([k, [path, label]]) => [k, readFile(path, label)]));
  const invalid = Object.values(raw).flatMap((v) => (typeof v === "object" && v && "__invalidJson" in v ? [String(v.__invalidJson)] : []));
  const missing = (["scenes", "script"] as const).filter((k) => raw[k] === undefined).map((k) => `${k}.json is missing in ${dir}`);
  if (raw.timing === undefined && raw.voice === undefined) missing.push(`neither timing.json nor a voice.json (run \`pnpm voice ${id}\`) in ${dir}`);
  const broken = [...missing, ...invalid];
  return broken.length ? { ok: false, errors: broken } : validateProject({ scenes: raw.scenes, script: raw.script, timing: raw.timing, voice: raw.voice });
}
