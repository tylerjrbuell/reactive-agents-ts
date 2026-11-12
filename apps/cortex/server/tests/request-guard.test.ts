import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardConfigFromEnv, guardRequest, hostNameOf, isAllowedHost, isAllowedOrigin } from "../request-guard.js";

const none = guardConfigFromEnv({});
const req = (url: string, headers: Record<string, string>) => new Request(url, { headers });

describe("host and origin allowlist", () => {
  it("allows localhost, 127.0.0.1 and [::1] with any port", () => {
    for (const h of ["localhost:4321", "127.0.0.1:4321", "[::1]:4321", "localhost", "LOCALHOST:80"]) expect(isAllowedHost(h, none)).toBe(true);
    expect(hostNameOf("[::1]:4321")).toBe("::1");
  });

  it("rejects a rebinding Host (a DNS name that resolved to loopback)", () => {
    expect(isAllowedHost("evil.example:4321", none)).toBe(false);
    expect(isAllowedHost("localhost.evil.example", none)).toBe(false);
    expect(isAllowedHost(null, none)).toBe(false);
    expect(isAllowedHost("", none)).toBe(false);
  });

  it("allows the CORTEX_URL host and CORTEX_ALLOWED_HOSTS names, nothing else", () => {
    const cfg = guardConfigFromEnv({ CORTEX_URL: "https://cortex.team.example:8443/", CORTEX_ALLOWED_HOSTS: "desk.internal, Other.Example " });
    for (const h of ["cortex.team.example:8443", "desk.internal", "other.example"]) expect(isAllowedHost(h, cfg)).toBe(true);
    expect(isAllowedHost("evil.example", cfg)).toBe(false);
  });

  it("allows an absent Origin, a loopback Origin and a configured one; rejects foreign and opaque Origins", () => {
    expect(isAllowedOrigin(null, none)).toBe(true);
    expect(isAllowedOrigin("http://localhost:5173", none)).toBe(true);
    expect(isAllowedOrigin("http://evil.example", none)).toBe(false);
    expect(isAllowedOrigin("null", none)).toBe(false);
    expect(isAllowedOrigin("http://10.0.0.5:8000", none)).toBe(false);
    expect(isAllowedOrigin("https://desk.internal", guardConfigFromEnv({ CORTEX_ALLOWED_HOSTS: "desk.internal" }))).toBe(true);
  });

  it("answers 403 for a bad Host or Origin on /api and /ws, and lets good and unguarded requests through", () => {
    expect(guardRequest(req("http://127.0.0.1:4321/api/voice/settings", { host: "evil.example" }), none)?.status).toBe(403);
    expect(guardRequest(req("http://127.0.0.1:4321/api/voice/settings", { host: "localhost:4321", origin: "http://evil.example" }), none)?.status).toBe(403);
    expect(guardRequest(req("http://127.0.0.1:4321/ws/live/a", { host: "evil.example", upgrade: "websocket" }), none)?.status).toBe(403);
    expect(guardRequest(req("http://127.0.0.1:4321/api/voice/settings", { host: "localhost:4321", origin: "http://localhost:5173" }), none)).toBeUndefined();
    expect(guardRequest(req("http://127.0.0.1:4321/", { host: "evil.example" }), none)).toBeUndefined();
  });
});

describe("guard on the running server", () => {
  it("refuses a rebinding Host over HTTP and a foreign Origin on a WebSocket upgrade; serves localhost", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-guard-"));
    const { startCortexServer } = await import("../index.js");
    const server = await startCortexServer({ port: 0, dbPath: join(dir, "cortex.db"), openBrowser: false });
    try {
      const base = `http://127.0.0.1:${server.port}`;
      expect((await fetch(`${base}/api/workspace/recent`)).status).toBe(200);
      expect((await fetch(`${base}/api/workspace/recent`, { headers: { host: "evil.example" } })).status).toBe(403);
      expect((await fetch(`${base}/api/workspace/recent`, { headers: { origin: "http://evil.example" } })).status).toBe(403);

      const upgrade = (origin?: string) =>
        new Promise<"open" | "refused">((resolve) => {
          const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws/live/a`, origin ? { headers: { origin } } : undefined);
          ws.onopen = () => {
            ws.close();
            resolve("open");
          };
          ws.onerror = () => resolve("refused");
        });
      expect(await upgrade("http://evil.example")).toBe("refused");
      expect(await upgrade()).toBe("open");
    } finally {
      await server.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
