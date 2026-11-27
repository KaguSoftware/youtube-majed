import type { z } from "zod";
import { SceneFile } from "./scene";
import { ScriptFile } from "./script";
import { TimingFile } from "./timing";
import { VoiceFile } from "./voice";

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

/**
 * `voice` (Phase 1: real word timestamps from audio/) takes precedence over
 * `timing` (Phase 0: fixed seconds per scene, kept as a fallback for samples
 * that have not been voiced). At least one of them has to be there.
 */
export type Project = { scenes: SceneFile; script: ScriptFile; timing?: TimingFile; voice?: VoiceFile };
export type RawProject = { scenes: unknown; script: unknown; timing?: unknown; voice?: unknown };

/**
 * Validates the files on their own and against each other: every scene line
 * exists in the script; with voice.json, every scene line has been voiced with
 * the script's current text and energy; without it, every scene has a
 * duration in timing.json and nothing extra.
 */
export function validateProject(raw: RawProject): Result<Project> {
  const scenes = parse(SceneFile, "scenes.json", raw.scenes);
  const script = parse(ScriptFile, "script.json", raw.script);
  const timing = raw.timing === undefined ? undefined : parse(TimingFile, "timing.json", raw.timing);
  const voice = raw.voice === undefined ? undefined : parse(VoiceFile, "voice.json", raw.voice);

  const parsed = [scenes, script, timing, voice].filter((r) => r !== undefined);
  const errors = parsed.flatMap((r) => (r.ok ? [] : r.errors));
  if (!scenes.ok || !script.ok || (timing && !timing.ok) || (voice && !voice.ok)) return { ok: false, errors };
  if (!timing && !voice) return { ok: false, errors: ["there is neither a voice.json (run `pnpm voice <project>`) nor a timing.json, so scenes have no timing"] };

  const lineIds = new Set(script.data.lines.map((l) => l.id));
  const sceneIds = new Set(scenes.data.scenes.map((s) => s.id));
  const scriptLines = new Map(script.data.lines.map((l) => [l.id, l]));
  const voiced = voice?.ok ? new Map(voice.data.lines.map((l) => [l.id, l])) : undefined;
  const retell = voice?.ok ? "re-run `pnpm voice <project>`" : "";

  for (const s of scenes.data.scenes) {
    s.lineIds.forEach((id, j) => {
      if (!lineIds.has(id)) errors.push(`scenes.json → Scene ${s.id} → lineIds[${j}]: line "${id}" is not in script.json`);
      if (voiced) {
        const v = voiced.get(id);
        const line = scriptLines.get(id);
        if (!v) errors.push(`voice.json: line "${id}" (Scene ${s.id}) has not been voiced; ${retell}`);
        else if (line && v.text !== line.text) errors.push(`voice.json: line "${id}" was voiced as "${v.text}" but script.json now says "${line.text}"; ${retell}`);
      }
    });
    if (!voiced && timing?.ok && timing.data.seconds[s.id] === undefined) errors.push(`timing.json → seconds: no duration for Scene ${s.id}`);
  }
  if (!voiced && timing?.ok) {
    for (const id of Object.keys(timing.data.seconds)) {
      if (!sceneIds.has(id)) errors.push(`timing.json → seconds.${id}: there is no Scene ${id} in scenes.json`);
    }
  }

  return errors.length
    ? { ok: false, errors }
    : { ok: true, data: { scenes: scenes.data, script: script.data, timing: timing?.ok ? timing.data : undefined, voice: voice?.ok ? voice.data : undefined } };
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
