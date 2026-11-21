// Run: bun test packages/tools/tests/mcp/oauth/authorization-code.test.ts --timeout 30000
//
// Task 4 of wiki/Planning/Implementation-Plans/2026-09-17-mcp-client-oauth.md —
// the interactive authorization-code (+ PKCE) grant: the loopback redirect
// listener, `openBrowser`, and `createAuthorizationCodeProvider`, wired into
// the real MCP client transports. Covers all 11 (+3a) Step 1 cases from
// task-4-brief.md against the real Task 1 fixture (real HTTP round-trips,
// including the fixture's real 302 redirect chain — driven by a real
// `fetch()` in `driveRedirect` below instead of an actual browser).
//
// `node:child_process`'s `spawn` is mocked at the top of this file, BEFORE
// anything is imported, so that `openBrowser` (which every interactive
// connect could reach if `onAuthorizationUrl` were omitted) never actually
// launches a real browser in CI/dev — and so tests 2 and 10 can assert on
// spawn call counts/args directly. Every other test in this file supplies
// `onAuthorizationUrl` and never touches `openBrowser`/`spawn` at all.
import { describe, it, expect, afterEach, mock } from "bun:test";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { Effect } from "effect";

interface SpawnCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: unknown;
}
const spawnCalls: SpawnCall[] = [];
mock.module("node:child_process", () => ({
  spawn: (command: string, args: readonly string[], options: unknown) => {
    spawnCalls.push({ command, args: [...args], options });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("spawn"));
    return child;
  },
}));

const { makeMCPClient } = await import("../../../src/mcp/mcp-client.js");
const { createMemoryTokenStore, canonicalResourceKey } = await import(
  "../../../src/mcp/auth/token-store.js"
);
const { openBrowser } = await import("../../../src/mcp/auth/open-browser.js");
const { startLoopbackRedirectListener } = await import(
  "../../../src/mcp/auth/loopback-redirect.js"
);
const { startOAuthMcpFixture } = await import("../../fixtures/oauth-mcp/fixture.js");
type OAuthMcpFixture = Awaited<ReturnType<typeof startOAuthMcpFixture>>;
type FixtureOverrides = Parameters<OAuthMcpFixture["configure"]>[0];

let fixtures: OAuthMcpFixture[] = [];
async function fixture(
  ...args: Parameters<typeof startOAuthMcpFixture>
): Promise<OAuthMcpFixture> {
  const f = await startOAuthMcpFixture(...args);
  fixtures.push(f);
  return f;
}
afterEach(async () => {
  await Promise.all(fixtures.map((f) => f.close()));
  fixtures = [];
});

/** Simulates the browser: follows the fixture's real 302 chain onto our real loopback listener. */
async function driveRedirect(url: URL): Promise<void> {
  const res = await fetch(url);
  await res.text().catch(() => {});
}

async function expectConnectTimeout(
  overrides: FixtureOverrides,
  authExtra: Record<string, unknown> = {},
): Promise<void> {
  const f = await fixture();
  f.configure(overrides);
  const store = createMemoryTokenStore();
  const name = `timeout-${Math.random().toString(36).slice(2, 8)}`;

  const err = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeMCPClient;
      return yield* client
        .connect({
          name,
          transport: "streamable-http",
          endpoint: f.resourceUrl,
          auth: {
            type: "authorization_code",
            clientId: `${name}-client`,
            interactive: true,
            timeoutMs: 1200,
            onAuthorizationUrl: driveRedirect,
            ...authExtra,
          },
          tokenStore: store,
        })
        .pipe(Effect.flip);
    }),
  );

  expect(err._tag).toBe("MCPConnectionError");
  expect(err.message).toMatch(/timed out/i);
}

async function expectConnectSucceeds(overrides: FixtureOverrides, name: string): Promise<void> {
  const f = await fixture();
  f.configure(overrides);
  const store = createMemoryTokenStore();

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeMCPClient;
      const server = yield* client.connect({
        name,
        transport: "streamable-http",
        endpoint: f.resourceUrl,
        auth: {
          type: "authorization_code",
          clientId: `${name}-client`,
          interactive: true,
          timeoutMs: 10_000,
          onAuthorizationUrl: driveRedirect,
        },
        tokenStore: store,
      });
      expect(server.status).toBe("connected");
      return yield* client.callTool(name, "whoami", {});
    }),
  );
  expect(result).toBe("fixture-user");
}

