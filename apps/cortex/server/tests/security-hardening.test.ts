// Run: bun test apps/cortex/server/tests/security-hardening.test.ts --timeout 15000
// Pins the 2026-11 security hardening: access token, cross-site GET wall, outbound URL
// validation, write-only MCP credentials, tool-playground approval, private storage, ingest cap.
import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { Layer } from "effect";
import { CortexEventBridgeLive } from "../services/event-bridge.js";
import { CortexIngestServiceLive } from "../services/ingest-service.js";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { resolveWorkspaceFile } from "../services/workspace-files.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModelsRouter, type ModelsDeps } from "../api/models.js";
import { mcpServersRouter } from "../api/mcp-servers.js";
import { ollamaSettingsRouter } from "../api/ollama-settings.js";
import { toolsRouter } from "../api/tools.js";
import { voiceRouter } from "../api/voice.js";
import { createSpeechSupervisor, execDockerRunner } from "../services/voice/speech-supervisor.js";
import { applySchema, openDatabase } from "../db/schema.js";
import { checkOutboundUrl, isBlockedAddress, noRedirect, type HostResolver } from "../outbound-url.js";
import { bindRefusal, guardConfigFromEnv, guardRequest, presentedToken, tokensEqual } from "../request-guard.js";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { OllamaEndpointStore } from "../services/ollama-cloud.js";
import { ProviderKeyStore } from "../services/provider-key-store.js";
import { MCP_SECRET_MASK, maskMcpConfig, restoreMaskedMcpConfig } from "../services/mcp-secrets.js";
import { VoiceSettingsStore } from "../services/voice/voice-settings.js";
import { handleIngestMessage, INGEST_MAX_BYTES } from "../ws/ingest.js";
import { isBlockedAudioHost } from "../services/voice/openai-compatible.js";

const TOKEN = "s3cret-token-value";
const withToken = guardConfigFromEnv({ CORTEX_TOKEN: ` ${TOKEN} ` });
const none = guardConfigFromEnv({});
const get = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { headers: { host: "localhost:4321", ...headers } });
const metadataDns: HostResolver = async (h) => (h === "rebind.example" ? ["169.254.169.254"] : ["93.184.216.34"]);

describe("access token", () => {
  it("is read from CORTEX_TOKEN (trimmed) and absent otherwise", () => {
    expect(withToken.token).toBe(TOKEN);
    expect(none.token).toBeUndefined();
    expect(guardConfigFromEnv({ CORTEX_TOKEN: "   " }).token).toBeUndefined();
  });

  it("loopback without a token needs no login", () => {
    expect(guardRequest(get("http://127.0.0.1:4321/api/health"), none)).toBeUndefined();
  });

  it("with a token, /api and /ws answer 401 without it and pass with a bearer, a cookie, or (ws only) ?token=", () => {
    expect(guardRequest(get("http://127.0.0.1:4321/api/health"), withToken)?.status).toBe(401);
    expect(guardRequest(get("http://127.0.0.1:4321/ws/ingest"), withToken)?.status).toBe(401);
    expect(guardRequest(get("http://127.0.0.1:4321/api/health", { authorization: "Bearer wrong" }), withToken)?.status).toBe(401);
    expect(guardRequest(get("http://127.0.0.1:4321/api/health", { authorization: `Bearer ${TOKEN}` }), withToken)).toBeUndefined();
    expect(guardRequest(get("http://127.0.0.1:4321/api/health", { cookie: `a=b; cortex_token=${encodeURIComponent(TOKEN)}` }), withToken)).toBeUndefined();
    expect(guardRequest(get(`http://127.0.0.1:4321/ws/live/a?token=${TOKEN}`), withToken)).toBeUndefined();
    // the query form is for sockets only: a REST URL with ?token= is still refused
    expect(guardRequest(get(`http://127.0.0.1:4321/api/health?token=${TOKEN}`), withToken)?.status).toBe(401);
    expect(presentedToken(get(`http://127.0.0.1:4321/api/x?token=${TOKEN}`))).toBeUndefined();
  });

  it("the Host / Origin wall still applies first", () => {
    const r = guardRequest(get("http://127.0.0.1:4321/api/health", { host: "evil.example", authorization: `Bearer ${TOKEN}` }), withToken);
    expect(r?.status).toBe(403);
  });

  it("GET /?token=<token> sets an HttpOnly SameSite=Strict cookie and redirects without it; a wrong token does nothing", () => {
    const ok = guardRequest(get(`http://127.0.0.1:4321/lab?token=${TOKEN}&x=1`), withToken);
    expect(ok?.status).toBe(302);
    expect(ok?.headers.get("location")).toBe("/lab?x=1");
    const cookie = ok?.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`cortex_token=${encodeURIComponent(TOKEN)}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(guardRequest(get("http://127.0.0.1:4321/lab?token=nope"), withToken)).toBeUndefined();
    expect(guardRequest(get(`http://127.0.0.1:4321/lab?token=${TOKEN}`), none)).toBeUndefined();
  });

  it("compares in constant time over digests", () => {
    expect(tokensEqual("a", "a")).toBe(true);
    expect(tokensEqual("a", "ab")).toBe(false);
  });
});

