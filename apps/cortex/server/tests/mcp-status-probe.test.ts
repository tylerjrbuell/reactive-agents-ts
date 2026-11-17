// Run: bun run repo test apps/cortex/server/tests/mcp-status-probe.test.ts
//
// The page's background status checks reuse `POST /api/mcp-servers/:id/test` with a short `timeoutMs`:
// the cap is clamped, a timeout is a scrubbed Failed, the transport is always released, one probe per
// server runs at a time, the result is saved on the row, and no credential reaches a response.
import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.js";
import { mcpServersRouter } from "../api/mcp-servers.js";
import { getMcpServer, listCachedToolsForServer } from "../db/mcp-queries.js";
import { clampProbeTimeoutMs } from "../services/mcp-server-test.js";
import { timeoutWords, type McpProbeDeps } from "../services/mcp-probe.js";
import type { DiscoveredMcpTool } from "../services/mcp-discovery.js";

const SECRET = "sk-live-very-secret-1234";

type Handle = { handle: (req: Request) => Promise<Response> };

function setup(discover: McpProbeDeps["discover"], timeoutMs = 5_000) {
  const cleaned: string[] = [];
  const deps: McpProbeDeps = { discover, cleanup: (n) => void cleaned.push(n), timeoutMs };
  const db = new Database(":memory:");
  applySchema(db);
  const app: Handle = new Elysia().use(mcpServersRouter(db, deps));
  return { db, app, cleaned };
}

const post = (app: Handle, path: string, body?: unknown) =>
  app.handle(new Request(`http://localhost${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));

async function addServer(app: Handle): Promise<string> {
  const res = await post(app, "/api/mcp-servers", { name: "srv", transport: "streamable-http", endpoint: `https://example.com/mcp?token=${SECRET}`, env: { API_KEY: SECRET } });
  return ((await res.json()) as { serverId: string }).serverId;
}

const TOOLS: DiscoveredMcpTool[] = [{ toolName: "srv/search", description: "Search" }];

describe("background status check (POST /:id/test?timeoutMs=)", () => {
  it("clamps the requested cap between 1 second and the manual cap", () => {
    expect(clampProbeTimeoutMs(15_000)).toBe(15_000);
    expect(clampProbeTimeoutMs(5)).toBe(1_000);
    expect(clampProbeTimeoutMs(9_999_999)).toBe(600_000);
    expect(clampProbeTimeoutMs(undefined)).toBe(600_000);
    expect(clampProbeTimeoutMs(Number.NaN)).toBe(600_000);
  });

  it("words the cap in seconds or minutes", () => {
    expect(timeoutWords(15_000)).toBe("15 seconds");
    expect(timeoutWords(1_000)).toBe("1 second");
    expect(timeoutWords(600_000)).toBe("10 minutes");
  });

  it("a probe that outlives the short cap is recorded as Failed 'timed out', the transport is released and no credential leaks", async () => {
    const { db, app, cleaned } = setup(() => new Promise<DiscoveredMcpTool[]>(() => {}));
    const id = await addServer(app);
    const res = await post(app, `/api/mcp-servers/${id}/test?timeoutMs=1000`);
    const text = await res.text();
    const body = JSON.parse(text) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("MCP tool discovery timed out after 1 second");
    expect(cleaned).toContain("srv");
    expect(text).not.toContain(SECRET);
    const row = getMcpServer(db, id)!;
    expect([row.last_status, row.last_error]).toEqual(["error", "MCP tool discovery timed out after 1 second"]);
    expect(row.last_checked_at).toBeGreaterThan(0);
  });

  it("a failed probe scrubs the server's credentials from the stored and returned error", async () => {
    const { db, app } = setup(async () => {
      throw new Error(`401 for ${SECRET}`);
    });
    const id = await addServer(app);
    const text = await (await post(app, `/api/mcp-servers/${id}/test?timeoutMs=15000`)).text();
    expect(text).not.toContain(SECRET);
    expect(text).toContain("••");
    expect(getMcpServer(db, id)!.last_error).not.toContain(SECRET);
  });

  it("a good probe saves Connected on the row, releases the transport and leaves the tool cache alone", async () => {
    const { db, app, cleaned } = setup(async () => TOOLS);
    const id = await addServer(app);
    const body = (await (await post(app, `/api/mcp-servers/${id}/test?timeoutMs=15000`)).json()) as { ok: boolean; toolCount: number };
    expect(body).toMatchObject({ ok: true, toolCount: 1 });
    expect(cleaned).toEqual(["srv"]);
    expect(getMcpServer(db, id)!.last_status).toBe("ok");
    expect(listCachedToolsForServer(db, id)).toEqual([]);
  });

  it("runs one probe per server at a time: a second request joins the first", async () => {
    let calls = 0;
    let release: (t: DiscoveredMcpTool[]) => void = () => {};
    const { app } = setup(() => {
      calls += 1;
      return new Promise<DiscoveredMcpTool[]>((resolve) => {
        release = resolve;
      });
    });
    const id = await addServer(app);
    const a = post(app, `/api/mcp-servers/${id}/test?timeoutMs=15000`);
    const b = post(app, `/api/mcp-servers/${id}/test`);
    await new Promise((r) => setTimeout(r, 20));
    release(TOOLS);
    const [ra, rb] = await Promise.all([a, b]);
    expect(calls).toBe(1);
    expect(((await ra.json()) as { ok: boolean }).ok).toBe(true);
    expect(((await rb.json()) as { ok: boolean }).ok).toBe(true);
    // Once settled, the next test probes again.
    const c = post(app, `/api/mcp-servers/${id}/test`);
    await new Promise((r) => setTimeout(r, 20));
    release(TOOLS);
    await (await c).text();
    expect(calls).toBe(2);
  });

  it("different servers probe side by side", async () => {
    let active = 0;
    let peak = 0;
    const { app } = setup(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 30));
      active -= 1;
      return TOOLS;
    });
    const one = await addServer(app);
    const twoRes = await post(app, "/api/mcp-servers", { name: "srv2", transport: "streamable-http", endpoint: "https://example.com/two" });
    const two = ((await twoRes.json()) as { serverId: string }).serverId;
    await Promise.all([post(app, `/api/mcp-servers/${one}/test`), post(app, `/api/mcp-servers/${two}/test`)]);
    expect(peak).toBe(2);
  });

  it("answers 404 for an unknown server", async () => {
    const { app } = setup(async () => TOOLS);
    expect((await post(app, "/api/mcp-servers/nope/test?timeoutMs=15000")).status).toBe(404);
  });
});
