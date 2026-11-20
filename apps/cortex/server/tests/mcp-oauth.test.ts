// Run: bun run repo test apps/cortex/server/tests/mcp-oauth.test.ts
//
// MCP OAuth sign-in in the Tools Lab (api/mcp-oauth.ts over services/mcp-oauth.ts): the routes drive
// the framework's real mcpLogin / mcpAuthStatus / mcpLogout / listMcpLogins against the tools
// package's oauth-mcp fixture (loopback only) with a memory token store. The browser is simulated by
// following the fixture's real 302 chain onto the framework's loopback listener.
import { afterEach, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { Database } from "bun:sqlite";
import { Effect } from "effect";
import { createMemoryTokenStore, mcpLogin, type MCPTokenStore } from "@reactive-agents/tools";
import { applySchema } from "../db/schema.js";
import { insertMcpServer, recordMcpCheck } from "../db/mcp-queries.js";
import { mcpOAuthRouter } from "../api/mcp-oauth.js";
import { mcpServersRouter } from "../api/mcp-servers.js";
import { frameworkMcpOAuth, makeMcpSignIns, oauthTargetOf, type McpOAuthApi } from "../services/mcp-oauth.js";
import { AUTH_REQUIRED_PREFIX, authRequiredLine, isAuthRequiredText, isMcpAuthRequired } from "../services/mcp-auth-required.js";
import { defaultMcpProbeDeps } from "../services/mcp-probe.js";
/** The slice of the tools package's oauth-mcp fixture these tests use. */
interface OAuthMcpFixture {
  readonly resourceUrl: string;
  readonly requests: ReadonlyArray<{ readonly path: string }>;
  close(): Promise<void>;
}
// Loaded by a computed path so the Cortex typecheck (exactOptionalPropertyTypes) does not compile
// the tools package's test fixture under Cortex's settings.
const FIXTURE_PATH = ["..", "..", "..", "..", "packages", "tools", "tests", "fixtures", "oauth-mcp", "fixture.ts"].join("/");
const { startOAuthMcpFixture } = (await import(FIXTURE_PATH)) as { startOAuthMcpFixture: () => Promise<OAuthMcpFixture> };

let fixtures: OAuthMcpFixture[] = [];
let servers: Array<{ stop: (force: boolean) => void }> = [];
afterEach(async () => {
  await Promise.all(fixtures.map((f) => f.close()));
  for (const s of servers) s.stop(true);
  fixtures = [];
  servers = [];
});

async function fixture(): Promise<OAuthMcpFixture> {
  const f = await startOAuthMcpFixture();
  fixtures.push(f);
  return f;
}

/** The browser: follow the authorization URL's redirects onto the loopback listener. */
async function driveRedirect(url: string | URL): Promise<void> {
  const res = await fetch(url);
  await res.text().catch(() => undefined);
}

function makeApp(opts: { store?: MCPTokenStore; allowLocalAuth?: boolean; api?: McpOAuthApi } = {}) {
  const db = new Database(":memory:");
  applySchema(db);
  const store = opts.store ?? createMemoryTokenStore();
  const api = opts.api ?? frameworkMcpOAuth(store);
  const app = new Elysia()
    .use(mcpServersRouter(db, { ...defaultMcpProbeDeps, timeoutMs: 8_000 }))
    .use(mcpOAuthRouter(db, { api, allowLocalAuth: opts.allowLocalAuth ?? true }));
  const call = async (method: string, path: string): Promise<{ status: number; text: string; json: Record<string, unknown> }> => {
    const res = await app.handle(new Request(`http://localhost${path}`, { method }));
    const text = await res.text();
    return { status: res.status, text, json: text === "" ? {} : (JSON.parse(text) as Record<string, unknown>) };
  };
  return { db, store, call };
}

/** Every token value the store holds, to assert none leaves the server. */
async function tokenValues(store: MCPTokenStore): Promise<string[]> {
  const out: string[] = [];
  for (const key of await store.list()) {
    const rec = await store.get(key);
    if (rec?.tokens?.access_token) out.push(rec.tokens.access_token);
    if (rec?.tokens?.refresh_token) out.push(rec.tokens.refresh_token);
  }
  return out;
}

async function waitFor<T>(read: () => Promise<T>, done: (v: T) => boolean, ms = 8_000): Promise<T> {
  const until = Date.now() + ms;
  let v = await read();
  while (!done(v) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 25));
    v = await read();
  }
  return v;
}

