import { projectPaths, storyboardPaths, writeJson } from "@studio/project";
import { SceneFile, type EditOpIn } from "@studio/schema";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { beatEdit, readOptions, regenerateScene } from "./edit-claude";
import { applyOps, EditError, remapWords, type Draft } from "./edit-ops";
import { describe as describeOps, linesToVoice, loadDraft } from "./edit";
import { useFakeClaude } from "./test-env";
import { editable } from "./test-edit-fixture";
import { commit, diffVersions, ensureVersions, listVersions, readHead, rollback, versionFile } from "./versions";

const env = useFakeClaude();

beforeEach(() => {
  env.reset();
  delete process.env.FAKE_CLAUDE_MODE;
});

const draftOf = (id: string): Draft => {
  const { voice: _v, ...d } = loadDraft(id, ensureVersions(id));
  return d;
};
const apply = (d: Draft, ops: EditOpIn[]) => applyOps(d, ops as never, { sfxTags: ["door_slam", "thunder"] });

describe("edit operations", () => {
  it("swaps scene fields with library ids only, and leaves every line alone", async () => {
    const d = draftOf(await editable(env));
    const s = d.scenes.scenes[1]!;
    const { draft } = apply(d, [{ op: "scene.set", scene: s.id, bg: "office", camera: "zoom_face", chars: [{ id: s.chars[0]!.id, action: "panic", expr: "shock" }] }]);
    const after = draft.scenes.scenes[1]!;
    expect([after.bg, after.camera, after.chars[0]!.action, after.chars[0]!.expr]).toEqual(["office", "zoom_face", "panic", "shock"]);
    expect(draft.script).toEqual(d.script);
    expect(() => apply(d, [{ op: "scene.set", scene: s.id, bg: "moon_base" } as never])).toThrow();
  });

  it("edits a line in the narration and script.json together, and only that line needs a take", async () => {
    const id = await editable(env);
    const base = loadDraft(id, ensureVersions(id));
    const line = base.script.lines[2]!;
    const { draft } = apply(base, [{ op: "line.set", line: line.id, text: "A brand new line for the voice." }]);
    expect(draft.script.lines[2]!.text).toBe("A brand new line for the voice.");
    expect(draft.narration!.loops.flatMap((l) => l.lines).find((l) => l.id === line.id)!.text).toBe("A brand new line for the voice.");
    expect(linesToVoice(draft, base.voice)).toEqual([line.id]);
  });

  it("inserts a line with its own scene, splitting the scene it lands in, and keeps scene ids", async () => {
    const d = draftOf(await editable(env));
    const host = d.scenes.scenes.find((s) => s.lineIds.length >= 1)!;
    const ids = d.scenes.scenes.map((s) => s.id);
    const { id: _id, lineIds: _l, ...body } = host;
    const { draft } = apply(d, [{ op: "insert", after: host.lineIds[0]!, line: { text: "A dog barks at him and he jumps." }, scene: { ...body, sfx: [] } }]);
    const newLine = draft.script.lines.find((l) => !d.script.lines.some((x) => x.id === l.id))!;
    expect(newLine.id.startsWith(host.lineIds[0]!.split(".")[0]!)).toBe(true);
    const shown = draft.scenes.scenes.find((s) => s.lineIds.includes(newLine.id))!;
    expect(shown.lineIds).toEqual([newLine.id]);
    expect(ids.every((x) => draft.scenes.scenes.some((s) => s.id === x))).toBe(true); // no scene renumbered
    expect(draft.scenes.scenes.flatMap((s) => s.lineIds)).toEqual(draft.script.lines.map((l) => l.id));
  });

  it("adds, moves and deletes a sound effect on a word; refuses a word past the end", async () => {
    const d = draftOf(await editable(env));
    const [l1, l2] = d.script.lines;
    let { draft } = apply(d, [{ op: "sfx.add", tag: "door_slam", at: `${l1!.id}:1` }]);
    expect(draft.scenes.scenes.flatMap((s) => s.sfx).some((x) => x.tag === "door_slam" && x.at === `${l1!.id}:1`)).toBe(true);
    ({ draft } = apply(draft, [{ op: "sfx.move", tag: "door_slam", from: `${l1!.id}:1`, to: `${l2!.id}:0` }]));
    expect(draft.scenes.scenes.find((s) => s.lineIds.includes(l2!.id))!.sfx.some((x) => x.at === `${l2!.id}:0`)).toBe(true);
    ({ draft } = apply(draft, [{ op: "sfx.delete", tag: "door_slam", at: `${l2!.id}:0` }]));
    expect(draft.scenes.scenes.flatMap((s) => s.sfx).some((x) => x.tag === "door_slam")).toBe(false);
    expect(() => apply(d, [{ op: "sfx.add", tag: "door_slam", at: `${l1!.id}:99` }])).toThrow(EditError);
  });

  it("sets and clears a voice effect on a line or one word", async () => {
    const d = draftOf(await editable(env));
    const l = d.script.lines[0]!;
    let { draft } = apply(d, [{ op: "fx", line: l.id, preset: "robot", word: 1 }, { op: "fx", line: l.id, preset: "phone_call" }]);
    expect(draft.fx.lines[l.id]).toEqual([{ preset: "robot", word: 1 }, { preset: "phone_call" }]);
    ({ draft } = apply(draft, [{ op: "fx", line: l.id, preset: "none" }]));
    expect(draft.fx.lines[l.id]).toBeUndefined();
  });

  it("trims, moves and deletes scenes; a cut takes its lines only because the operation says so", async () => {
    const d = draftOf(await editable(env));
    const scenes = d.scenes.scenes;
    // merge: picture goes, lines stay
    const { draft: merged } = apply(d, [{ op: "scene.delete", scene: scenes[2]!.id, lines: "merge" }]);
    expect(merged.script.lines.length).toBe(d.script.lines.length);
    expect(merged.scenes.scenes.length).toBe(scenes.length - 1);
    // cut: lines go too
    const { draft: cut } = apply(d, [{ op: "scene.delete", scene: scenes[2]!.id, lines: "cut" }]);
    expect(cut.script.lines.length).toBe(d.script.lines.length - scenes[2]!.lineIds.length);
    // trim: the first line of scene 2 goes to scene 1
    const two = scenes.find((s, i) => i > 0 && s.lineIds.length > 1);
    if (two) {
      const { draft: trimmed } = apply(d, [{ op: "scene.trim", scene: two.id, start: 1 }]);
      expect(trimmed.scenes.scenes.find((s) => s.id === two.id)!.lineIds).toEqual(two.lineIds.slice(1));
    }
    // move within a loop: the lines move with the scene
    const loop = scenes[0]!.lineIds[0]!.split(".")[0];
    const same = scenes.filter((s) => s.lineIds.every((l) => l.startsWith(`${loop}.`)));
    if (same.length >= 3) {
      const { draft: moved } = apply(d, [{ op: "scene.move", scene: same[0]!.id, after: same[2]!.id }]);
      expect(moved.script.lines.findIndex((l) => l.id === same[0]!.lineIds[0])).toBeGreaterThan(moved.script.lines.findIndex((l) => l.id === same[2]!.lineIds.at(-1)));
      expect(moved.scenes.scenes.flatMap((s) => s.lineIds)).toEqual(moved.script.lines.map((l) => l.id));
    }
  });

  it("refuses an edit that would break coverage, and names the operation", async () => {
    const d = draftOf(await editable(env));
    const s = d.scenes.scenes[0]!;
    expect(() => apply(d, [{ op: "scene.trim", scene: s.id, start: 1 }])).toThrow(/operation 1 \(scene.trim\)/);
  });

  it("moves word references with a rewritten line", () => {
    const map = remapWords("She has seen that blue tape.", "She has definitely seen that blue tape before.");
    expect(map(5)).toBe(6); // "tape." → "tape"
    expect(map(0)).toBe(0);
  });

  it("labels an edit from its operations", () => {
    expect(describeOps([{ op: "sfx.add", tag: "thunder", at: "L2.3:1" }])).toBe("sound thunder on L2.3:1");
  });
});

