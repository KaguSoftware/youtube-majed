import { VoiceFile, ValidationError, formatIssues, type Result } from "@studio/schema";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Node-side project layout (docs/PLAN.md section 10), shared by the voice CLI and the Remotion scripts. */

export const REPO_DIR = resolve(fileURLToPath(import.meta.url), "../../../..");

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
  const dir = join(REPO_DIR, "projects", id);
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
