/**
 * Custom shots (docs/PLAN.md section 6) against the fake claude: the import rule, the typecheck, the shot drawn alone
 * in both frames, the fallback for every kind of failure, the verdicts, and the render segments' keys. The checks run
 * the real checker (a Remotion bundle and a browser, ~10 s each), so these tests take a while; each failure kind that
 * needs the browser is one test.
 */
import { customHashes, customPaths, lintShot, liveShots, readLog, readShots } from "@studio/project";
import { LIVE_STATUSES } from "@studio/schema";
import { planSegments } from "@studio/remotion/src/scene/segments";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { acceptShot, addShot, autoShots, readProject, regenerateShot, rejectShot, ShotError, suggest } from "./custom-shots";
import { editable } from "./test-edit-fixture";
import { useFakeClaude } from "./test-env";

const env = useFakeClaude();
const SEC = 1000;
let id = "";
let scene = "";

beforeAll(async () => {
  id = await editable(env);
  scene = suggest(id, 1)[0]?.scene ?? readProject(id).scenes.scenes.find((s) => s.lineIds.length)!.id;
}, 120 * SEC);
afterEach(() => {
  delete process.env.FAKE_CLAUDE_SHOT;
  delete process.env.STUDIO_SHOT_TIMEOUT_S;
});

/** A scene with no shot yet (a failed shot keeps its scene id in the manifest, so each test gets a fresh one). */
const free = (k = 0): string => {
  const used = new Set(readShots(id).shots.map((x) => x.sceneId));
  return readProject(id).scenes.scenes.map((x) => x.id).filter((x) => !used.has(x))[k]!;
};

describe("the import rule", () => {
  const ok = `import { AbsoluteFill } from "remotion";\nimport { INK, useShot, type ShotProps } from "../kit";\nexport default function Shot(_p: ShotProps) { useShot(); return <AbsoluteFill style={{ background: INK }} />; }`;
  const cases: [string, string, RegExp][] = [
    ["node:fs", ok.replace("import { INK", 'import fs from "node:fs";\nimport { INK'), /node:fs/],
    ["a package", ok.replace("import { INK", 'import _ from "lodash";\nimport { INK'), /lodash/],
    ["a library file outside the kit", ok.replace('"../kit"', '"../../scene/SceneView"'), /outside the library/],
    ["remotion's staticFile", ok.replace("{ AbsoluteFill }", "{ AbsoluteFill, staticFile }"), /staticFile/],
    ["remotion as a namespace", ok.replace("{ AbsoluteFill }", "* as R"), /namespace/],
    ["fetch", ok.replace("useShot();", 'useShot(); fetch("x");'), /fetch/],
    ["a URL", ok.replace("useShot();", 'useShot(); const u = "https://x.test/a.png";'), /URL/],
    ["an <img>", ok.replace("return <AbsoluteFill style={{ background: INK }} />;", 'return <AbsoluteFill style={{ background: INK }}><img src="a" /></AbsoluteFill>;'), /<img>/],
    ["Math.random", ok.replace("useShot();", "useShot(); const r = Math.random();"), /Math\.random/],
    ["Date", ok.replace("useShot();", "useShot(); const t = Date.now();"), /Date/],
    ["dynamic import", ok.replace("useShot();", 'useShot(); import("x");'), /dynamic import/],
    ["window", ok.replace("useShot();", "useShot(); window.alert(1);"), /window/],
    ["a missing default export", ok.replace("export default function", "export function"), /default export/],
  ];
  it.each(cases)("rejects %s", (_name, source, why) => {
    const r = lintShot(source);
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(why);
  });
  it("accepts the kit, remotion and react, a local `top`, and the SVG namespace", () => {
    const r = lintShot(ok.replace("useShot();", 'useShot(); const top = 3; const ns = "http://www.w3.org/2000/svg";'));
    expect(r.errors).toEqual([]);
    expect(r.imports).toContain("../kit");
  });
  it("is not fooled by a banned word in a comment or a string that is not a URL", () => {
    expect(lintShot(ok.replace("useShot();", 'useShot(); /* fetch window Date */ const s = "window of opportunity";')).ok).toBe(true);
  });
  it("warns when the shot ignores the words", () => {
    const r = lintShot(`import { AbsoluteFill } from "remotion";\nexport default function Shot() { return <AbsoluteFill />; }`);
    expect(r.ok).toBe(true);
    expect(r.warnings.join()).toMatch(/word timing/);
  });
});

