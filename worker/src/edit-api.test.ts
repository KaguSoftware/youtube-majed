import type { AddressInfo } from "node:net";
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

async function api<T = Record<string, unknown>>(path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(base + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: (await res.json()) as T };
}
type Job = { id: string; status: string; error?: string; result?: Record<string, unknown> };
async function settle(jobId: string): Promise<Job> {
  for (let i = 0; i < 400; i++) {
    const { data } = await api<Job[]>("/jobs");
    const job = data.find((j) => j.id === jobId)!;
    if (["done", "failed", "cancelled"].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("job did not finish");
}

describe("edit API", () => {
  it("checks an edit at once, refuses an impossible one with 409, and lists versions", async () => {
    const id = await editable(env);
    const { data: tl } = await api<{ scenes: { id: string; start: number; frames: number; drawn: { preview: boolean } }[]; frames: number }>(`/projects/${id}/timeline`);
    expect(tl.scenes.length).toBeGreaterThan(2);
    expect(tl.scenes.every((s, i) => i === 0 || s.start === tl.scenes[i - 1]!.start + tl.scenes[i - 1]!.frames)).toBe(true);
    expect(tl.scenes[0]!.drawn.preview).toBe(false);

    const ok = await api<{ voice: string[]; assemble: boolean }>(`/projects/${id}/edits/check`, { ops: [{ op: "scene.set", scene: tl.scenes[1]!.id, camera: "dolly_out" }] });
    expect(ok.status).toBe(200);
    expect(ok.data).toMatchObject({ voice: [], assemble: false });

    const bad = await api<{ error: string }>(`/projects/${id}/edits`, { ops: [{ op: "scene.trim", scene: tl.scenes[0]!.id, start: 1 }] });
    expect(bad.status).toBe(409);
    expect(bad.data.error).toMatch(/scene.trim/);
    const unknown = await api<{ error: string }>(`/projects/${id}/edits`, { ops: [{ op: "scene.set", scene: tl.scenes[0]!.id, bg: "moon_base" }] });
    expect(unknown.status).toBe(409);

    const { data } = await api<{ head: number; versions: { n: number; kind: string }[] }>(`/projects/${id}/versions`);
    expect(data.head).toBe(1);
    expect(data.versions.map((v) => v.kind)).toEqual(["start"]);
  });

  it("regenerates a scene as a job, serves the options, and rolls back as a job", async () => {
    const id = await editable(env);
    const { data: tl } = await api<{ scenes: { id: string }[] }>(`/projects/${id}/timeline`);
    const { data } = await api<{ job: Job }>(`/projects/${id}/edits/regenerate`, { scene: tl.scenes[1]!.id, note: "more tension", count: 2 });
    const done = await settle(data.job.id);
    expect(done.status).toBe("done");
    const oid = String(done.result!.id);
    const { data: o } = await api<{ options: { options: unknown[] } }>(`/projects/${id}/edits/options/${oid}`);
    expect(o.options.options.length).toBe(2);

    const r = await api<{ job: Job }>(`/projects/${id}/versions/1/rollback`, {});
    expect((await settle(r.data.job.id)).status).toBe("done");
    const { data: v } = await api<{ head: number; versions: { kind: string }[] }>(`/projects/${id}/versions`);
    expect(v.versions.map((x) => x.kind)).toEqual(["start", "rollback"]);
    expect(v.head).toBe(2);
  });
});