describe("MCP client OAuth — authorization_code (interactive)", () => {
  it("1. RED-ON-CUT: interactive login completes, whoami works, tokens persisted; second connect performs no authorization", async () => {
    const f = await fixture();
    const store = createMemoryTokenStore();
    const authConfig = {
      type: "authorization_code" as const,
      clientId: "redoncut-client",
      interactive: true,
      timeoutMs: 10_000,
      onAuthorizationUrl: driveRedirect,
    };

    await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* makeMCPClient;
        const server = yield* client.connect({
          name: "redoncut-1",
          transport: "streamable-http",
          endpoint: f.resourceUrl,
          auth: authConfig,
          tokenStore: store,
        });
        expect(server.status).toBe("connected");
        const result = yield* client.callTool("redoncut-1", "whoami", {});
        expect(result).toBe("fixture-user");
      }),
    );

    const authorizeCallsAfterFirst = f.requests.filter((r) => r.path === "/authorize").length;
    expect(authorizeCallsAfterFirst).toBeGreaterThan(0);
    const stored = await store.get(canonicalResourceKey(f.resourceUrl));
    expect(stored?.tokens?.access_token).toBeTruthy();

    await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* makeMCPClient;
        const server = yield* client.connect({
          name: "redoncut-2",
          transport: "streamable-http",
          endpoint: f.resourceUrl,
          auth: authConfig,
          tokenStore: store,
        });
        expect(server.status).toBe("connected");
      }),
    );
    expect(f.requests.filter((r) => r.path === "/authorize").length).toBe(authorizeCallsAfterFirst);
  });
  // RED-ON-CUT proof: reverting `create-provider.ts`'s `authorization_code`
  // case to its Task 3 stub (`throw new Error("...not yet supported...")`)
  // makes this test fail immediately on the first `client.connect(...)` —
  // confirmed by temporarily reverting it and re-running this test (see the
  // Task 4 report for the transcript).

  // Post-merge live-verification finding (2026-09-17, against Google Home
  // MCP): Google's `initialize` succeeds with no token at all; only
  // `tools/list` returns 401. `connectHttpLike`'s retry originally covered
  // only the initial `sdkClient.connect()` call, not the `listTools()`
  // `buildMCPServer` makes afterward — a server shaped this way (spec-legal;
  // nothing requires the FIRST request to be the one that's challenged)
  // never got an interactive-login attempt at all, just a raw "Unauthorized".
  it("RED-ON-CUT: interactive retry also covers a 401 raised by listTools (initialize succeeds unauthenticated)", async () => {
    const f = await fixture();
    f.configure({ allowUnauthenticatedInitialize: true });
    const store = createMemoryTokenStore();

    const server = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* makeMCPClient;
        return yield* client.connect({
          name: "unauth-initialize",
          transport: "streamable-http",
          endpoint: f.resourceUrl,
          auth: {
            type: "authorization_code",
            clientId: "unauth-initialize-client",
            interactive: true,
            timeoutMs: 10_000,
            onAuthorizationUrl: driveRedirect,
          },
          tokenStore: store,
        });
      }),
    );

    expect(server.status).toBe("connected");
    expect(f.requests.some((r) => r.path === "/authorize")).toBe(true);
    const stored = await store.get(canonicalResourceKey(f.resourceUrl));
    expect(stored?.tokens?.access_token).toBeTruthy();
  });
  // RED-ON-CUT proof: reverting `connectHttpLike`'s `attempt()` restructure
  // (i.e. calling `buildMCPServer` AFTER the try/catch instead of inside
  // `attempt()`, as it was before this fix) makes this test fail — the
  // `UnauthorizedError` from `listTools()` propagates uncaught as a raw
  // "Unauthorized" `MCPConnectionError` instead of triggering the
  // interactive retry; confirmed by temporarily reverting the file to the
  // pre-fix shape and re-running this test.

  it("2. non-interactive with no stored token → MCPConnectionError naming rax mcp login; no listener bound; openBrowser never called", async () => {
    const f = await fixture();
    const store = createMemoryTokenStore();

    // Reserve a port and pass it as `redirectPort` — if a listener were
    // incorrectly started despite `interactive` being unset, it would bind
    // exactly this port, and reclaiming it below would fail.
    const probe = createServer();
    const reservedPort = await new Promise<number>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const addr = probe.address();
        resolve(addr && typeof addr === "object" ? addr.port : 0);
      });
    });
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const spawnCallsBefore = spawnCalls.length;

    const err = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* makeMCPClient;
        return yield* client
          .connect({
            name: "non-interactive-no-token",
            transport: "streamable-http",
            endpoint: f.resourceUrl,
            auth: {
              type: "authorization_code",
              clientId: "non-interactive-client",
              redirectPort: reservedPort,
            },
            tokenStore: store,
          })
          .pipe(Effect.flip);
      }),
    );

    expect(err._tag).toBe("MCPConnectionError");
    expect(err.message).toContain("rax mcp login non-interactive-no-token");
    // Typed sign-in signal: hosts check `reason`, never the message text.
    expect(err.reason).toBe("auth-required");
    expect(err.status).toBe(401);
    expect(spawnCalls.length).toBe(spawnCallsBefore);

    // Nothing bound the reserved port — a fresh server can claim it.
    const reclaim = createServer();
    await new Promise<void>((resolve, reject) => {
      reclaim.once("error", reject);
      reclaim.listen(reservedPort, "127.0.0.1", () => resolve());
    });
    await new Promise<void>((resolve) => reclaim.close(() => resolve()));
  });

  it("3. missing state on callback → rejected, listener keeps waiting, ends in timeout", () =>
    expectConnectTimeout({ omitStateOnRedirect: true }));

  it("3. wrong state on callback → rejected, listener keeps waiting, ends in timeout", () =>
    expectConnectTimeout({ wrongStateOnRedirect: true }));

  it("3a. RFC 9207: issParameterRequired + missing iss on callback → timeout", () =>
    expectConnectTimeout({ advertiseIssParameterSupported: true, omitIssOnRedirect: true }));

  it("3a. RFC 9207: issParameterRequired + wrong iss on callback → timeout", () =>
    expectConnectTimeout({ advertiseIssParameterSupported: true, wrongIssOnRedirect: true }));

  it("3a. RFC 9207: issParameterRequired + correct iss on callback → succeeds", () =>
    expectConnectSucceeds({ advertiseIssParameterSupported: true }, "iss-correct"));

  it("3a. RFC 9207: issParameterRequired false + no iss on callback → succeeds (back-compat)", () =>
    expectConnectSucceeds({ omitIssOnRedirect: true }, "iss-backcompat"));

  it("9. dynamic client registration: no clientId → /register called once, client info persisted and reused", async () => {
    const f = await fixture();
    const store = createMemoryTokenStore();
    const authConfig = {
      type: "authorization_code" as const,
      interactive: true,
      timeoutMs: 10_000,
      onAuthorizationUrl: driveRedirect,
    };

    await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* makeMCPClient;
        const server = yield* client.connect({
          name: "dcr-1",
          transport: "streamable-http",
          endpoint: f.resourceUrl,
          auth: authConfig,
          tokenStore: store,
        });
        expect(server.status).toBe("connected");
      }),
    );
    const registerCallsAfterFirst = f.requests.filter((r) => r.path === "/register").length;
    expect(registerCallsAfterFirst).toBe(1);

    await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* makeMCPClient;
        const server = yield* client.connect({
          name: "dcr-2",
          transport: "streamable-http",
          endpoint: f.resourceUrl,
          auth: authConfig,
          tokenStore: store,
        });
        expect(server.status).toBe("connected");
      }),
    );
    expect(f.requests.filter((r) => r.path === "/register").length).toBe(registerCallsAfterFirst);
  });
});

