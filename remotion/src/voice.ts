import { ValidationError, VoiceFile, formatIssues } from "@studio/schema";
import { staticFile } from "remotion";

/**
 * Where a project's voiced audio is served from. `pnpm voice <project>` copies
 * projects/<id>/audio/{voice.json,narration.wav} into remotion/public/projects/<id>/
 * (gitignored), so Studio and renders can load them with staticFile().
 */
export const voiceUrl = (project: string) => staticFile(`projects/${project}/voice.json`);
export const trackUrl = (project: string, file: string) => staticFile(`projects/${project}/${file}`);

/**
 * Fetches and validates voice.json. Returns undefined when the project has not
 * been voiced (no file), so the caller can fall back to timing.json. A file
 * that exists but is broken throws, naming the problem.
 */
export async function fetchVoice(project: string): Promise<unknown | undefined> {
  const res = await fetch(voiceUrl(project));
  if (!res.ok) return undefined;
  const text = await res.text();
  if (text.trimStart().startsWith("<")) return undefined; // dev server answered with its index page: no such file
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ValidationError(`projects/${project}/voice.json`, [`not valid JSON: ${(e as Error).message}`]);
  }
  const parsed = VoiceFile.safeParse(raw);
  if (!parsed.success) throw new ValidationError(`projects/${project}/voice.json`, formatIssues("voice.json", raw, parsed.error.issues));
  return raw;
}
