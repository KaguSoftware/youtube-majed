/**
 * Voices a project through the local audio service (audio/).
 *
 *   pnpm voice lighthouse                       # voice every line (cached lines are reused)
 *   pnpm voice lighthouse --line L3.4           # retake one line with a new random seed
 *   pnpm voice lighthouse --line L3.4 --seed 7  # ... with this seed
 *   pnpm voice lighthouse --line L3.4 --energy 5
 *   options: --reference <wav>  --url http://127.0.0.1:8765
 *
 * The work is in voice-run.ts, shared with the app's voice step.
 */
import { projectPaths } from "@studio/project";
import { VoiceError, voiceProject } from "./voice-run";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const id = process.argv[2];
if (!id || id.startsWith("--")) fail("usage: pnpm voice <project> [--line L3.4 [--seed N] [--energy N]] [--reference clip.wav]");
const num = (name: string) => (flag(name) === undefined ? undefined : Number(flag(name)));

try {
  const s = await voiceProject(id, {
    ...(flag("line") ? { line: flag("line")! } : {}),
    ...(num("seed") === undefined ? {} : { seed: num("seed")! }),
    ...(num("energy") === undefined ? {} : { energy: num("energy")! }),
    ...(flag("reference") ? { reference: flag("reference")! } : {}),
    ...(flag("url") ? { url: flag("url")! } : {}),
    log: console.log,
  });
  console.log(`  measured ${s.wpm} wpm (story budgets assume the brief's wpm, default 170)`);
  console.log(
    `\n✓ ${projectPaths(id).narration}\n  ${s.durationS.toFixed(1)} s · ${s.lufs} LUFS · ${s.truePeakDbtp} dBTP · ${s.generated} line(s) generated, ${s.reused} reused, ${s.retried} needed an automatic retake · ${s.seconds.toFixed(0)} s`,
  );
  if (s.flagged.length) {
    console.log(`\n${s.flagged.length} line(s) need a look (retake with: pnpm voice ${id} --line <id>):`);
    for (const b of s.flagged) console.log(`  - ${b.id} [${b.status}] heard "${b.heard}": ${b.issues.join("; ")}`);
  }
  process.exit(s.failed ? 2 : 0);
} catch (e) {
  if (e instanceof VoiceError) fail(e.message);
  throw e;
}