describe("non-loopback bind", () => {
  it("is refused without a token and allowed with one; loopback is always allowed", () => {
    expect(bindRefusal("0.0.0.0", undefined)).toContain("CORTEX_TOKEN");
    expect(bindRefusal("192.168.1.5", "")).toContain("CORTEX_TOKEN");
    expect(bindRefusal("0.0.0.0", TOKEN)).toBeUndefined();
    expect(bindRefusal("127.0.0.1", undefined)).toBeUndefined();
    expect(bindRefusal("localhost", undefined)).toBeUndefined();
    expect(bindRefusal("::1", undefined)).toBeUndefined();
  });

  it("startCortexServer rejects before opening anything", async () => {
    const prev = process.env.CORTEX_TOKEN;
    delete process.env.CORTEX_TOKEN;
    const dir = mkdtempSync(join(tmpdir(), "cortex-refuse-"));
    try {
      const { startCortexServer } = await import("../index.js");
      await expect(startCortexServer({ port: 0, hostname: "0.0.0.0", dbPath: join(dir, "cortex.db"), openBrowser: false })).rejects.toThrow(/CORTEX_TOKEN/);
      expect(existsSync(join(dir, "cortex.db"))).toBe(false);
    } finally {
      if (prev !== undefined) process.env.CORTEX_TOKEN = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a running server with a token answers 401 without it and 200 with the bearer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-token-"));
    const { startCortexServer } = await import("../index.js");
    const server = await startCortexServer({ port: 0, token: TOKEN, dbPath: join(dir, "cortex.db"), openBrowser: false });
    try {
      const url = `http://127.0.0.1:${server.port}/api/health`;
      expect((await fetch(url)).status).toBe(401);
      expect((await fetch(url, { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(200);
    } finally {
      await server.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("cross-site requests", () => {
  it("refuses Sec-Fetch-Site: cross-site on /api and /ws even with no Origin (an <img> or <script> GET)", () => {
    expect(guardRequest(get("http://127.0.0.1:4321/api/models/ollama?endpoint=http://x", { "sec-fetch-site": "cross-site" }), none)?.status).toBe(403);
    expect(guardRequest(get("http://127.0.0.1:4321/ws/live/a", { "sec-fetch-site": "cross-site" }), none)?.status).toBe(403);
  });

  it("lets same-origin, same-site and header-less (curl, reporters) requests through", () => {
    for (const v of ["same-origin", "same-site", "none"]) expect(guardRequest(get("http://127.0.0.1:4321/api/health", { "sec-fetch-site": v }), none)).toBeUndefined();
    expect(guardRequest(get("http://127.0.0.1:4321/api/health"), none)).toBeUndefined();
  });
});

describe("outbound URL validation", () => {
  it("blocks link-local and metadata literals in every spelling the URL parser folds", () => {
    for (const h of ["169.254.169.254", "metadata.google.internal", "fe80::1", "[fe80::1]", "::ffff:a9fe:a9fe"]) expect(isBlockedAddress(h)).toBe(true);
    for (const h of ["127.0.0.1", "192.168.1.5", "10.0.0.2", "ollama.com", "localhost"]) expect(isBlockedAddress(h)).toBe(false);
    expect(isBlockedAudioHost("169.254.169.254")).toBe(true);
  });

  it("refuses non-http schemes, credentials and metadata hosts, and a name that resolves to one", async () => {
    expect((await checkOutboundUrl("file:///etc/passwd", metadataDns)).ok).toBe(false);
    expect((await checkOutboundUrl("http://user:pw@example.com", metadataDns)).ok).toBe(false);
    expect((await checkOutboundUrl("http://169.254.169.254/latest", metadataDns)).ok).toBe(false);
    expect((await checkOutboundUrl("http://0xa9fea9fe/", metadataDns)).ok).toBe(false);
    const rebind = await checkOutboundUrl("http://rebind.example:11434", metadataDns);
    expect(rebind.ok).toBe(false);
    expect(rebind.ok ? "" : rebind.reason).toContain("resolves");
  });

  it("allows loopback, LAN and public hosts (a local desk talks to them)", async () => {
    for (const u of ["http://localhost:11434", "http://127.0.0.1:11434", "http://192.168.1.20:11434", "https://ollama.com", "http://gpu-box.example:8000/v1"]) {
      expect((await checkOutboundUrl(u, metadataDns)).ok).toBe(true);
    }
  });

  it("noRedirect forces redirect: manual", async () => {
    let seen: RequestInit | undefined;
    const base = Object.assign(async (_i: Parameters<typeof fetch>[0], init?: RequestInit) => ((seen = init), new Response("{}")), {}) as unknown as typeof fetch;
    await noRedirect(base)("http://x.example", { method: "POST" });
    expect(seen?.redirect).toBe("manual");
    expect(seen?.method).toBe("POST");
  });
});

describe("Ollama endpoint reaches the network only after validation", () => {
  const deps = (calls: string[]): ModelsDeps => ({
    resolve: async () => ({ models: [], live: true }),
    fetch: (async (u: Parameters<typeof fetch>[0]) => (calls.push(String(u)), new Response("{}"))) as typeof fetch,
    resolveHost: metadataDns,
    storedKeys: { forAgent: () => undefined, has: () => false },
  });

  it("GET /api/models/ollama?endpoint=<metadata> is 400 and nothing is fetched", async () => {
    const calls: string[] = [];
    const app = new Elysia().use(createModelsRouter(deps(calls)));
    for (const ep of ["http://169.254.169.254", "http://rebind.example:11434", "file:///etc/passwd", "http://u:p@10.0.0.1"]) {
      const res = await app.handle(new Request(`http://localhost/api/models/ollama?endpoint=${encodeURIComponent(ep)}`));
      expect(res.status).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it("a loopback or LAN endpoint still lists models", async () => {
    const app = new Elysia().use(createModelsRouter(deps([])));
    for (const ep of ["http://localhost:11434", "192.168.1.20:11434"]) {
      const res = await app.handle(new Request(`http://localhost/api/models/ollama?endpoint=${encodeURIComponent(ep)}`));
      expect(res.status).toBe(200);
    }
  });

  it("PUT /api/settings/ollama refuses a metadata endpoint and saves a good one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-ollama-"));
    try {
      const store = new OllamaEndpointStore(dir);
      const app = new Elysia().use(ollamaSettingsRouter(store, metadataDns));
      const put = (endpoint: string) =>
        app.handle(new Request("http://localhost/api/settings/ollama", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint }) }));
      expect((await put("http://169.254.169.254")).status).toBe(400);
      expect((await put("http://rebind.example:11434")).status).toBe(400);
      expect(store.get()).toBeUndefined();
      expect((await put("http://192.168.1.20:11434")).status).toBe(200);
      expect(store.get()).toBe("http://192.168.1.20:11434");
      await app.handle(new Request("http://localhost/api/settings/ollama", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: null }) }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("PUT /api/voice/settings refuses a base URL that resolves to a metadata address", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-voice-"));
    try {
      const store = new VoiceSettingsStore(dir);
      const app = new Elysia().use(voiceRouter({ settings: store, keys: new ProviderKeyStore({ dir }), resolveHost: metadataDns, supervisor: createSpeechSupervisor({ settings: store, docker: execDockerRunner }), allowDocker: true }));
      const put = (baseUrl: string) =>
        app.handle(new Request("http://localhost/api/voice/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ stt: { baseUrl } }) }));
      const bad = await put("http://rebind.example:8000/v1");
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as { field: string }).field).toBe("stt.baseUrl");
      expect((await put("http://localhost:8000/v1")).status).toBe(200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("voice calls never follow a redirect and never echo the upstream body", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-voice2-"));
    try {
      const seen: (RequestInit | undefined)[] = [];
      const fetchStub = (async (_u: Parameters<typeof fetch>[0], init?: RequestInit) => {
        seen.push(init);
        return new Response("INTERNAL-SECRET-PAGE", { status: 500 });
      }) as typeof fetch;
      const settings = new VoiceSettingsStore(dir);
      const app = new Elysia().use(voiceRouter({ settings, keys: new ProviderKeyStore({ dir }), fetch: fetchStub, resolveHost: metadataDns, supervisor: createSpeechSupervisor({ settings, docker: execDockerRunner }), allowDocker: true }));
      await app.handle(new Request("http://localhost/api/voice/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ tts: { engine: "server", baseUrl: "http://localhost:8000/v1" } }) }));
      const res = await app.handle(new Request("http://localhost/api/voice/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "Hi." }) }));
      expect(res.status).toBe(502);
      expect(await res.text()).not.toContain("INTERNAL-SECRET-PAGE");
      expect(seen[0]?.redirect).toBe("manual");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("MCP credentials are write-only", () => {
  const stored = {
    name: "svc",
    transport: "streamable-http" as const,
    endpoint: "https://mcp.example/mcp",
    headers: { Authorization: "Bearer REAL-TOKEN", "X-Trace": "t" },
    env: { API_KEY: "REAL-KEY" },
    auth: { type: "client_credentials" as const, clientId: "cid", clientSecret: "REAL-SECRET" },
  };

  it("maskMcpConfig hides env values, header values and OAuth secrets but keeps names and ids", () => {
    const m = maskMcpConfig(stored);
    expect(JSON.stringify(m)).not.toContain("REAL");
    expect(m.headers).toEqual({ Authorization: MCP_SECRET_MASK, "X-Trace": MCP_SECRET_MASK });
    expect(m.env).toEqual({ API_KEY: MCP_SECRET_MASK });
    expect(m.auth).toEqual({ type: "client_credentials", clientId: "cid", clientSecret: MCP_SECRET_MASK });
    expect(m.endpoint).toBe(stored.endpoint);
  });

  it("restoreMaskedMcpConfig keeps stored values for masks, takes edits, drops unbacked masks", () => {
    const edited = { ...maskMcpConfig(stored), env: { API_KEY: MCP_SECRET_MASK, NEW: "fresh", GHOST: MCP_SECRET_MASK }, headers: { Authorization: "Bearer ROTATED" } };
    const out = restoreMaskedMcpConfig(edited, stored);
    expect(out.env).toEqual({ API_KEY: "REAL-KEY", NEW: "fresh" });
    expect(out.headers).toEqual({ Authorization: "Bearer ROTATED" });
    expect(out.auth).toEqual({ type: "client_credentials", clientId: "cid", clientSecret: "REAL-SECRET" });
  });

  it("GET masks, PATCH with the masked body keeps the stored secret, and the db holds the real one", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const app = new Elysia().use(mcpServersRouter(db));
    const json = { "content-type": "application/json" };
    const made = await app.handle(new Request("http://localhost/api/mcp-servers", { method: "POST", headers: json, body: JSON.stringify(stored) }));
    const { serverId } = (await made.json()) as { serverId: string };
    const list = (await (await app.handle(new Request("http://localhost/api/mcp-servers"))).json()) as { config: Record<string, unknown> }[];
    expect(JSON.stringify(list)).not.toContain("REAL");
    const masked = list[0]!.config;
    const patched = await app.handle(new Request(`http://localhost/api/mcp-servers/${serverId}`, { method: "PATCH", headers: json, body: JSON.stringify({ ...masked, endpoint: "https://mcp.example/v2/mcp" }) }));
    expect(patched.status).toBe(200);
    const row = db.prepare("SELECT config_json FROM cortex_mcp_servers WHERE server_id = ?").get(serverId) as { config_json: string };
    const saved = JSON.parse(row.config_json) as { endpoint: string; headers: Record<string, string>; env: Record<string, string>; auth: { clientSecret: string } };
    expect(saved.endpoint).toBe("https://mcp.example/v2/mcp");
    expect(saved.headers.Authorization).toBe("Bearer REAL-TOKEN");
    expect(saved.env.API_KEY).toBe("REAL-KEY");
    expect(saved.auth.clientSecret).toBe("REAL-SECRET");
  });

  it("a JSON import of a masked config by the same name keeps the stored credentials", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const app = new Elysia().use(mcpServersRouter(db));
    const json = { "content-type": "application/json" };
    await app.handle(new Request("http://localhost/api/mcp-servers", { method: "POST", headers: json, body: JSON.stringify(stored) }));
    await app.handle(new Request("http://localhost/api/mcp-servers/import-json", { method: "POST", headers: json, body: JSON.stringify({ json: JSON.stringify(maskMcpConfig(stored)) }) }));
    const row = db.prepare("SELECT config_json FROM cortex_mcp_servers WHERE name = 'svc'").get() as { config_json: string };
    expect(row.config_json).toContain("REAL-TOKEN");
    expect(row.config_json).not.toContain(MCP_SECRET_MASK);
  });
});

describe("tool playground approval", () => {
  const makeApp = () => {
    const db = new Database(":memory:");
    applySchema(db);
    return new Elysia().use(toolsRouter(CortexStoreServiceLive(db), db));
  };
  const invoke = (app: ReturnType<typeof makeApp>, body: Record<string, unknown>) =>
    app.handle(new Request("http://localhost/api/tools/invoke", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

  it("code-execute, file-write and file-edit answer 409 until approved: true, and run nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-gate-"));
    const target = join(dir, "pwned.txt");
    try {
      const app = makeApp();
      for (const [toolId, args] of [
        ["bi:code-execute", { code: "console.log(1)" }],
        ["bi:file-write", { path: target, content: "x" }],
        ["bi:file-edit", { path: target, oldString: "a", newString: "b" }],
      ] as const) {
        const res = await invoke(app, { toolId, arguments: args });
        expect(res.status).toBe(409);
        expect(((await res.json()) as { approvalRequired?: boolean }).approvalRequired).toBe(true);
      }
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("approved: true lets the call through the gate", async () => {
    const res = await invoke(makeApp(), { toolId: "bi:code-execute", arguments: { code: "console.log(1)" }, approved: true });
    expect(res.status).not.toBe(409);
  });

  it("tools without requiresApproval are not gated", async () => {
    const res = await invoke(makeApp(), { toolId: "bi:web-search", arguments: {} });
    expect(res.status).not.toBe(409);
  });
});

describe("private storage", () => {
  it("creates the data dir 0700 and the database 0600 (so -wal / -shm follow)", () => {
    const root = mkdtempSync(join(tmpdir(), "cortex-perm-"));
    try {
      const dbPath = join(root, ".cortex", "cortex.db");
      const db = openDatabase(dbPath);
      db.exec("CREATE TABLE IF NOT EXISTS t (x)");
      db.exec("INSERT INTO t VALUES (1)");
      expect(statSync(join(root, ".cortex")).mode & 0o777).toBe(0o700);
      expect(statSync(dbPath).mode & 0o777).toBe(0o600);
      for (const side of [`${dbPath}-wal`, `${dbPath}-shm`]) if (existsSync(side)) expect(statSync(side).mode & 0o077).toBe(0);
      db.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("tightens an existing world-readable .cortex dir and db, but leaves a shared directory alone", () => {
    const root = mkdtempSync(join(tmpdir(), "cortex-perm2-"));
    try {
      const dbPath = join(root, ".cortex", "cortex.db");
      openDatabase(dbPath).close();
      Bun.spawnSync(["chmod", "755", join(root, ".cortex")]);
      Bun.spawnSync(["chmod", "644", dbPath]);
      openDatabase(dbPath).close();
      expect(statSync(join(root, ".cortex")).mode & 0o777).toBe(0o700);
      expect(statSync(dbPath).mode & 0o777).toBe(0o600);
      const shared = join(root, "shared");
      Bun.spawnSync(["mkdir", "-m", "755", shared]);
      openDatabase(join(shared, "x.db")).close();
      expect(statSync(shared).mode & 0o777).toBe(0o755);
      expect(statSync(join(shared, "x.db")).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("@ picker never reads Cortex secrets", () => {
  it("refuses .cortex/ files directly and through a symlink", () => {
    const root = mkdtempSync(join(tmpdir(), "cortex-tag-"));
    try {
      mkdirSync(join(root, ".cortex"));
      writeFileSync(join(root, ".cortex", "secret.key"), "k");
      writeFileSync(join(root, ".cortex", "provider-keys.json"), "{}");
      symlinkSync(join(root, ".cortex", "provider-keys.json"), join(root, "innocent.txt"));
      for (const p of [".cortex/secret.key", ".cortex/provider-keys.json", "innocent.txt"]) {
        const r = resolveWorkspaceFile(root, p);
        expect(r.ok).toBe(false);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("ingest size cap", () => {
  it("drops a valid-looking frame over INGEST_MAX_BYTES and still persists a normal one", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const layer = CortexIngestServiceLive(db).pipe(Layer.provide(CortexEventBridgeLive));
    const rows = () => (db.prepare("SELECT COUNT(*) AS c FROM cortex_events").get() as { c: number }).c;
    const frame = (pad: string) => JSON.stringify({ v: 1, agentId: "a", runId: "r", event: { _tag: "TaskCreated", taskId: "t", pad } });
    const big = frame("p".repeat(INGEST_MAX_BYTES));
    expect(Buffer.byteLength(big)).toBeGreaterThan(INGEST_MAX_BYTES);
    handleIngestMessage(null, big, layer);
    handleIngestMessage(null, Buffer.from(big), layer);
    handleIngestMessage(null, frame("ok"), layer);
    const start = Date.now();
    while (rows() < 1 && Date.now() - start < 2000) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 50));
    expect(rows()).toBe(1);
  });
});
