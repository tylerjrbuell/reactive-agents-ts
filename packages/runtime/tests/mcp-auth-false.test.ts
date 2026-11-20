// Run: bun test packages/runtime/tests/mcp-auth-false.test.ts --timeout 30000
//
// `.withMCP({ auth: false })` opts a URL-only HTTP server out of reusing a
// stored `rax mcp login` / `mcpLogin` for its URL (packages/tools
// stored-login.ts). Pins the runtime side: the type accepts `false`, the value
// reaches the real MCP connection (tool-init-layer.ts spreads `...mcp` into
// `connectMCPServer`), and AgentConfig JSON keeps it.
//
// RED-ON-CUT: drop `auth` before `connectMCPServer` in tool-init-layer.ts and
// the opt-out case sends the stored bearer. Remove `auth` from
// MCPServerConfigSchema and the round-trip case loses `false`.
import { describe, it, expect, afterEach } from "bun:test";
import { ReactiveAgents } from "../src/builder.js";
import { agentConfigFromJSON, agentConfigToJSON } from "../src/agent-config.js";
import type { MCPServerConfig } from "../src/runtime-types.js";
import { canonicalResourceKey, createMemoryTokenStore } from "@reactive-agents/tools";
import type { MCPTokenStore } from "@reactive-agents/tools";

let recorders: Array<{ stop: (force: boolean) => void }> = [];
afterEach(() => {
  for (const r of recorders) r.stop(true);
  recorders = [];
});

/** A loopback server that records every Authorization header it sees and answers 401. */
function startHeaderRecorder(): { endpoint: string; seen: Array<string | null> } {
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
  return { endpoint: `http://127.0.0.1:${server.port}/mcp`, seen };
}

async function storeWithLogin(endpoint: string): Promise<MCPTokenStore> {
  const store = createMemoryTokenStore();
  await store.set(canonicalResourceKey(endpoint), {
    tokens: { access_token: "stored-access-token-xyz", token_type: "Bearer" },
    clientInformation: { client_id: "c" },
    resourceUrl: endpoint,
    savedAt: Date.now(),
  });
  return store;
}

/** Build (and dispose) an agent with one MCP server; the 401 connect may fail the build. */
async function buildWith(config: MCPServerConfig): Promise<void> {
  const agent = await ReactiveAgents.create()
    .withName("mcp-auth-false")
    .withProvider("test")
    .withMCP(config)
    .build()
    .catch(() => undefined);
  // The recorder 401s every connect; today that MCPConnectionError surfaces
  // from dispose() (the tools layer is built lazily), not from build().
  await agent?.dispose().catch(() => undefined);
}

describe(".withMCP({ auth: false }) — stored-login opt-out reaches the tools layer", () => {
  it("URL-only server sends the stored bearer; auth:false sends none", async () => {
    const rec = startHeaderRecorder();
    const store = await storeWithLogin(rec.endpoint);

    await buildWith({ name: "own", transport: "streamable-http", endpoint: rec.endpoint, tokenStore: store });
    expect(rec.seen).toContain("Bearer stored-access-token-xyz");

    rec.seen.length = 0;
    await buildWith({
      name: "optout",
      transport: "streamable-http",
      endpoint: rec.endpoint,
      tokenStore: store,
      auth: false,
    });
    expect(rec.seen.length).toBeGreaterThan(0);
    expect(rec.seen.every((h) => h === null)).toBe(true);
  });

  it("toConfig() and the AgentConfig JSON round-trip keep auth: false", () => {
    const config = ReactiveAgents.create()
      .withName("mcp-auth-false-json")
      .withMCP({ name: "docs", transport: "streamable-http", endpoint: "https://mcp.example.com/mcp", auth: false })
      .toConfig();
    expect(config.mcpServers?.[0]?.auth).toBe(false);

    const back = agentConfigFromJSON(agentConfigToJSON(config));
    expect(back.mcpServers?.[0]?.auth).toBe(false);
    expect(agentConfigFromJSON(agentConfigToJSON(back))).toEqual(back);
  });
});
