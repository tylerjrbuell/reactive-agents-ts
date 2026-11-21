// Run: bun test packages/tools/tests/mcp/oauth/mcp-auth-dir-isolation.test.ts --timeout 20000
//
// 2026-11-20: 632 credential files for http://127.0.0.1:<port>/mcp had piled up in a
// developer's real ~/.reactive-agents/mcp-auth, written by test runs (one writer:
// packages/runtime/tests/mcp-oauth-trace-redaction.test.ts, a client_credentials
// `.withMCP` with no `tokenStore`). They showed up as fake "Signed in with rax"
// logins. `DEFAULT_MCP_AUTH_DIR` comes from `os.homedir()`, which Bun caches at
// process start, so the test preload's HOME swap could not move it.
// `REACTIVE_AGENTS_MCP_AUTH_DIR` (read at call time) can; these tests pin it.
import { describe, it, expect, afterEach } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalResourceKey,
  createFileTokenStore,
  DEFAULT_MCP_AUTH_DIR,
  MCP_AUTH_DIR_ENV,
  resolveMcpAuthDir,
} from "../../../src/mcp/auth/token-store.js";

const dirs: string[] = [];
const savedEnv = process.env[MCP_AUTH_DIR_ENV];
afterEach(async () => {
  if (savedEnv === undefined) delete process.env[MCP_AUTH_DIR_ENV];
  else process.env[MCP_AUTH_DIR_ENV] = savedEnv;
  while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true });
});

describe("resolveMcpAuthDir", () => {
  it("uses REACTIVE_AGENTS_MCP_AUTH_DIR when set", () => {
    expect(resolveMcpAuthDir({ [MCP_AUTH_DIR_ENV]: "/somewhere/else" })).toBe("/somewhere/else");
  });

  it("falls back to DEFAULT_MCP_AUTH_DIR when unset or empty", () => {
    expect(resolveMcpAuthDir({})).toBe(DEFAULT_MCP_AUTH_DIR);
    expect(resolveMcpAuthDir({ [MCP_AUTH_DIR_ENV]: "" })).toBe(DEFAULT_MCP_AUTH_DIR);
  });
});

describe("createFileTokenStore() with no dir", () => {
  it("writes under REACTIVE_AGENTS_MCP_AUTH_DIR, read when the store is built", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rax-mcp-auth-override-"));
    dirs.push(dir);
    process.env[MCP_AUTH_DIR_ENV] = dir;

    const store = createFileTokenStore();
    const url = "http://127.0.0.1:1/mcp";
    await store.set(canonicalResourceKey(url), {
      tokens: { access_token: "override-dir-token", token_type: "Bearer" },
      resourceUrl: url,
      savedAt: Date.now(),
    });

    expect((await readdir(dir)).filter((f) => f.endsWith(".json"))).toHaveLength(1);
  });
});

describe("test-run isolation", () => {
  // RA_TEST_REAL_HOME is set by the repo test preload / `repo test` to the developer's
  // real home while HOME points at a mirror. Under either runner, a store built with no
  // dir must not resolve into the real ~/.reactive-agents. Needs the preload to set
  // REACTIVE_AGENTS_MCP_AUTH_DIR for raw `bun test` (Bun caches os.homedir()).
  const realHome = process.env.RA_TEST_REAL_HOME;
  it.skipIf(realHome === undefined || realHome.length === 0)(
    "the default store dir is not inside the real ~/.reactive-agents",
    () => {
      const realDataDir = join(realHome!, ".reactive-agents");
      expect(resolveMcpAuthDir().startsWith(realDataDir)).toBe(false);
    },
  );
});
