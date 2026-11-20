// Run: bun test packages/tools/tests/mcp/oauth/stored-login-connect.test.ts --timeout 30000
//
// A URL-only HTTP MCP server (no `auth`) uses a login stored for its own
// canonicalResourceKey: bearer sent, refresh works through the hardened
// provider, never sent to another URL, `auth: false` opts out. Seam pin for
// packages/tools/src/mcp/auth/stored-login.ts, wired in mcp-client.ts's
// connectHttpLike.
import { describe, it, expect, afterEach } from "bun:test";
import { Effect } from "effect";
import { makeMCPClient } from "../../../src/mcp/mcp-client.js";
import { mcpLogin, listMcpLogins } from "../../../src/mcp/auth/login.js";
import { canonicalResourceKey, createMemoryTokenStore } from "../../../src/mcp/auth/token-store.js";
import type { MCPTokenStore } from "../../../src/mcp/auth/types.js";
import { startOAuthMcpFixture } from "../../fixtures/oauth-mcp/fixture.js";

type OAuthMcpFixture = Awaited<ReturnType<typeof startOAuthMcpFixture>>;

let fixtures: OAuthMcpFixture[] = [];
let recorders: Array<{ stop: (force: boolean) => void }> = [];
afterEach(async () => {
  await Promise.all(fixtures.map((f) => f.close()));
  for (const r of recorders) r.stop(true);
  fixtures = [];
  recorders = [];
});

async function fixture(): Promise<OAuthMcpFixture> {
  const f = await startOAuthMcpFixture();
  fixtures.push(f);
  return f;
}

async function driveRedirect(url: URL): Promise<void> {
  const res = await fetch(url);
  await res.text().catch(() => {});
}

/** A loopback server that records every Authorization header it sees and answers 401. */
function startHeaderRecorder(): { base: string; seen: Array<string | null> } {
  const seen: Array<string | null> = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req) => {
      seen.push(req.headers.get("authorization"));
      return new Response(null, { status: 401 });
    },
  });
  recorders.push(server);
  return { base: `http://127.0.0.1:${server.port}`, seen };
}

const connect = (config: {
  name: string;
  endpoint: string;
  tokenStore: MCPTokenStore;
  auth?: false;
}) =>
  Effect.gen(function* () {
    const client = yield* makeMCPClient;
    return yield* client.connect({ transport: "streamable-http", ...config });
  });

const callWhoami = (name: string, endpoint: string, tokenStore: MCPTokenStore) =>
  Effect.gen(function* () {
    const client = yield* makeMCPClient;
    const server = yield* client.connect({ name, transport: "streamable-http", endpoint, tokenStore });
    expect(server.status).toBe("connected");
    return yield* client.callTool(name, "whoami", {});
  });

describe("URL-only MCP server + stored login", () => {
  it("RED-ON-CUT: connects with the login stored for its URL (no auth config)", async () => {
    const f = await fixture();
    const store = createMemoryTokenStore();
    await Effect.runPromise(mcpLogin(f.resourceUrl, { store, timeoutMs: 10_000, onAuthorizationUrl: driveRedirect }));
    const authorizeCalls = f.requests.filter((r) => r.path === "/authorize").length;

    const who = await Effect.runPromise(callWhoami("url-only", f.resourceUrl, store));
    expect(who).toBe("fixture-user");
    // No second interactive authorization.
    expect(f.requests.filter((r) => r.path === "/authorize").length).toBe(authorizeCalls);
  });

  it("refreshes an expired stored access token and keeps the login metadata", async () => {
    const f = await fixture();
    const store = createMemoryTokenStore();
    await Effect.runPromise(
      mcpLogin(f.resourceUrl, { store, name: "docs", timeoutMs: 10_000, onAuthorizationUrl: driveRedirect }),
    );
    const key = canonicalResourceKey(f.resourceUrl);
    const stored = (await store.get(key))!;
    const expired = await f.mintAccessToken({ expiresIn: -60 });
    await store.set(key, { ...stored, tokens: { ...stored.tokens!, access_token: expired } });

    const who = await Effect.runPromise(callWhoami("url-only-refresh", f.resourceUrl, store));
    expect(who).toBe("fixture-user");
    expect(f.requests.some((r) => r.path === "/token" && r.params["grant_type"] === "refresh_token")).toBe(true);
    expect((await store.get(key))!.tokens!.access_token).not.toBe(expired);

    const logins = await Effect.runPromise(listMcpLogins({ store }));
    expect(logins[0]).toMatchObject({ name: "docs", status: "signed-in" });
  });

  it("no stored login: unchanged (no provider, no authorization attempt)", async () => {
    const f = await fixture();
    const err = await Effect.runPromise(
      connect({ name: "anon", endpoint: f.resourceUrl, tokenStore: createMemoryTokenStore() }).pipe(Effect.flip),
    );
    expect(err._tag).toBe("MCPConnectionError");
    expect(f.requests.some((r) => r.path === "/authorize" || r.path === "/register" || r.path === "/token")).toBe(false);
  });

  it("sends the stored bearer only to its own URL; auth:false sends none", async () => {
    const rec = startHeaderRecorder();
    const store = createMemoryTokenStore();
    const loggedIn = `${rec.base}/mcp`;
    await store.set(canonicalResourceKey(loggedIn), {
      tokens: { access_token: "stored-access-token-123", token_type: "Bearer" },
      clientInformation: { client_id: "c" },
      resourceUrl: loggedIn,
      savedAt: Date.now(),
    });

    await Effect.runPromise(connect({ name: "other", endpoint: `${rec.base}/other`, tokenStore: store }).pipe(Effect.flip));
    expect(rec.seen.length).toBeGreaterThan(0);
    expect(rec.seen.every((h) => h === null)).toBe(true);

    rec.seen.length = 0;
    await Effect.runPromise(connect({ name: "optout", endpoint: loggedIn, tokenStore: store, auth: false }).pipe(Effect.flip));
    expect(rec.seen.length).toBeGreaterThan(0);
    expect(rec.seen.every((h) => h === null)).toBe(true);

    rec.seen.length = 0;
    await Effect.runPromise(connect({ name: "own", endpoint: loggedIn, tokenStore: store }).pipe(Effect.flip));
    expect(rec.seen[0]).toBe("Bearer stored-access-token-123");
  });
});
