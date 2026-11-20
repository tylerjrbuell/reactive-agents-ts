// Run: bun test packages/tools/tests/mcp/oauth/login-api.test.ts --timeout 30000
//
// Public interactive sign-in API (mcpLogin / mcpAuthStatus / mcpLogout /
// listMcpLogins) against the real oauth-mcp fixture. The browser is simulated
// by following the fixture's real 302 chain onto the loopback listener.
// `node:child_process` is mocked before any import so `openBrowser` never
// launches a real browser and the tests can count spawn calls.
import { describe, it, expect, afterEach, mock } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";

const spawnCalls: string[] = [];
mock.module("node:child_process", () => ({
  spawn: (command: string) => {
    spawnCalls.push(command);
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("spawn"));
    return child;
  },
}));

const { mcpLogin, mcpAuthStatus, mcpLogout, listMcpLogins } = await import(
  "../../../src/mcp/auth/login.js"
);
const { createMemoryTokenStore, createFileTokenStore, canonicalResourceKey } = await import(
  "../../../src/mcp/auth/token-store.js"
);
const { createAuthProvider } = await import("../../../src/mcp/auth/create-provider.js");
const { auth } = await import("@modelcontextprotocol/sdk/client/auth.js");
const { startOAuthMcpFixture } = await import("../../fixtures/oauth-mcp/fixture.js");
type OAuthMcpFixture = Awaited<ReturnType<typeof startOAuthMcpFixture>>;

let fixtures: OAuthMcpFixture[] = [];
let tempDirs: string[] = [];
async function fixture(): Promise<OAuthMcpFixture> {
  const f = await startOAuthMcpFixture();
  fixtures.push(f);
  return f;
}
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mcp-login-api-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(fixtures.map((f) => f.close()));
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  fixtures = [];
  tempDirs = [];
  spawnCalls.length = 0;
});

/** Simulates the browser: follows the fixture's real 302 chain onto the loopback listener. */
async function driveRedirect(url: URL): Promise<void> {
  const res = await fetch(url);
  await res.text().catch(() => {});
}