describe("MCP OAuth routes", () => {
  it("sign in returns the authorization URL, status turns signed-in after the redirect, sign out removes it; no token value in any response", async () => {
    const f = await fixture();
    const { db, store, call } = makeApp();
    insertMcpServer(db, "s1", { name: "docs", transport: "streamable-http", endpoint: f.resourceUrl });

    const before = await call("GET", "/api/mcp-servers/s1/oauth");
    expect(before.status).toBe(200);
    expect(before.json.state).toBe("absent");

    const start = await call("POST", "/api/mcp-servers/s1/oauth/login");
    expect(start.status).toBe(200);
    expect(start.json.status).toBe("pending");
    const url = String(start.json.authorizationUrl);
    expect(new URL(url).pathname).toBe("/authorize");

    const pending = await call("GET", "/api/mcp-servers/s1/oauth");
    expect((pending.json.signIn as Record<string, unknown>).phase).toBe("pending");

    await driveRedirect(url);
    const after = await waitFor(() => call("GET", "/api/mcp-servers/s1/oauth"), (r) => r.json.state === "signed-in");
    expect(after.json.state).toBe("signed-in");
    expect(after.json.hasRefreshToken).toBe(true);
    expect(after.json.signIn).toBeUndefined();

    const list = await call("GET", "/api/mcp-logins");
    expect((list.json.servers as Record<string, Record<string, unknown>>).s1?.state).toBe("signed-in");
    expect(list.json.unused).toEqual([]);

    const secrets = await tokenValues(store);
    expect(secrets.length).toBeGreaterThan(0);
    for (const text of [start.text, pending.text, after.text, list.text]) {
      for (const secret of secrets) expect(text.includes(secret)).toBe(false);
    }

    const out = await call("POST", "/api/mcp-servers/s1/oauth/logout");
    expect(out.status).toBe(200);
    expect(out.json.removed).toBe(true);
    for (const secret of secrets) expect(out.text.includes(secret)).toBe(false);
    expect((await call("GET", "/api/mcp-servers/s1/oauth")).json.state).toBe("absent");
    expect(await store.list()).toEqual([]);
  });

  it("a login made outside Cortex (rax mcp login) is listed as unused, then hidden once a server with that URL is saved", async () => {
    const f = await fixture();
    const { db, store, call } = makeApp();
    await Effect.runPromise(mcpLogin(f.resourceUrl, { store, name: "docs", timeoutMs: 10_000, onAuthorizationUrl: driveRedirect }));

    const listed = await call("GET", "/api/mcp-logins");
    const unused = listed.json.unused as Array<Record<string, unknown>>;
    expect(unused).toHaveLength(1);
    expect(unused[0]).toMatchObject({ url: f.resourceUrl, name: "docs", transport: "streamable-http", status: "signed-in" });
    for (const secret of await tokenValues(store)) expect(listed.text.includes(secret)).toBe(false);

    insertMcpServer(db, "s1", { name: "docs", transport: "streamable-http", endpoint: f.resourceUrl });
    const after = await call("GET", "/api/mcp-logins");
    expect(after.json.unused).toEqual([]);
    expect((after.json.servers as Record<string, Record<string, unknown>>).s1?.state).toBe("signed-in");
  });

  it("two sign-in clicks join one flow (same authorization URL); cancel ends it", async () => {
    const f = await fixture();
    const { db, call } = makeApp();
    insertMcpServer(db, "s1", { name: "docs", transport: "streamable-http", endpoint: f.resourceUrl });
    const [a, b] = await Promise.all([call("POST", "/api/mcp-servers/s1/oauth/login"), call("POST", "/api/mcp-servers/s1/oauth/login")]);
    expect(a.json.authorizationUrl).toBe(b.json.authorizationUrl);
    expect(f.requests.filter((r) => r.path === "/register").length).toBe(1);

    const cancelled = await call("POST", "/api/mcp-servers/s1/oauth/cancel");
    expect(cancelled.json.cancelled).toBe(true);
    const state = await call("GET", "/api/mcp-servers/s1/oauth");
    expect(state.json.signIn).toBeUndefined();
    expect(state.json.state).toBe("absent");
  });

  it("refuses: 403 off-loopback without a token, 400 for a stdio server, 404 for an unknown one", async () => {
    const f = await fixture();
    const refused = makeApp({ allowLocalAuth: false });
    insertMcpServer(refused.db, "s1", { name: "docs", transport: "streamable-http", endpoint: f.resourceUrl });
    for (const path of ["login", "logout", "cancel"]) {
      expect((await refused.call("POST", `/api/mcp-servers/s1/oauth/${path}`)).status).toBe(403);
    }
    expect(f.requests.length).toBe(0);

    const { db, call } = makeApp();
    insertMcpServer(db, "stdio", { name: "fs", transport: "stdio", command: "npx", args: ["x"] });
    expect((await call("POST", "/api/mcp-servers/stdio/oauth/login")).status).toBe(400);
    expect((await call("GET", "/api/mcp-servers/stdio/oauth")).status).toBe(400);
    expect((await call("POST", "/api/mcp-servers/nope/oauth/login")).status).toBe(404);
    expect((await call("GET", "/api/mcp-servers/nope/oauth")).status).toBe(404);
    // A stdio server is not in the sign-in map.
    expect((await call("GET", "/api/mcp-logins")).json.servers).toEqual({});
  });

  it("Test on a server that answers 401 reports authRequired; the sign-in state then says sign-in required", async () => {
    const srv = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("unauthorized", { status: 401 }) });
    servers.push(srv);
    const { db, call } = makeApp();
    insertMcpServer(db, "s1", { name: "locked", transport: "streamable-http", endpoint: `http://127.0.0.1:${srv.port}/mcp` });
    const test = await call("POST", "/api/mcp-servers/s1/test");
    expect(test.json.ok).toBe(false);
    expect(test.json.authRequired).toBe(true);
    expect(String(test.json.error).startsWith(AUTH_REQUIRED_PREFIX)).toBe(true);
    const refresh = await call("POST", "/api/mcp-servers/s1/refresh-tools");
    expect(refresh.status).toBe(502);
    expect(refresh.json.authRequired).toBe(true);
    expect((await call("GET", "/api/mcp-servers/s1/oauth")).json.authRequired).toBe(true);
  });

  it("a stored failure that is not an auth refusal does not ask for sign-in", async () => {
    const f = await fixture();
    const { db, call } = makeApp();
    insertMcpServer(db, "s1", { name: "docs", transport: "streamable-http", endpoint: f.resourceUrl });
    recordMcpCheck(db, "s1", { status: "error", error: "connect ECONNREFUSED" });
    expect((await call("GET", "/api/mcp-servers/s1/oauth")).json.authRequired).toBe(false);
  });
});

