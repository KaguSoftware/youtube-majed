/** Test setup: a throwaway projects/ folder and the fake `claude`. Never the real account or real projects. */
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FAKE_CLAUDE = resolve(fileURLToPath(import.meta.url), "../../fake/claude.mjs");

export function useFakeClaude(): { dir: string; log: string; calls: () => { step: string; argv: string[]; cwd: string; envKeys: string[]; isRetry: boolean; input: { lineIds: string[]; direction: string } & Record<string, unknown> }[]; reset: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "studio-test-"));
  const log = join(dir, "fake-claude.log");
  process.env.STUDIO_PROJECTS_DIR = join(dir, "projects");
  process.env.STUDIO_CLAUDE_BIN = FAKE_CLAUDE;
  process.env.FAKE_CLAUDE_LOG = log;
  delete process.env.FAKE_CLAUDE_MODE;
  return {
    dir,
    log,
    calls: () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []),
    reset: () => rmSync(log, { force: true }),
  };
}
