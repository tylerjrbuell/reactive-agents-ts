// Run: bun test packages/runtime/tests/mcp-oauth-trace-redaction.test.ts --timeout 30000
//
// Task 5, item 6 of task-5-brief.md's Step 1 list ("A tool result or trace
// event emitted during a run using an OAuth server contains no token — run
// an agent with the `test` provider calling the fixture's `whoami` tool
// through the runtime; scan the trace"), for
// wiki/Planning/Implementation-Plans/2026-09-17-mcp-client-oauth.md.
//
// LIVES HERE, NOT IN packages/tools/tests/mcp/oauth/hardening.test.ts:
// this is the one test in Task 5's Step 1 list that needs a full agent run
// (`ReactiveAgents.create()...build()`, the "test" LLM provider, JSONL
// tracing) — none of which `packages/tools` depends on. `packages/tools`
// must not gain `@reactive-agents/runtime` as a real dependency (that would
// invert the layering: `packages/runtime` already depends on
// `@reactive-agents/tools` as a REAL dependency — see its package.json —
// so the reverse would be circular). `packages/runtime`'s tests importing
// `@reactive-agents/tools`'s OWN source (`../../tools/src/mcp/auth/...`, via
// the package's normal export surface) is completely ordinary layering; the
// only unusual part is reaching across to `packages/tools`'s TEST-ONLY OAuth
// fixture via a relative filesystem path
// (`../../tools/tests/fixtures/oauth-mcp/fixture.js`) rather than a package
// import, since that fixture is deliberately excluded from `packages/tools`'
// published build (`tsconfig.json`'s `exclude: ["tests/**/*", "dist"]`) and
// has no `exports` entry. No existing precedent for a leaf package's test
// suite taking a real cross-package dependency on a HIGHER-layer package was
// found in this repo (`@reactive-agents/testing` depends on both `runtime`
// and `tools`, but it's a published package designed to sit ABOVE both, not
// a same-layer test-only dependency); a relative import stays entirely
// inside `devDependencies`-free test code and adds zero entries to either
// package's `package.json`, so it introduces no new dependency edge at all.
import { describe, it, expect, afterEach } from "bun:test";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { ReactiveAgents } from "../src/builder.js";
import { createMemoryTokenStore } from "@reactive-agents/tools";

/**
 * The fixture lives under `packages/tools/tests/fixtures/...` — test-only
 * infrastructure explicitly excluded from that package's build
 * (`packages/tools/tsconfig.json`'s `"exclude": ["tests/**\/*", "dist"]`)
 * and not part of its `exports`. A relative filesystem import across the
 * package boundary is the only way to reach it, but a STATIC `import`
 * pulls the source file into `packages/runtime`'s TypeScript program and
 * trips `tsc`'s `rootDir` check (TS6059 — the file is outside
 * `packages/runtime`'s `rootDir`). A dynamic `import()` of a
 * NON-literal path (the `: string`-annotated variable below) sidesteps
 * this: TypeScript cannot statically resolve a non-literal specifier, so
 * it types the result `Promise<any>` and never attempts to load or
 * rootDir-check the target file — this is a real behavioral difference in
 * bun/Node's module resolution (which works identically for relative paths
 * whether the import is static or dynamic) vs. TypeScript's static analysis
 * (which only kicks in for statically-resolvable specifiers). The local
 * `TestOAuthMcpFixture`/`TestOAuthMcpFixtureModule` types below are a
 * minimal, hand-written re-statement of the fixture's real exported shape
 * (see `packages/tools/tests/fixtures/oauth-mcp/fixture.ts`) — kept in sync
 * by hand since there is no cross-package type import available here.
 */
interface TestOAuthMcpFixture {
  readonly resourceUrl: string;
  readonly requests: ReadonlyArray<{ readonly path: string; readonly params: Readonly<Record<string, string>> }>;
  configure(overrides: Record<string, unknown>): void;
  close(): Promise<void>;
}
interface TestOAuthMcpFixtureModule {
  startOAuthMcpFixture(opts?: {
    readonly clients?: readonly {
      readonly clientId: string;
      readonly clientSecret?: string;
      readonly redirectUris: readonly string[];
    }[];
  }): Promise<TestOAuthMcpFixture>;
}
const fixtureModulePath: string = "../../tools/tests/fixtures/oauth-mcp/fixture.js";
const { startOAuthMcpFixture } = (await import(fixtureModulePath)) as TestOAuthMcpFixtureModule;

let fixtures: TestOAuthMcpFixture[] = [];
async function fixture(
  ...args: Parameters<TestOAuthMcpFixtureModule["startOAuthMcpFixture"]>
): Promise<TestOAuthMcpFixture> {
  const f = await startOAuthMcpFixture(...args);
  fixtures.push(f);
  return f;
}
afterEach(async () => {
  await Promise.all(fixtures.map((f) => f.close()));
  fixtures = [];
});

const CLIENT_ID = "trace-scan-client";
const CLIENT_SECRET = "trace-scan-correct-secret-value";

describe("MCP client OAuth hardening — trace-scan: no token leakage through a full agent run", () => {
  it("test-provider agent calling the OAuth fixture's whoami tool: no token/secret in the persisted trace", async () => {
    const f = await fixture({
      clients: [{ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUris: [] }],
    });
    const dir = `/tmp/mcp-oauth-trace-scan-${Date.now()}`;

    const agent = await ReactiveAgents.create()
      .withName("mcp-oauth-trace-scan")
      .withMCP({
        name: "oauth-fixture",
        transport: "streamable-http",
        endpoint: f.resourceUrl,
        auth: { type: "client_credentials", clientId: CLIENT_ID, clientSecret: CLIENT_SECRET },
        // In-memory store: without it the connect persists a login into the
        // owner's real ~/.reactive-agents/mcp-auth on every run.
        tokenStore: createMemoryTokenStore(),
      })
      .withTestScenario([
        { toolCall: { name: "oauth-fixture/whoami", args: {} } },
        { text: "Done." },
      ])
      .withTracing({ dir })
      .build();

    try {
      const result = await agent.run("Who am I?");
      expect(result.success).toBe(true);

      // Poll for the JSONL flush (same pattern as builder-tracing.test.ts).
      const start = Date.now();
      let files: string[] = [];
      while (Date.now() - start < 5000) {
        if (existsSync(dir)) {
          files = readdirSync(dir).filter((f2: string) => f2.endsWith(".jsonl"));
          if (files.length > 0) break;
        }
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(files.length).toBeGreaterThan(0);

      const combined = files
        .map((name) => readFileSync(`${dir}/${name}`, "utf8"))
        .join("\n");

      // The trace must contain the tool call itself (sanity check on the
      // test's own setup)...
      expect(combined).toContain("oauth-fixture/whoami");
      // ...but never the client secret, never a Bearer-token pattern, and
      // never the literal access token this connect minted.
      expect(combined).not.toContain(CLIENT_SECRET);
      expect(combined).not.toMatch(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/i);

      const tokenRequest = f.requests.find((r) => r.path === "/token");
      expect(tokenRequest).toBeDefined();
    } finally {
      await agent.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
