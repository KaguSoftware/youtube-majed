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
 *
 * `track: "mix"` (Phase 3) plays the mixed soundtrack from `pnpm mix` instead
 * of the bare narration: mix.wav is copied too, and the copied voice.json's
 * `track.file` points at it. Word timings are unchanged (the mix is laid on the
 * narration's timeline), so nothing in Remotion needs to know.
 */
export function syncAudio(id: string, o: { track?: "narration" | "mix" } = {}): void {
  const p = projectPaths(id);
  mkdirSync(p.publicDir, { recursive: true });
  for (const source of [p.voiceJson, p.narration]) {
    if (!existsSync(source)) continue;
    const dest = join(p.publicDir, basename(source));
    rmSync(dest, { force: true }); // also removes a leftover symlink from earlier versions
    copyFileSync(source, dest);
  }
  const mix = join(p.audioDir, "mix.wav");
  if (o.track === "mix") {
    if (!existsSync(mix)) throw new Error(`${id} has no mix yet: run \`pnpm mix ${id}\``);
    copyFileSync(mix, join(p.publicDir, "mix.wav"));
    const voice = JSON.parse(readFileSync(p.voiceJson, "utf8")) as { track: { file: string } };
    voice.track.file = "mix.wav";
    writeFileSync(join(p.publicDir, "voice.json"), JSON.stringify(voice, null, 2) + "\n");
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

// ---------------------------------------------------------------- storyboard and mix (Phase 3)

export const ASSETS_DIR = join(REPO_DIR, "assets");
/** The asset index (category, mood, length, loudness, loop points, licence), built by `pnpm assets index`. */
export const ASSET_INDEX = join(ASSETS_DIR, "index.sqlite");

export type StoryboardPaths = {
  dir: string;
  /** the scene file Remotion renders (SceneFile) */
  scenes: string;
  /** music moods, reveals, flags, variety-guard hits, stats (StoryboardFile) */
  report: string;
  /** Claude's raw drafts per call, with the input hash they answer (a rerun reuses them) */
  drafts: string;
  /** the mix plan: every cue, its file, time and gain (MixPlan) */
  mixPlan: string;
  /** the mixed soundtrack Remotion plays */
  mix: string;
  /** mixed tracks by plan hash, so an unchanged plan is never mixed twice */
  mixCache: string;
};

export function storyboardPaths(id: string): StoryboardPaths {
  const { dir, audioDir } = projectPaths(id);
  const sb = join(dir, "storyboard");
  return {
    dir: sb,
    scenes: join(sb, "scenes.json"),
    report: join(sb, "storyboard.json"),
    drafts: join(sb, "drafts"),
    mixPlan: join(audioDir, "mixplan.json"),
    mix: join(audioDir, "mix.wav"),
    mixCache: join(audioDir, "mix"),
  };
}
