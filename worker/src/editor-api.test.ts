import type { AddressInfo } from "node:net";
import { validateProject } from "@studio/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { editable } from "./test-edit-fixture";
import { useFakeClaude } from "./test-env";

const env = useFakeClaude();
const { server } = await import("./server");
let base = "";

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

async function get<T = Record<string, unknown>>(path: string): Promise<{ status: number; data: T }> {
  const res = await fetch(base + path);
  return { status: res.status, data: (await res.json()) as T };
}

describe("editor API", () => {
  it("serves the live draft as Remotion reads it, with the timeline", async () => {
    const id = await editable(env);
    const { status, data } = await get<{ format: string; head: number | null; project: { scenes: unknown; script: unknown; voice: unknown }; audio: unknown; timeline: { scenes: { id: string }[]; frames: number } }>(`/projects/${id}/editor`);
    expect(status).toBe(200);
    expect(data.format).toBe("reel");
    const check = validateProject(data.project);
    expect(check.ok).toBe(true);
    expect(data.timeline.scenes.length).toBe(check.ok ? check.data.scenes.scenes.length : -1);
    expect(data.timeline.frames).toBeGreaterThan(0);
    expect(data.audio).toBeNull(); // the fixture has no audio
  });

  it("answers options for a scene, refuses a bad scene id, and 404s an unknown project", async () => {
    const id = await editable(env);
    expect((await get(`/projects/${id}/editor/options?scene=S1`)).data).toEqual({ options: null });
    expect((await get(`/projects/${id}/editor/options?scene=nope`)).status).toBe(400);
    expect((await get(`/projects/no-such-project/editor`)).status).toBe(404);
  });

  it("lists SFX tags (empty without an asset index) and 404s an unknown asset", async () => {
    const { status, data } = await get<{ sfx: unknown[] }>(`/editor/sfx`);
    expect(status).toBe(200);
    expect(Array.isArray(data.sfx)).toBe(true);
    expect((await get(`/editor/sfx/audio?asset=nope/nothing`)).status).toBe(404);
  });

  it("leaves every other route to the server", async () => {
    expect((await get(`/health`)).status).toBe(200);
  });
});
