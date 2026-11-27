import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useFakeClaude } from "./test-env";

useFakeClaude();
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

async function api<T = Record<string, unknown>>(path: string, init?: { method?: string; body?: unknown }): Promise<{ status: number; data: T }> {
  const res = await fetch(base + path, { method: init?.method ?? (init?.body ? "POST" : "GET"), headers: { "content-type": "application/json" }, body: init?.body ? JSON.stringify(init.body) : undefined });
  return { status: res.status, data: (await res.json()) as T };
}

type Job = { id: string; status: string; error?: string; steps: Record<string, { phase: string }> };
async function settle(jobId: string): Promise<Job> {
  for (let i = 0; i < 200; i++) {
    const { data } = await api<Job[]>("/jobs");
    const job = data.find((j) => j.id === jobId)!;
    if (["done", "failed", "cancelled"].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("job did not finish");
}

describe("worker API", () => {
  it("validates input with zod", async () => {
    const r = await api<{ error: string }>("/projects", { body: { sentence: "x", narrative: "romcom", format: "youtube", minutes: 8 } });
    expect(r.status).toBe(400);
    expect(r.data.error).toMatch(/sentence/);
    expect(r.data.error).toMatch(/unknown narrative "romcom"/);
  });

  it("runs brief → options → pick → review → accept → lock as jobs, one at a time", async () => {
    const created = await api<{ brief: { id: string }; job: Job }>("/projects", { body: { sentence: "Two sisters inherit a clock that runs backwards.", narrative: "fable", format: "reel", minutes: 1.25 } });
    expect(created.status).toBe(200);
    const id = created.data.brief.id;
    expect((await settle(created.data.job.id)).status).toBe("done");

    const pick = await api<{ job: Job }>(`/projects/${id}/pick`, { body: { option: "C" } });
    const review = await api<{ job: Job }>(`/projects/${id}/review`, { body: {} }); // queued behind the pick
    const written = await settle(pick.data.job.id);
    expect(Object.keys(written.steps)).toEqual(["loopmap", "narration"]);
    expect((await settle(review.data.job.id)).status).toBe("done");

    const detail = await api<{ state: string; check: { ok: boolean }; comments: { id: string; source: string; status: string }[]; history: unknown[] }>(`/projects/${id}`);
    expect(detail.data.state).toBe("script");
    expect(detail.data.check.ok).toBe(true);
    expect(detail.data.history).toHaveLength(1);
    // the review failed (a consistency blocker), so the flagged lines came back as fixes
    const fixes = detail.data.comments.filter((c) => c.source === "rewrite");
    expect(fixes.length).toBeGreaterThan(0);

    const locked = await api(`/projects/${id}/lock`, { body: {} });
    expect(locked.status).toBe(409);
    for (const f of fixes) expect((await api(`/projects/${id}/comments/${f.id}/accept`, { body: {} })).status).toBe(200);
    const ok = await api<{ scriptJson: string }>(`/projects/${id}/lock`, { body: {} });
    expect(ok.status).toBe(200);
    expect(ok.data.scriptJson).toMatch(/script\.json$/);
    expect((await api(`/projects/${id}/rewrite`, { body: { lineIds: ["L1.1"], direction: "shorter" } })).status).toBe(409);
  });

  it("streams job progress over SSE", async () => {
    const res = await fetch(`${base}/events`);
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toMatch(/^event: hello/);
    await reader.cancel();
  });
});