describe("MCP client OAuth — authorization_code, refresh", () => {
  it("11a. invalid access token + valid refresh token → refreshed silently, rotated refresh token saved", async () => {
    const f = await fixture();
    const store = createMemoryTokenStore();
    const clientId = "refresh-client";

    await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* makeMCPClient;
        yield* client.connect({
          name: "refresh-seed",
          transport: "streamable-http",
          endpoint: f.resourceUrl,
          auth: {
            type: "authorization_code",
            clientId,
            interactive: true,
            timeoutMs: 10_000,
            onAuthorizationUrl: driveRedirect,
          },
          tokenStore: store,
        });
      }),
    );

    const key = canonicalResourceKey(f.resourceUrl);
    const seeded = await store.get(key);
    const originalRefreshToken = seeded?.tokens?.refresh_token;
    expect(originalRefreshToken).toBeTruthy();

    // The fixture's resource server 401s any access token it can't verify —
    // regardless of *why* (expired vs malformed vs unsigned) — so replacing
    // just the access_token deterministically forces the same 401→refresh
    // path a real wall-clock expiry would, without needing the fixture's
    // private signing key or a multi-hour test.
    await store.set(key, {
      ...seeded!,
      tokens: { ...seeded!.tokens!, access_token: "deliberately-invalidated" },
    });

    const refreshRequestsBefore = f.requests.filter(
      (r) => r.path === "/token" && r.params["grant_type"] === "refresh_token",
    ).length;

    await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* makeMCPClient;
        const server = yield* client.connect({
          name: "refresh-consumer",
          transport: "streamable-http",
          endpoint: f.resourceUrl,
          // Non-interactive — refresh must succeed WITHOUT ever touching
          // the interactive path (no listener, no browser).
          auth: { type: "authorization_code", clientId },
          tokenStore: store,
        });
        expect(server.status).toBe("connected");
        const result = yield* client.callTool("refresh-consumer", "whoami", {});
        expect(result).toBe("fixture-user");
      }),
    );

    const refreshRequestsAfter = f.requests.filter(
      (r) => r.path === "/token" && r.params["grant_type"] === "refresh_token",
    ).length;
    expect(refreshRequestsAfter).toBe(refreshRequestsBefore + 1);

    const refreshed = await store.get(key);
    expect(refreshed?.tokens?.access_token).not.toBe("deliberately-invalidated");
    expect(refreshed?.tokens?.refresh_token).toBeTruthy();
    expect(refreshed?.tokens?.refresh_token).not.toBe(originalRefreshToken);
  });

  it("11b. refreshReturnsInvalidGrant → tokens cleared; subsequent non-interactive connect gets the rax mcp login error, not a stale token", async () => {
    const f = await fixture();
    const store = createMemoryTokenStore();
    const clientId = "refresh-invalid-grant-client";

    await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* makeMCPClient;
        yield* client.connect({
          name: "refresh-invalid-seed",
          transport: "streamable-http",
          endpoint: f.resourceUrl,
          auth: {
            type: "authorization_code",
            clientId,
            interactive: true,
            timeoutMs: 10_000,
            onAuthorizationUrl: driveRedirect,
          },
          tokenStore: store,
        });
      }),
    );

    const key = canonicalResourceKey(f.resourceUrl);
    const seeded = await store.get(key);
    await store.set(key, {
      ...seeded!,
      tokens: { ...seeded!.tokens!, access_token: "deliberately-invalidated" },
    });

    f.configure({ refreshReturnsInvalidGrant: true });

    const err = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* makeMCPClient;
        return yield* client
          .connect({
            name: "refresh-invalid-consumer",
            transport: "streamable-http",
            endpoint: f.resourceUrl,
            auth: { type: "authorization_code", clientId },
            tokenStore: store,
          })
          .pipe(Effect.flip);
      }),
    );
    expect(err._tag).toBe("MCPConnectionError");
    expect(err.message).toContain("rax mcp login refresh-invalid-consumer");

    const cleared = await store.get(key);
    expect(cleared?.tokens).toBeUndefined();

    // A SUBSEQUENT non-interactive attempt gets the same error — not a
    // stale/broken token silently reused.
    const err2 = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* makeMCPClient;
        return yield* client
          .connect({
            name: "refresh-invalid-consumer-2",
            transport: "streamable-http",
            endpoint: f.resourceUrl,
            auth: { type: "authorization_code", clientId },
            tokenStore: store,
          })
          .pipe(Effect.flip);
      }),
    );
    expect(err2._tag).toBe("MCPConnectionError");
    expect(err2.message).toContain("rax mcp login refresh-invalid-consumer-2");
  });
});

