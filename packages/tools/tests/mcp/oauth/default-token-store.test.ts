// Run: bun test packages/tools/tests/mcp/oauth/default-token-store.test.ts --timeout 30000
//
// Final-review C1: `getDefaultTokenStore()` (packages/tools/src/mcp/mcp-client.ts) must
// default to the persistent file store under `~/.reactive-agents/mcp-auth`, not an
// in-memory store — every doc site, the changeset, and `rax mcp login`'s entire stated
// purpose promise a login persists there, and a subsequent `.withMCP()` connection with
// no explicit `tokenStore` must actually find it. Runs the real connect path in a CHILD
// PROCESS with an overridden `HOME` (see `default-token-store-child.ts`'s header comment
// for why a child process, not an env override in this process) against the real Task 1
// fixture, then reads back the credential file a completely separate `createFileTokenStore`
// instance (pointed at the same directory) would see — proving the default is really the
// file store, not merely that `DEFAULT_MCP_AUTH_DIR` looks right in isolation.
import { describe, it, expect, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createFileTokenStore, canonicalResourceKey } from "../../../src/mcp/auth/token-store.js";
import { startOAuthMcpFixture, type OAuthMcpFixture } from "../../fixtures/oauth-mcp/fixture.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHILD_SCRIPT = join(__dirname, "../../fixtures/default-token-store-child.ts");

let fixtures: OAuthMcpFixture[] = [];
async function fixture(
  ...args: Parameters<typeof startOAuthMcpFixture>
): Promise<OAuthMcpFixture> {
  const f = await startOAuthMcpFixture(...args);
  fixtures.push(f);
  return f;
}

const tmpHomes: string[] = [];
async function makeTmpHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "rax-mcp-default-store-home-"));
  tmpHomes.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(fixtures.map((f) => f.close()));
  fixtures = [];
  while (tmpHomes.length > 0) {
    const dir = tmpHomes.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

const CLIENT_ID = "default-store-client";
const CLIENT_SECRET = "default-store-correct-secret";

describe("MCP client OAuth — final-review C1: default token store is the file store", () => {
  it("a connect with no explicit tokenStore persists to ~/.reactive-agents/mcp-auth under the real HOME", async () => {
    const f = await fixture({
      clients: [{ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUris: [] }],
    });
    const tmpHome = await makeTmpHome();

    const proc = Bun.spawn({
      cmd: ["bun", "run", CHILD_SCRIPT, f.resourceUrl, CLIENT_ID, CLIENT_SECRET, f.issuer],
      env: { ...process.env, HOME: tmpHome },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stderrText] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect([exitCode, stderrText]).toEqual([0, ""]);

    // A completely independent store instance, pointed at the same
    // well-known directory the default would have used under this HOME —
    // never at a store the child process handed back to us.
    const store = createFileTokenStore(join(tmpHome, ".reactive-agents", "mcp-auth"));
    const key = canonicalResourceKey(f.resourceUrl);
    const creds = await store.get(key);

    expect(creds).toBeDefined();
    expect(creds?.tokens?.access_token).toBeTruthy();
  });
  // RED-ON-CUT proof (see final-review-fix-wave-report.md): reverting
  // `getDefaultTokenStore()` to `createMemoryTokenStore()` makes this test
  // fail — the child process still connects successfully (in-memory works
  // fine within that one process), but nothing is ever written under
  // `tmpHome/.reactive-agents/mcp-auth`, so `store.get(key)` comes back
  // `undefined`.
});
