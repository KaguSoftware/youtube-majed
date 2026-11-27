import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { allowedOrigin } from "./access";
import { useFakeClaude } from "./test-env";

useFakeClaude();
const { server } = await import("./server");
let port = 0;

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

/** node:http, because fetch may not let a caller set Origin and Host. */
function call(method: string, path: string, headers: Record<string, string>): Promise<{ status: number; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((done, fail) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      res.resume();
      res.on("end", () => done({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on("error", fail);
    req.end();
  });
}

describe("allowedOrigin", () => {
  it("takes the local app, the hosted app and its preview URLs", () => {
    expect(allowedOrigin("http://localhost:3100", "")).toBe(true);
    expect(allowedOrigin("https://youtube-majed.vercel.app", "")).toBe(true);
    expect(allowedOrigin("https://youtube-majed-3r916pi7g-majeds-projects-8c18cb68.vercel.app", "")).toBe(true);
    expect(allowedOrigin("https://youtube-majed-git-main-majeds-projects-8c18cb68.vercel.app", "")).toBe(true);
  });
  it("refuses other sites, look-alikes and other teams' previews", () => {
    expect(allowedOrigin("https://evil.example", "")).toBe(false);
    expect(allowedOrigin("https://youtube-majed.vercel.app.evil.example", "")).toBe(false);
    expect(allowedOrigin("https://youtube-majed-x-someone-else.vercel.app", "")).toBe(false);
    expect(allowedOrigin("http://localhost:3101", "")).toBe(false);
  });
  it("adds STUDIO_ALLOWED_ORIGINS", () => {
    expect(allowedOrigin("http://localhost:3101", "http://localhost:3101/, https://studio.example")).toBe(true);
  });
});

describe("worker access", () => {
  it("answers the hosted app with CORS headers", async () => {
    const r = await call("GET", "/projects", { origin: "https://youtube-majed.vercel.app" });
    expect(r.status).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBe("https://youtube-majed.vercel.app");
  });
  it("answers Chrome's local-network preflight", async () => {
    const r = await call("OPTIONS", "/projects", { origin: "https://youtube-majed.vercel.app", "access-control-request-method": "POST", "access-control-request-private-network": "true" });
    expect(r.status).toBe(204);
    expect(r.headers["access-control-allow-private-network"]).toBe("true");
    expect(r.headers["access-control-allow-methods"]).toMatch(/POST/);
  });
  it("refuses a foreign page", async () => {
    expect((await call("POST", "/projects", { origin: "https://evil.example", "content-type": "application/json" })).status).toBe(403);
    expect((await call("OPTIONS", "/projects", { origin: "https://evil.example" })).status).toBe(403);
  });
  it("refuses a rebound host name", async () => {
    expect((await call("GET", "/projects", { host: "evil.example:8766" })).status).toBe(403);
  });
  it("still serves the CLI and media elements, which send no Origin", async () => {
    expect((await call("GET", "/projects", {})).status).toBe(200);
  });
});