describe("openBrowser — CVE-2025-6514-class safety", () => {
  it("10. refuses disallowed schemes before spawn is ever reached", async () => {
    const before = spawnCalls.length;
    for (const bad of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,hi"]) {
      await expect(openBrowser(new URL(bad))).rejects.toThrow(/refus/i);
    }
    expect(spawnCalls.length).toBe(before);
  });

  it("10. spawns shell:false with the URL as exactly one unchanged argv element, even with shell metacharacters", async () => {
    const before = spawnCalls.length;
    const dangerous = new URL(
      "https://auth.example.test/authorize?a=$(rm+-rf+~)&b=`whoami`&c=1;2&&3",
    );
    await openBrowser(dangerous);

    expect(spawnCalls.length).toBe(before + 1);
    const call = spawnCalls[spawnCalls.length - 1]!;
    expect((call.options as { shell?: boolean } | null)?.shell).toBe(false);

    const matches = call.args.filter((a) => a === dangerous.toString());
    expect(matches.length).toBe(1);
    // Not concatenated into a larger command string: no argv element is
    // longer than the URL itself carrying extra shell syntax around it.
    for (const arg of call.args) {
      expect(arg.length).toBeLessThanOrEqual(dangerous.toString().length);
    }
  });
});

describe("startLoopbackRedirectListener", () => {
  it("5. binds to 127.0.0.1, not 0.0.0.0", async () => {
    const listener = await startLoopbackRedirectListener({
      path: "/callback",
      expectedState: "s",
      issParameterRequired: false,
      timeoutMs: 5000,
    });
    expect(listener.boundAddress).toBe("127.0.0.1");
    expect(listener.redirectUrl.hostname).toBe("127.0.0.1");
    await listener.close();
  });

  it("4. wrong path → 404; wrong method → 405; listener keeps waiting", async () => {
    const listener = await startLoopbackRedirectListener({
      path: "/callback",
      expectedState: "s",
      issParameterRequired: false,
      timeoutMs: 5000,
    });

    const wrongPath = await fetch(new URL("/nope", listener.redirectUrl));
    expect(wrongPath.status).toBe(404);

    const wrongMethod = await fetch(listener.redirectUrl, { method: "POST" });
    expect(wrongMethod.status).toBe(405);

    let settled = false;
    listener.code.then(
      () => { settled = true; },
      () => { settled = true; },
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(settled).toBe(false);

    await listener.close();
  });

  it("state mismatch is rejected but the listener keeps waiting for a later valid callback", async () => {
    const listener = await startLoopbackRedirectListener({
      path: "/callback",
      expectedState: "good-state",
      issParameterRequired: false,
      timeoutMs: 5000,
    });

    const bad = new URL(listener.redirectUrl);
    bad.searchParams.set("state", "wrong");
    bad.searchParams.set("code", "irrelevant");
    const badRes = await fetch(bad);
    expect(badRes.status).toBe(400);

    const good = new URL(listener.redirectUrl);
    good.searchParams.set("state", "good-state");
    good.searchParams.set("code", "real-code");
    const goodRes = await fetch(good);
    expect(goodRes.status).toBe(200);

    expect(await listener.code).toBe("real-code");
  });

  it("6. single-use: second callback after success → connection refused", async () => {
    const listener = await startLoopbackRedirectListener({
      path: "/callback",
      expectedState: "s",
      issParameterRequired: false,
      timeoutMs: 5000,
    });

    const first = new URL(listener.redirectUrl);
    first.searchParams.set("state", "s");
    first.searchParams.set("code", "abc123");
    const ok = await fetch(first);
    expect(ok.status).toBe(200);
    expect(await listener.code).toBe("abc123");

    const second = new URL(listener.redirectUrl);
    second.searchParams.set("state", "s");
    second.searchParams.set("code", "xyz");
    await expect(fetch(second)).rejects.toThrow();
  });

  it("7. timeout → error, listener closed (port freed)", async () => {
    const listener = await startLoopbackRedirectListener({
      path: "/callback",
      expectedState: "s",
      issParameterRequired: false,
      timeoutMs: 200,
    });
    const port = Number(listener.redirectUrl.port);

    await expect(listener.code).rejects.toThrow(/timed out/);

    const probe = createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(port, "127.0.0.1", () => resolve());
    });
    await new Promise<void>((resolve) => probe.close(() => resolve()));
  });

  it("close() before any callback rejects the pending code promise and frees the port", async () => {
    const listener = await startLoopbackRedirectListener({
      path: "/callback",
      expectedState: "s",
      issParameterRequired: false,
      timeoutMs: 30_000,
    });
    const port = Number(listener.redirectUrl.port);

    await listener.close();
    await expect(listener.code).rejects.toThrow();

    const probe = createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(port, "127.0.0.1", () => resolve());
    });
    await new Promise<void>((resolve) => probe.close(() => resolve()));
  });
});
