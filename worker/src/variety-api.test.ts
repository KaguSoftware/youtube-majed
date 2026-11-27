import { projectPaths, storyboardPaths, writeJson } from "@studio/project";
import { VarietyAllFile, VarietyReport } from "@studio/schema";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { useFakeClaude } from "./test-env";
import { varietyRoutes } from "./variety-api";

useFakeClaude();
beforeEach(() => {
  process.env.STUDIO_PROJECTS_DIR = mkdtempSync(join(tmpdir(), "studio-variety-api-"));
});

function make(id: string, at: string, bg: string) {
  const scenes = [0, 1, 2].map((i) => ({ id: `S${i + 1}`, lineIds: [`L1.${i + 1}`], bg, grade: "night", camera: "slow_push", transitionIn: "cut", caption: "word_pop", chars: [{ id: "a", action: "think" }], overlays: [] }));
  writeJson(storyboardPaths(id).scenes, { version: 1, title: id, cast: {}, scenes });
  writeJson(storyboardPaths(id).report, { version: 1, createdAt: at, music: [], reveals: [] });
}
const call = (path: string) => {
  const url = new URL(path, "http://localhost");
  for (const [method, pattern, handler] of varietyRoutes()) {
    const m = pattern.exec(url.pathname);
    if (method === "GET" && m) return handler({ url }, m.slice(1)) as Promise<unknown> | unknown;
  }
  throw new Error(`no route ${path}`);
};

describe("variety routes", () => {
  it("serves one project's report with its storyboard file, and all of them", async () => {
    make("a", "2026-01-01T00:00:00.000Z", "office");
    make("b", "2026-01-02T00:00:00.000Z", "office");
    const one = (await call("/projects/b/variety")) as { report: unknown; storyboard: unknown };
    expect(VarietyReport.parse(one.report).against).toEqual(["a"]);
    expect(one.storyboard).toBeNull();
    expect(VarietyAllFile.parse(await call("/variety?against=2")).reports.map((r) => r.project)).toEqual(["a", "b"]);
  });

  it("answers a project without a storyboard with a null report, an unknown one with 404, and refuses a bad window", async () => {
    writeJson(join(projectPaths("bare").dir, "brief.json"), { version: 1 });
    expect(await call("/projects/bare/variety")).toEqual({ report: null, storyboard: null });
    expect(() => call("/projects/missing/variety")).toThrowError(/no project/);
    expect(() => call("/variety?against=9")).toThrowError(/against is 1 to 6/);
  });
});