describe("the skill and the kit", () => {
  it("document the same exports", () => {
    const root = resolve(fileURLToPath(import.meta.url), "../../..");
    const kit = readFileSync(join(root, "remotion/src/custom/kit.ts"), "utf8");
    const skill = readFileSync(join(root, "engine/.claude/skills/custom-shot/SKILL.md"), "utf8");
    const exported = new Set<string>();
    for (const m of kit.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}/g)) for (const n of m[1]!.split(",")) exported.add(n.trim().replace(/^type\s+/, ""));
    for (const m of kit.matchAll(/export const (\w+)/g)) exported.add(m[1]!);
    const table = skill.slice(skill.indexOf("## The kit"), skill.indexOf("`ShotProps`:"));
    const documented = new Set([...table.matchAll(/`(?:type )?([A-Za-z_][A-Za-z0-9_]*)(?:\(|`|,| )/g)].map((m) => m[1]!));
    // the props types are described under the table (ShotProps) and in the Actor and LibraryScene rows
    for (const t of ["ActorProps", "LibrarySceneProps"]) documented.add(t);
    for (const name of exported) expect(documented.has(name), `${name} is exported by kit.ts but missing from the skill's kit table`).toBe(true);
    for (const name of ["W", "H", "FPS", "INK", "LibraryScene", "Actor", "wordFrame"]) expect(exported.has(name)).toBe(true);
  });
});

describe("writing and checking a shot", () => {
  it("a good shot is verified: drawn alone in both frames, stills kept, nothing in the scene JSON", async () => {
    const before = readFileSync(join(resolve(customPaths(id).dir, ".."), "storyboard", "scenes.json"), "utf8");
    const r = await addShot(id, { scene, note: "light it up" });
    expect(r.calls).toBe(1);
    expect(r.shot.status).toBe("verified");
    expect(r.shot.check?.ok).toBe(true);
    expect(r.shot.check!.stills.landscape.length).toBeGreaterThanOrEqual(5);
    expect(r.shot.check!.stills.portrait.length).toBe(r.shot.check!.stills.landscape.length);
    for (const f of [...r.shot.check!.stills.landscape, ...r.shot.check!.stills.portrait]) expect(existsSync(join(customPaths(id).stillsDir, f))).toBe(true);
    expect(r.shot.timing.length).toBeGreaterThan(0);
    expect(liveShots(id).map((s) => s.id)).toEqual([r.shot.id]);
    expect(readFileSync(join(resolve(customPaths(id).dir, ".."), "storyboard", "scenes.json"), "utf8")).toBe(before);
    expect(readLog(id).some((l) => l.shot === r.shot.id && l.event === "verified")).toBe(true);
    // the call is in the usage log under its own step
    expect(env.calls().filter((c) => c.step === "custom-shot").length).toBe(1);
  }, 180 * SEC);

  it("an import-rule failure never reaches the renderer: the library scene is drawn, and the reason is logged", async () => {
    process.env.FAKE_CLAUDE_SHOT = "imports";
    const sc = free(2);
    const r = await addShot(id, { scene: sc });
    expect(r.shot.status).toBe("failed");
    expect(r.shot.reason).toMatch(/^import_rule: .*node:fs/);
    expect(r.repaired).toBe(true); // one repair call, same flaw
    expect(liveShots(id).some((s) => s.sceneId === sc)).toBe(false);
    expect(customHashes(id)[sc]).toBeUndefined();
    const line = readLog(id).find((l) => l.shot === r.shot.id && l.event === "fallback");
    expect(line?.kind).toBe("import_rule");
    expect(line?.message).toMatch(new RegExp(`library scene ${sc}`));
  }, 180 * SEC);

  it("a flawed first answer is fixed by the validator's retry, with one Claude call counted", async () => {
    process.env.FAKE_CLAUDE_SHOT = "imports-once";
    env.reset();
    const sc = free(3);
    const r = await addShot(id, { scene: sc });
    expect(r.shot.status).toBe("verified");
    const calls = env.calls().filter((c) => c.step === "custom-shot");
    expect(calls.length).toBe(2);
    expect(calls[1]!.isRetry).toBe(true);
  }, 180 * SEC);

  it("a type error, a crash and blank frames each fall back with their own reason", async () => {
    for (const [flaw, kind] of [["types", "typecheck"], ["crash", "crash"], ["blank", "blank"]] as const) {
      process.env.FAKE_CLAUDE_SHOT = flaw;
      const r = await addShot(id, { scene: free(2), repair: false });
      expect(r.shot.status, flaw).toBe("failed");
      expect(r.shot.reason.startsWith(`${kind}:`), r.shot.reason).toBe(true);
      expect(readLog(id).find((l) => l.shot === r.shot.id)?.kind).toBe(kind);
    }
  }, 300 * SEC);

  it("a shot that never draws is stopped at the time limit and falls back", async () => {
    process.env.FAKE_CLAUDE_SHOT = "hang";
    process.env.STUDIO_SHOT_TIMEOUT_S = "40";
    const sc = free(2);
    const started = Date.now();
    const r = await addShot(id, { scene: sc, repair: false });
    expect(r.shot.status).toBe("failed");
    expect(r.shot.reason).toMatch(/^timeout:/);
    expect(Date.now() - started).toBeLessThan(90 * SEC);
  }, 180 * SEC);

  it("at most three shots are live, and only one per scene", async () => {
    const live = () => readShots(id).shots.filter((s) => LIVE_STATUSES.includes(s.status));
    const first = live()[0]!;
    await expect(addShot(id, { scene: first.sceneId })).rejects.toThrow(ShotError);
    while (live().length < 3) await addShot(id, { scene: free(2) });
    expect(live().length).toBe(3);
    await expect(addShot(id, { scene: free(2) })).rejects.toThrow(/limit/);
  }, 300 * SEC);
});

