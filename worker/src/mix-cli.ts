/**
 * pnpm mix <id> [--scenes <scenes.json>] [--force]
 *
 * Plans the sound design for a storyboarded, voiced project and renders it
 * into projects/<id>/audio/mix.wav (one stereo track, −14 LUFS). An unchanged
 * plan comes from the cache; nothing is ever re-voiced.
 */
import { syncAudio } from "@studio/project";
import { AssetIndexError } from "./assets";
import { MixError, runMix } from "./mix";

const args = process.argv.slice(2);
const project = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--scenes");
const flag = (name: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
if (!project) {
  console.error("usage: pnpm mix <id> [--scenes <scenes.json>] [--force]");
  process.exit(1);
}

try {
  const started = Date.now();
  const { plan, result, cached, planFile, mix } = runMix(project, { scenes: flag("scenes"), force: args.includes("--force") });
  const count = (k: string) => plan.cues.filter((c) => c.kind === k).length;
  console.log(`${cached ? "· cached" : "✓ mixed"} ${project}: ${result.duration.toFixed(1)} s · ${result.integratedLufs} LUFS · true peak ${result.truePeakDbtp} dBTP · music ${result.musicUnderVoiceDb ?? "–"} dB under the voice · ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log(`  cues: ${count("music")} music, ${count("ambience")} ambience, ${count("sfx")} sfx, ${count("riser")} risers, ${count("hit")} hits, ${count("whoosh")} whooshes · ${plan.gates.length} drop-outs`);
  for (const w of plan.warnings) console.log(`  ! ${w}`);
  console.log(`  ${mix}\n  plan: ${planFile}`);
  syncAudio(project);
} catch (e) {
  if (e instanceof MixError || e instanceof AssetIndexError) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
  throw e;
}
