import type { z } from "zod";
import { SceneFile } from "./scene";
import { ScriptFile } from "./script";
import { TimingFile } from "./timing";

export type Result<T> = { ok: true; data: T } | { ok: false; errors: string[] };

/** "chars[0].action" from ["chars", 0, "action"]. */
function pathText(path: readonly PropertyKey[]): string {
  return path.reduce<string>((out, key) => {
    if (typeof key === "number") return `${out}[${key}]`;
    return out ? `${out}.${String(key)}` : String(key);
  }, "");
}

/**
 * One readable line per problem. Anything under `scenes[i]` is reported by
 * scene id, e.g. `Scene S7 → chars[0].action: unknown action "sneek"`.
 */
export function formatIssues(file: string, raw: unknown, issues: readonly z.core.$ZodIssue[]): string[] {
  const scenes = (raw as { scenes?: unknown })?.scenes;
  return issues.map((issue) => {
    const [head, index, ...rest] = issue.path;
    if (head === "scenes" && typeof index === "number" && Array.isArray(scenes)) {
      const id = (scenes[index] as { id?: unknown } | undefined)?.id;
      const who = typeof id === "string" ? `Scene ${id}` : `Scene #${index + 1} (no id)`;
      const where = rest.length ? pathText(rest) : "(scene)";
      return `${file} → ${who} → ${where}: ${issue.message}`;
    }
    return `${file} → ${issue.path.length ? pathText(issue.path) : "(root)"}: ${issue.message}`;
  });
}

function parse<T extends z.ZodType>(schema: T, file: string, raw: unknown): Result<z.infer<T>> {
  const r = schema.safeParse(raw);
  return r.success ? { ok: true, data: r.data } : { ok: false, errors: formatIssues(file, raw, r.error.issues) };
}

export type Project = { scenes: SceneFile; script: ScriptFile; timing: TimingFile };
export type RawProject = { scenes: unknown; script: unknown; timing: unknown };

/**
 * Validates the three Phase 0 files on their own and against each other:
 * every scene line exists in the script, every scene has a duration, no
 * timing for scenes that don't exist.
 */
export function validateProject(raw: RawProject): Result<Project> {
  const scenes = parse(SceneFile, "scenes.json", raw.scenes);
  const script = parse(ScriptFile, "script.json", raw.script);
  const timing = parse(TimingFile, "timing.json", raw.timing);

  const errors = [scenes, script, timing].flatMap((r) => (r.ok ? [] : r.errors));
  if (!scenes.ok || !script.ok || !timing.ok) return { ok: false, errors };

  const lineIds = new Set(script.data.lines.map((l) => l.id));
  const sceneIds = new Set(scenes.data.scenes.map((s) => s.id));
  for (const s of scenes.data.scenes) {
    s.lineIds.forEach((id, j) => {
      if (!lineIds.has(id)) errors.push(`scenes.json → Scene ${s.id} → lineIds[${j}]: line "${id}" is not in script.json`);
    });
    if (timing.data.seconds[s.id] === undefined) errors.push(`timing.json → seconds: no duration for Scene ${s.id}`);
  }
  for (const id of Object.keys(timing.data.seconds)) {
    if (!sceneIds.has(id)) errors.push(`timing.json → seconds.${id}: there is no Scene ${id} in scenes.json`);
  }

  return errors.length ? { ok: false, errors } : { ok: true, data: { scenes: scenes.data, script: script.data, timing: timing.data } };
}

export class ValidationError extends Error {
  constructor(
    readonly label: string,
    readonly errors: string[],
  ) {
    super(`${label}: ${errors.length} problem${errors.length === 1 ? "" : "s"}\n  - ${errors.join("\n  - ")}`);
    this.name = "ValidationError";
  }
}

export function assertProject(label: string, raw: RawProject): Project {
  const r = validateProject(raw);
  if (!r.ok) throw new ValidationError(label, r.errors);
  return r.data;
}