describe("versions", () => {
  it("starts from the working files, commits, diffs and rolls back without copying media", async () => {
    const id = await editable(env);
    const v1 = ensureVersions(id);
    expect(v1.n).toBe(1);
    const d = draftOf(id);
    const { draft } = apply(d, [{ op: "scene.set", scene: d.scenes.scenes[0]!.id, camera: "dolly_out" }]);
    const files = Object.fromEntries(Object.entries(v1.files).map(([f]) => [f, versionFile(id, v1, f as never)]));
    const v2 = commit(id, { kind: "edit", label: "camera", files: { ...files, "storyboard/scenes.json": draft.scenes }, media: v1.media });
    expect(v2.changes!.scenes.changed[d.scenes.scenes[0]!.id]).toEqual(["camera"]);
    expect(JSON.parse(readFileSync(storyboardPaths(id).scenes, "utf8")).scenes[0].camera).toBe("dolly_out");
    // unchanged files are stored once
    expect(v2.files["script.json"]).toBe(v1.files["script.json"]);

    const back = rollback(id, 1);
    expect(back.kind).toBe("rollback");
    expect(back.restores).toBe(1);
    expect(back.files).toEqual(v1.files);
    expect(SceneFile.parse(JSON.parse(readFileSync(storyboardPaths(id).scenes, "utf8"))).scenes[0]!.camera).toBe(d.scenes.scenes[0]!.camera);
    expect(diffVersions(id, v1, back).scenes.changed).toEqual({});
    expect(readHead(id)).toBe(3);
  });

  it("records changes made outside the editor as their own version", async () => {
    const id = await editable(env);
    ensureVersions(id);
    const scenes = JSON.parse(readFileSync(storyboardPaths(id).scenes, "utf8"));
    scenes.scenes[0].grade = scenes.scenes[0].grade === "night" ? "day" : "night";
    writeJson(storyboardPaths(id).scenes, scenes);
    const v = ensureVersions(id);
    expect(v.kind).toBe("outside");
    expect(listVersions(id).length).toBe(2);
  });
});