describe("verdicts", () => {
  it("reject reverts to the library scene, accept brings it back, and regenerate keeps a good shot when the new one fails", async () => {
    const shot = readShots(id).shots.find((s) => LIVE_STATUSES.includes(s.status))!;
    const was = shot.source;
    rejectShot(id, shot.id, "not this one");
    expect(readShots(id).shots.find((s) => s.id === shot.id)!.status).toBe("rejected");
    expect(customHashes(id)[shot.sceneId]).toBeUndefined();
    expect(acceptShot(id, shot.id).status).toBe("accepted");
    expect(customHashes(id)[shot.sceneId]).toBe(was);

    process.env.FAKE_CLAUDE_SHOT = "crash";
    const r = await regenerateShot(id, shot.id, "make it slower");
    expect(r.kept).toBe(true);
    const after = readShots(id).shots.find((s) => s.id === shot.id)!;
    expect(after.status).toBe("accepted");
    expect(after.source).toBe(was);
    expect(after.history.at(-1)!.detail).toMatch(/make it slower/);

    delete process.env.FAKE_CLAUDE_SHOT;
    const ok = await regenerateShot(id, shot.id, "make it slower");
    expect(ok.kept).toBeUndefined();
    expect(ok.shot.status).toBe("verified");
    expect(ok.shot.note).toBe("make it slower");
    expect(ok.shot.history.some((h) => h.event === "regenerated")).toBe(true);
    // the previous source is still on disk: nothing is overwritten
    expect(existsSync(join(customPaths(id).srcDir, `${was}.tsx`))).toBe(true);
  }, 300 * SEC);

  it("a failed shot cannot be accepted", () => {
    const failed = readShots(id).shots.find((s) => s.status === "failed")!;
    expect(() => acceptShot(id, failed.id)).toThrow(/failed its checks/);
  });

  it("auto fills only the free slots", async () => {
    expect(await autoShots(id)).toEqual([]);
  });
});

describe("render segments", () => {
  it("only the scenes with a shot (and a scene whose outro runs under one) get another key", () => {
    const project = readProject(id);
    const profile = { width: 1280, height: 720, crf: 26, preset: "veryfast", jpegQuality: 90, pixelFormat: "yuv420p", codec: "h264" } as const;
    const base = planSegments(project, { code: "c", profile });
    const sc = project.scenes.scenes[Math.min(20, project.scenes.scenes.length - 2)]!.id;
    const withShot = planSegments(project, { code: "c", profile, custom: { [sc]: "aaaaaaaaaaaaaaaa" } });
    const changed = base.segments.filter((s, i) => s.key !== withShot.segments[i]!.key).map((s) => s.sceneId);
    expect(changed).toContain(sc);
    expect(changed.length).toBeLessThanOrEqual(2); // the scene, and the next one only while this one's tail runs under its transition
    const other = planSegments(project, { code: "c", profile, custom: { [sc]: "bbbbbbbbbbbbbbbb" } });
    expect(other.segments.find((s) => s.sceneId === sc)!.key).not.toBe(withShot.segments.find((s) => s.sceneId === sc)!.key);
    // a source that did not change keeps its key
    expect(planSegments(project, { code: "c", profile, custom: { [sc]: "aaaaaaaaaaaaaaaa" } }).segments.map((s) => s.key)).toEqual(withShot.segments.map((s) => s.key));
  });
});