describe("sign-in flows (services/mcp-oauth.ts)", () => {
  it("an authorization server that never hands over a URL fails within the wait", async () => {
    const api: McpOAuthApi = { ...frameworkMcpOAuth(createMemoryTokenStore()), login: () => Effect.never };
    const flows = makeMcpSignIns(api, { urlWaitMs: 40 });
    const target = oauthTargetOf({ name: "x", transport: "streamable-http", endpoint: "http://127.0.0.1:1/mcp" });
    if (!target) throw new Error("target");
    const out = await flows.start("s1", target);
    expect(out.status).toBe("failed");
    expect(flows.stateOf("s1")?.phase).toBe("failed");
  });

  it("oauthTargetOf: HTTP servers only; an Authorization header or a machine grant opts out; saved authorization_code options carry over", () => {
    expect(oauthTargetOf({ name: "a", transport: "stdio", command: "x" })).toBeNull();
    expect(oauthTargetOf({ name: "a", transport: "streamable-http", endpoint: "https://m.example/mcp", headers: { authorization: "Bearer x" } })).toBeNull();
    expect(
      oauthTargetOf({ name: "a", transport: "streamable-http", endpoint: "https://m.example/mcp", auth: { type: "client_credentials", clientId: "c", clientSecret: "s" } }),
    ).toBeNull();
    const t = oauthTargetOf({
      name: "a",
      transport: "sse",
      endpoint: "https://m.example/sse",
      auth: { type: "authorization_code", clientId: "cid", scope: "read write", redirectPort: 8765 },
    });
    expect(t?.options).toMatchObject({ name: "a", transport: "sse", clientId: "cid", scopes: ["read", "write"], redirectPort: 8765 });
  });
});

describe("isMcpAuthRequired", () => {
  it("reads the error chain: UnauthorizedError, code 401, the rax mcp login hint; not other failures", () => {
    const wrap = (cause: unknown) => ({ _tag: "MCPConnectionError", message: "Streamable HTTP error: Error POSTing to endpoint:", cause });
    expect(isMcpAuthRequired(wrap(Object.assign(new Error("x"), { name: "UnauthorizedError" })))).toBe(true);
    expect(isMcpAuthRequired(wrap(Object.assign(new Error("x"), { code: 401 })))).toBe(true);
    expect(isMcpAuthRequired(new Error('MCP server "docs" needs a login: run `rax mcp login docs`'))).toBe(true);
    expect(isMcpAuthRequired(wrap(Object.assign(new Error("x"), { code: 500 })))).toBe(false);
    expect(isMcpAuthRequired(new Error("connect ECONNREFUSED"))).toBe(false);
    expect(isAuthRequiredText(authRequiredLine("detail"))).toBe(true);
    expect(isAuthRequiredText("Failed")).toBe(false);
  });
});