describe("mcpLogin / mcpAuthStatus / mcpLogout", () => {
  it("login completes when the caller drives the URL; no browser opens; result carries no token values", async () => {
    const f = await fixture();
    const store = createMemoryTokenStore();
    const urls: URL[] = [];

    const result = await Effect.runPromise(
      mcpLogin(f.resourceUrl, {
        store,
        scopes: ["whoami"],
        timeoutMs: 10_000,
        onAuthorizationUrl: async (url) => {
          urls.push(url);
          await driveRedirect(url);
        },
      }),
    );

    expect(urls).toHaveLength(1);
    expect(urls[0]!.searchParams.get("code_challenge_method")).toBe("S256");
    expect(urls[0]!.searchParams.get("state")).toBeTruthy();
    expect(new URL(urls[0]!.searchParams.get("redirect_uri")!).hostname).toBe("127.0.0.1");
    expect(spawnCalls).toHaveLength(0);

    expect(result.resourceKey).toBe(canonicalResourceKey(f.resourceUrl));
    expect(result.scopes).toEqual(["whoami"]);
    expect(result.hasRefreshToken).toBe(true);
    expect(result.expiresAt).toBeGreaterThan(Date.now());

    const stored = await store.get(result.resourceKey);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(stored!.tokens!.access_token);
    expect(serialized).not.toContain(stored!.tokens!.refresh_token!);
  });

  it("status is signed-in after login, absent after logout", async () => {
    const f = await fixture();
    const store = createMemoryTokenStore();
    await Effect.runPromise(mcpLogin(f.resourceUrl, { store, timeoutMs: 10_000, onAuthorizationUrl: driveRedirect }));

    const before = await Effect.runPromise(mcpAuthStatus(f.resourceUrl, { store }));
    expect(before.state).toBe("signed-in");
    expect(before.hasRefreshToken).toBe(true);
    expect(JSON.stringify(before)).not.toContain("access_token");

    const out = await Effect.runPromise(mcpLogout(f.resourceUrl, { store }));
    expect(out.removed).toBe(true);
    // The fixture advertises no revocation endpoint.
    expect(out.revocation).toBe("unsupported");

    const after = await Effect.runPromise(mcpAuthStatus(f.resourceUrl, { store }));
    expect(after.state).toBe("absent");
    const again = await Effect.runPromise(mcpLogout(f.resourceUrl, { store }));
    expect(again).toMatchObject({ removed: false, revocation: "none" });
  });

  it("an access token past its lifetime is reported expired", async () => {
    const store = createMemoryTokenStore();
    const endpoint = "https://mcp.example.com/mcp";
    await store.set(canonicalResourceKey(endpoint), {
      tokens: { access_token: "stale-access-token", token_type: "Bearer", expires_in: 60, scope: "a b" },
      resourceUrl: endpoint,
      savedAt: Date.now() - 120_000,
    });

    const status = await Effect.runPromise(mcpAuthStatus(endpoint, { store }));
    expect(status.state).toBe("expired");
    expect(status.scopes).toEqual(["a", "b"]);
    expect(status.hasRefreshToken).toBe(false);
    expect(JSON.stringify(status)).not.toContain("stale-access-token");
  });

  it("a callback with a mismatched state is rejected: no code exchange, login fails", async () => {
    const f = await fixture();
    f.configure({ wrongStateOnRedirect: true });
    const store = createMemoryTokenStore();

    const err = await Effect.runPromise(
      mcpLogin(f.resourceUrl, { store, timeoutMs: 1200, onAuthorizationUrl: driveRedirect }).pipe(Effect.flip),
    );

    expect(err._tag).toBe("McpLoginError");
    expect(err.message).toMatch(/timed out/i);
    const codeExchanges = f.requests.filter(
      (r) => r.path === "/token" && r.params["grant_type"] === "authorization_code",
    );
    expect(codeExchanges).toHaveLength(0);
    const status = await Effect.runPromise(mcpAuthStatus(f.resourceUrl, { store }));
    expect(status.state).toBe("absent");
  });

  it("opens the system browser only when no callback is given", async () => {
    const f = await fixture();
    const err = await Effect.runPromise(
      mcpLogin(f.resourceUrl, { store: createMemoryTokenStore(), timeoutMs: 500 }).pipe(Effect.flip),
    );
    expect(err._tag).toBe("McpLoginError");
    expect(spawnCalls).toHaveLength(1);
  });

  it("fails fast with no way to deliver the URL, and refuses a plaintext non-loopback endpoint", async () => {
    const noChannel = await Effect.runPromise(
      mcpLogin("https://mcp.example.com/mcp", { openBrowser: false }).pipe(Effect.flip),
    );
    expect(noChannel._tag).toBe("McpLoginError");
    expect(noChannel.message).toMatch(/onAuthorizationUrl/);

    const plaintext = await Effect.runPromise(
      mcpLogin("http://mcp.example.com/mcp", { onAuthorizationUrl: () => {} }).pipe(Effect.flip),
    );
    expect(plaintext._tag).toBe("McpLoginError");
    expect(plaintext.message).toMatch(/HTTPS/);
  });

  it("COMPAT: a token written by the pre-API CLI code path (createAuthProvider + auth()) reads as signed-in", async () => {
    const f = await fixture();
    const dir = await tempDir();
    const cliStore = createFileTokenStore(dir);
    const provider = createAuthProvider(
      {
        name: "legacy",
        version: "1.0.0",
        transport: "streamable-http",
        endpoint: f.resourceUrl,
        tools: [],
        status: "disconnected",
        auth: { type: "authorization_code", interactive: true, timeoutMs: 10_000, onAuthorizationUrl: driveRedirect },
      },
      cliStore,
    );
    if (!provider || !("waitForAuthorizationCode" in provider) || typeof provider.waitForAuthorizationCode !== "function") {
      throw new TypeError("expected an authorization_code provider");
    }
    let result = await auth(provider, { serverUrl: f.resourceUrl });
    if (result === "REDIRECT") {
      const authorizationCode: string = await provider.waitForAuthorizationCode();
      result = await auth(provider, { serverUrl: f.resourceUrl, authorizationCode });
    }
    expect(result).toBe("AUTHORIZED");

    const freshStore = createFileTokenStore(dir);
    const status = await Effect.runPromise(mcpAuthStatus(f.resourceUrl, { store: freshStore }));
    expect(status.state).toBe("signed-in");
    expect(status.hasRefreshToken).toBe(true);
  });
});

describe("listMcpLogins", () => {
  it("lists a login with its metadata, drops it after logout, and lists a legacy record without metadata", async () => {
    const f = await fixture();
    const dir = await tempDir();
    const store = createFileTokenStore(dir);

    await Effect.runPromise(
      mcpLogin(f.resourceUrl, { store, name: "docs", timeoutMs: 10_000, onAuthorizationUrl: driveRedirect }),
    );
    const legacyUrl = "https://legacy.example.com/mcp";
    await store.set(canonicalResourceKey(legacyUrl), {
      tokens: { access_token: "legacy-access-token", token_type: "Bearer", expires_in: 3600 },
      resourceUrl: legacyUrl,
      savedAt: Date.now(),
    });
    // A registered client with no tokens is not a login.
    await store.set(canonicalResourceKey("https://client-only.example.com/mcp"), {
      clientInformation: { client_id: "c" },
      resourceUrl: "https://client-only.example.com/mcp",
      savedAt: Date.now(),
    });

    const logins = await Effect.runPromise(listMcpLogins({ store: createFileTokenStore(dir) }));
    const byUrl = new Map(logins.map((l) => [l.url, l]));
    expect(logins).toHaveLength(2);
    expect(byUrl.get(f.resourceUrl)).toMatchObject({ name: "docs", transport: "streamable-http", status: "signed-in" });
    expect(byUrl.get(legacyUrl)).toMatchObject({ status: "signed-in", scopes: [] });
    expect(byUrl.get(legacyUrl)!.name).toBeUndefined();
    expect(JSON.stringify(logins)).not.toContain("legacy-access-token");

    await Effect.runPromise(mcpLogout(f.resourceUrl, { store }));
    const after = await Effect.runPromise(listMcpLogins({ store }));
    expect(after.map((l) => l.url)).toEqual([legacyUrl]);
  });
});
