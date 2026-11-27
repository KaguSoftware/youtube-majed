import { VoiceFile, ValidationError, formatIssues, type Result } from "@studio/schema";
import type { z } from "zod";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Node-side project layout (docs/PLAN.md section 10), shared by the voice CLI and the Remotion scripts. */

export const REPO_DIR = resolve(fileURLToPath(import.meta.url), "../../../..");

/** projects/ (gitignored). STUDIO_PROJECTS_DIR moves it, so tests never touch real projects. */
export function projectsDir(): string {
  return process.env.STUDIO_PROJECTS_DIR ?? join(REPO_DIR, "projects");
}

export type ProjectPaths = {
  id: string;
  /** projects/<id>/, gitignored */
  dir: string;
  /** projects/<id>/audio/: takes, narration.wav, voice.json */
  audioDir: string;
  voiceJson: string;
  narration: string;
  /** retakes the user asked for, kept so a later full run does not undo them */
  overrides: string;
  /** where script.json is read from: projects/<id>/ once the story engine writes it, else the sample */
  scriptJson: string;
  /** remotion/public/projects/<id>/, where Remotion serves the audio from */
  publicDir: string;
};

export function projectPaths(id: string): ProjectPaths {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) throw new Error(`"${id}" is not a project id (letters, digits, - and _)`);
  const dir = join(projectsDir(), id);
  const audioDir = join(dir, "audio");
  const own = join(dir, "script.json");
  return {
    id,
    dir,
    audioDir,
    voiceJson: join(audioDir, "voice.json"),
    narration: join(audioDir, "narration.wav"),
    overrides: join(audioDir, "overrides.json"),
    scriptJson: existsSync(own) ? own : join(REPO_DIR, "remotion", "samples", id, "script.json"),
    publicDir: join(REPO_DIR, "remotion", "public", "projects", id),
  };
}

/**
 * Makes the voiced audio loadable by Remotion without putting it in git:
 * voice.json and the narration track are copied into
 * remotion/public/projects/<id>/ (gitignored). Copies, not symlinks: Remotion's
 * static file server answers 404 for symlinked files. Cheap (a few MB) and
 * re-run by `pnpm voice` and `pnpm render`, so the copies are never stale.
 */
export function syncAudio(id: string): void {
  const p = projectPaths(id);
  mkdirSync(p.publicDir, { recursive: true });
  for (const source of [p.voiceJson, p.narration]) {
    if (!existsSync(source)) continue;
    const dest = join(p.publicDir, basename(source));
    rmSync(dest, { force: true }); // also removes a leftover symlink from earlier versions
    copyFileSync(source, dest);
  }
}

/** Reads and validates projects/<id>/audio/voice.json. `undefined` data when the project has not been voiced. */
export function readVoice(id: string): Result<VoiceFile> | undefined {
  const { voiceJson } = projectPaths(id);
  if (!existsSync(voiceJson)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(voiceJson, "utf8"));
  } catch (e) {
    return { ok: false, errors: [`voice.json is not valid JSON: ${(e as Error).message}`] };
  }
  const r = VoiceFile.safeParse(raw);
  return r.success ? { ok: true, data: r.data } : { ok: false, errors: formatIssues("voice.json", raw, r.error.issues) };
}

export { ValidationError };

// ---------------------------------------------------------------- story engine files (Phase 2)

export type StoryPaths = {
  dir: string;
  brief: string;
  /** master loop options (step output) */
  options: string;
  pick: string;
  loopmap: string;
  /** the working script the editor edits */
  narration: string;
  comments: string;
  reviewHistory: string;
  /** raw fact-check / critic outputs per round */
  reviewDir: string;
  /** finished steps and their input hashes */
  steps: string;
  /** one JSON line per `claude -p` call */
  usage: string;
  /** prompt and raw CLI result of every call, for tracing */
  runsDir: string;
  /** the locked script, in the voice step's format */
  scriptJson: string;
};

export function storyPaths(id: string): StoryPaths {
  const { dir } = projectPaths(id);
  const story = join(dir, "story");
  return {
    dir,
    brief: join(dir, "brief.json"),
    options: join(story, "options.json"),
    pick: join(story, "pick.json"),
    loopmap: join(story, "loopmap.json"),
    narration: join(story, "narration.json"),
    comments: join(dir, "review", "comments.json"),
    reviewHistory: join(dir, "review", "history.json"),
    reviewDir: join(dir, "review"),
    steps: join(dir, "steps.json"),
    usage: join(dir, "usage.jsonl"),
    runsDir: join(dir, "runs"),
    scriptJson: join(dir, "script.json"),
  };
}

export const ENGINE_DIR = join(REPO_DIR, "engine");

/** Reads a JSON file and validates it. `undefined` when the file does not exist; throws ValidationError when it is wrong. */
export function readJson<S extends z.ZodType>(file: string, schema: S): z.output<S> | undefined {
  if (!existsSync(file)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new ValidationError(file, [`not valid JSON: ${(e as Error).message}`]);
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new ValidationError(file, formatIssues(basename(file), raw, r.error.issues));
  return r.data;
}

/** Writes JSON atomically (temp file + rename), so a crash never leaves half a file. */
export function writeJson(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, file);
}
