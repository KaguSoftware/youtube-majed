import { narrationToScript } from "@studio/schema";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useFakeClaude } from "./test-env";

const env = useFakeClaude();
const { server } = await import("./server");
let base = "";
const SAMPLE = resolve(fileURLToPath(import.meta.url), "../../../remotion/samples/lighthouse/scenes.json");

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

async function api<T = Record<string, unknown>>(path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }): Promise<{ status: number; data: T }> {
  const res = await fetch(base + path, { method: init?.method ?? (init?.body ? "POST" : "GET"), headers: { "content-type": "application/json", ...init?.headers }, body: init?.body ? JSON.stringify(init.body) : undefined });
  return { status: res.status, data: (await res.json()) as T };
}

type Stage = { key: string; status: string; stale: boolean; note: string };
type Pipeline = { stages: Stage[]; current: string };
type Job = { id: string; status: string };
async function settle(jobId: string): Promise<Job> {
  for (let i = 0; i < 200; i++) {
    const { data } = await api<Job[]>("/jobs");
    const job = data.find((j) => j.id === jobId)!;
    if (["done", "failed", "cancelled"].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("job did not finish");
}
const status = (p: Pipeline) => Object.fromEntries(p.stages.map((s) => [s.key, s.stale ? `${s.status}+stale` : s.status]));

describe("pipeline status and the phase 3 routes", () => {
  let id = "";

  it("walks a new story through the first steps with a word for each state", async () => {
    const created = await api<{ brief: { id: string }; job: Job }>("/projects", { body: { sentence: "Two sisters inherit a clock that runs backwards.", narrative: "fable", format: "reel", minutes: 1.25 } });
    id = created.data.brief.id;
    // the options job is queued or running
    expect(status((await api<Pipeline>(`/projects/${id}/pipeline`)).data).story).toBe("running");
    await settle(created.data.job.id);
    let p = (await api<Pipeline>(`/projects/${id}/pipeline`)).data;
    expect(status(p)).toMatchObject({ brief: "done", story: "needs_you", review: "waiting", script: "waiting", voice: "waiting", storyboard: "waiting", render: "waiting", editor: "waiting", export: "waiting" });
    expect(p.current).toBe("story");
    expect(p.stages.map((s) => s.key)).toEqual(["brief", "story", "review", "script", "voice", "storyboard", "render", "editor", "export"]);
    expect(p.stages.every((s) => s.note.length > 10)).toBe(true);

    await settle((await api<{ job: Job }>(`/projects/${id}/pick`, { body: { option: "C" } })).data.job.id);
    p = (await api<Pipeline>(`/projects/${id}/pipeline`)).data;
    expect(status(p)).toMatchObject({ story: "done", review: "needs_you", script: "needs_you", voice: "waiting" });
  });

  it("refuses voice, mix, render and export until their input exists", async () => {
    expect((await api<{ error: string }>(`/projects/${id}/voice`, { body: {} })).data.error).toMatch(/lock the script/);
    for (const step of ["mix", "render", "export"]) {
      const r = await api<{ error: string }>(`/projects/${id}/${step}`, { body: {} });
      expect(r.status).toBe(409);
      expect(r.data.error).toMatch(/voice the script first/);
    }
  });

  it("marks the voice out of date when a locked line's text no longer matches", async () => {
    const dir = join(env.dir, "projects", id);
    const narration = JSON.parse(readFileSync(join(dir, "story", "narration.json"), "utf8")) as { loops: { lines: { id: string; text: string }[] }[]; lockedAt?: string };
    // pretend the script was locked and voiced, then edited
    narration.lockedAt = new Date().toISOString();
    writeFileSync(join(dir, "story", "narration.json"), JSON.stringify(narration));
    writeFileSync(join(dir, "script.json"), JSON.stringify(narrationToScript(narration as never)));
    expect(status((await api<Pipeline>(`/projects/${id}/pipeline`)).data).voice).toBe("needs_you");
  });

  it("validates and saves cast edits against the scene file", async () => {
    const dir = join(env.dir, "projects", id, "storyboard");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "scenes.json"), readFileSync(SAMPLE));
    const { data } = await api<{ cast: Record<string, Record<string, unknown>> }>(`/projects/${id}/cast`);
    expect(Object.keys(data.cast)).toContain("keeper");
    const edited = { ...data.cast, keeper: { ...data.cast.keeper, color: "#00ffcc", style: "neon", hat: "beanie" } };
    const ok = await api<{ cast: Record<string, { color: string; style: string }> }>(`/projects/${id}/cast`, { method: "PUT", body: { cast: edited } });
    expect(ok.status).toBe(200);
    expect(ok.data.cast.keeper).toMatchObject({ color: "#00ffcc", style: "neon" });
    expect(JSON.parse(readFileSync(join(dir, "scenes.json"), "utf8")).cast.keeper.color).toBe("#00ffcc");

    const { keeper: _gone, ...without } = edited;
    const bad = await api<{ error: string }>(`/projects/${id}/cast`, { method: "PUT", body: { cast: without } });
    expect(bad.status).toBe(422);
    expect(bad.data.error).toMatch(/keeper/);
    const badColour = await api<{ error: string }>(`/projects/${id}/cast`, { method: "PUT", body: { cast: { ...edited, keeper: { ...edited.keeper, color: "red" } } } });
    expect(badColour.status).toBe(400);
  });

  it("serves renders with byte ranges and nothing else", async () => {
    const dir = join(env.dir, "projects", id, "renders");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "preview.mp4"), Buffer.from("0123456789"));
    const range = await fetch(`${base}/projects/${id}/file/renders/preview.mp4`, { headers: { range: "bytes=2-5" } });
    expect(range.status).toBe(206);
    expect(range.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await range.text()).toBe("2345");
    const tail = await fetch(`${base}/projects/${id}/file/renders/preview.mp4`, { headers: { range: "bytes=-3" } });
    expect(await tail.text()).toBe("789");
    const whole = await fetch(`${base}/projects/${id}/file/renders/preview.mp4`);
    expect(whole.headers.get("content-type")).toBe("video/mp4");
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    for (const bad of ["brief.json", "story/narration.json", "renders/../brief.json", "renders/..%2Fbrief.json"]) {
      expect((await fetch(`${base}/projects/${id}/file/${bad}`)).status).toBe(404);
    }
  });
});