describe("Claude edit steps (fake claude)", () => {
  it("regenerates a scene as checked options and saves them for a pick", async () => {
    const id = await editable(env);
    const scene = draftOf(id).scenes.scenes[1]!;
    const o = await regenerateScene(id, scene.id, "more dramatic", { count: 3 });
    expect(env.calls().map((c) => c.step)).toEqual(["regenerate"]);
    expect(o.options.length).toBe(3);
    for (const x of o.options) expect(x.op.op).toBe("scene.replace");
    expect(readOptions(id, o.id)!.sceneId).toBe(scene.id);
    // usage is logged per call
    const usage = readFileSync(`${projectPaths(id).dir}/usage.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(usage.at(-1).step).toBe("regenerate");
  });

  it("turns a beat into an inserted line plus its shots, through the same checks", async () => {
    const id = await editable(env);
    const d = draftOf(id);
    const after = d.script.lines[1]!.id;
    const r = await beatEdit(id, "cut to a dog barking at him, he jumps", { after, dryRun: true });
    if (!("ops" in r)) throw new Error("expected the operations");
    expect(r.ops[0]).toMatchObject({ op: "insert", after, line: { text: "A dog barks at him and he jumps." } });
    expect(r.ops.filter((x) => x.op === "insert" && "scene" in x).length).toBeGreaterThan(0);
    const { draft } = apply(d, r.ops);
    expect(draft.scenes.scenes.flatMap((s) => s.lineIds)).toEqual(draft.script.lines.map((l) => l.id));
  });
});
