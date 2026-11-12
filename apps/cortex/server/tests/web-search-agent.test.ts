// Run: bun run repo test apps/cortex/server/tests/web-search-agent.test.ts
//
// Web-search keys saved in Settings · Web search reach the agents Cortex builds as
// `.withTools({ webSearch: { apiKeys, providers } })`: the single build funnel
// (`cortexAgentBuilder`) applies them, so chat sessions and gateway agents both get them. The
// pins run the real `web-search` tool through a scripted agent with a stubbed `fetch` and read
// the key off the outgoing request. Keys never appear in `toConfig()` JSON; the provider order
// does, and round-trips. Removing the overlay in `build-cortex-agent.ts` fails these tests.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.js";
import { getChatSession } from "../db/chat-queries.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { buildCortexAgent, cortexAgentBuilder, type BuildCortexAgentParams } from "../services/build-cortex-agent.js";
import { gatewayConfigToBuildParams } from "../services/gateway-process-manager.js";
import { normalizeCortexAgentConfig } from "../services/cortex-agent-config.js";
import { cortexOnlySettings } from "../services/cortex-agent-source.js";
import { installProviderKeyStore, ProviderKeyStore } from "../services/provider-key-store.js";
import { webSearchOptionOf } from "../services/web-search-keys.js";

const TAVILY_KEY = "tvly-fake-0123456789abcdABCD";
const BRAVE_KEY = "brave-fake-0123456789abcdWXYZ";

let dir: string;
let db: Database;
let svc: ChatSessionService;
const realFetch = globalThis.fetch;
let requests: { url: string; headers: string; body: string }[];

const SEARCH_TURNS = [{ toolCall: { name: "web-search", args: { query: "framework news" } } }, { text: "done" }] as const;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "cortex-wsagent-"));
  db = new Database(":memory:");
  applySchema(db);
  svc = new ChatSessionService(db);
});
afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  requests = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requests.push({ url, headers: JSON.stringify(init?.headers ?? {}), body: String(init?.body ?? "") });
    return new Response(JSON.stringify({ results: [{ title: "T", url: "https://example.com/a", content: "hello" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  installProviderKeyStore(null);
});

/** Install a store holding web-search keys; `env` is the server environment the store sees. */
function withStore(keys: Record<string, string>, env: Record<string, string> = {}, preferStored = false): void {
  const store = new ProviderKeyStore({ dir: mkdtempSync(join(dir, "keys-")), env, now: () => 1_000 });
  for (const [id, key] of Object.entries(keys)) {
    const r = store.set(id, key, preferStored);
    expect(r.ok).toBe(true);
  }
  installProviderKeyStore(store);
}

const base: BuildCortexAgentParams = {
  provider: "test",
  tools: ["web-search"],
  maxIterations: 4,
  testScenario: [...SEARCH_TURNS],
  rawConfig: { tools: { webSearch: { providers: ["tavily", "duckduckgo"] } } },
};

describe("saved web-search keys reach the built agent", () => {
  it("chat path: the saved Tavily key is in the outgoing search request", async () => {
    withStore({ "websearch-tavily": TAVILY_KEY });
    const id = await svc.createSession({
      agentConfig: { provider: "test", tools: ["web-search"], maxIterations: 4, testScenario: [...SEARCH_TURNS], rawConfig: base.rawConfig },
    });
    for await (const _ev of svc.chatStream(id, "search")) void _ev;
    await svc.deleteSession(id);
    const tavily = requests.find((r) => r.url.includes("api.tavily.com"));
    expect(tavily?.body).toContain(TAVILY_KEY);
  }, 30_000);

  it("gateway path: the saved key reaches a saved agent's search", async () => {
    withStore({ "websearch-tavily": TAVILY_KEY });
    const config = normalizeCortexAgentConfig(
      JSON.parse(JSON.stringify({ provider: "test", tools: ["web-search"], rawConfig: base.rawConfig })) as Record<string, unknown>,
    );
    const params = { ...gatewayConfigToBuildParams({ agentId: "gw-ws", name: "ws", config, mcpConfigs: [] }), testScenario: [...SEARCH_TURNS], maxIterations: 4 };
    const agent = await buildCortexAgent(params);
    await agent.run("search");
    expect(requests.find((r) => r.url.includes("api.tavily.com"))?.body).toContain(TAVILY_KEY);
  }, 30_000);

  it("the same funnel serves both: chat and gateway params build the identical webSearch overlay", async () => {
    withStore({ "websearch-tavily": TAVILY_KEY, "websearch-brave": BRAVE_KEY });
    const id = await svc.createSession({ agentConfig: { provider: "test", tools: ["web-search"], rawConfig: base.rawConfig } });
    const row = getChatSession(db, id)!;
    const chat = (svc as unknown as { buildChatAgentParams: (s: string, c: unknown, a: unknown) => BuildCortexAgentParams }).buildChatAgentParams(id, row.agentConfig, row.stableAgentId);
    await svc.deleteSession(id);
    const config = normalizeCortexAgentConfig({ provider: "test", tools: ["web-search"], rawConfig: base.rawConfig });
    const gateway = gatewayConfigToBuildParams({ agentId: "gw-ws2", name: "ws", config, mcpConfigs: [] });
    for (const p of [chat, gateway]) {
      const cfg = (await cortexAgentBuilder(p)).toConfig();
      expect(cfg.tools?.webSearch).toEqual({ providers: ["tavily", "duckduckgo"] });
    }
  });

  it("an environment key wins unless 'use stored key' is chosen (the provider-key rule)", async () => {
    const ENV_KEY = "env-key-0123456789";
    const before = process.env["TAVILY_API_KEY"];
    process.env["TAVILY_API_KEY"] = ENV_KEY; // the framework reads the real environment
    try {
      withStore({ "websearch-tavily": TAVILY_KEY }, { TAVILY_API_KEY: ENV_KEY });
      await (await buildCortexAgent(base)).run("search");
      const envWins = requests.find((r) => r.url.includes("api.tavily.com"))?.body ?? "";
      expect(envWins).toContain(ENV_KEY);
      expect(envWins).not.toContain(TAVILY_KEY);

      requests = [];
      withStore({ "websearch-tavily": TAVILY_KEY }, { TAVILY_API_KEY: ENV_KEY }, true);
      await (await buildCortexAgent(base)).run("search");
      expect(requests.find((r) => r.url.includes("api.tavily.com"))?.body).toContain(TAVILY_KEY);
    } finally {
      if (before === undefined) delete process.env["TAVILY_API_KEY"];
      else process.env["TAVILY_API_KEY"] = before;
    }
  }, 30_000);

  it("no saved key: nothing is passed and the config's own webSearch is untouched", async () => {
    withStore({});
    expect(webSearchOptionOf(["brave"], () => undefined)).toBeUndefined();
    const cfg = (await cortexAgentBuilder(base)).toConfig();
    expect(cfg.tools?.webSearch).toEqual({ providers: ["tavily", "duckduckgo"] });
  });

  it("a config with tools off does not get its tools layer switched on by a saved key", async () => {
    withStore({ "websearch-tavily": TAVILY_KEY });
    const cfg = (await cortexAgentBuilder({ provider: "test" })).toConfig();
    expect(cfg.features?.tools).toBeUndefined();
    expect(cfg.tools).toBeUndefined();
  });
});

describe("keys stay out of config and notes", () => {
  it("toConfig() JSON carries the provider order and never a key", async () => {
    withStore({ "websearch-tavily": TAVILY_KEY, "websearch-brave": BRAVE_KEY });
    const cfg = (await cortexAgentBuilder(base)).toConfig();
    const json = JSON.stringify(cfg);
    expect(cfg.tools?.webSearch).toEqual({ providers: ["tavily", "duckduckgo"] });
    expect(json).not.toContain(TAVILY_KEY);
    expect(json).not.toContain(BRAVE_KEY);
  });

  it("the provider order round-trips with no saved key at all", async () => {
    withStore({});
    const cfg = (await cortexAgentBuilder({ ...base, rawConfig: { tools: { webSearch: { providers: ["serper", "keenable"] } } } })).toConfig();
    expect(cfg.tools?.webSearch).toEqual({ providers: ["serper", "keenable"] });
  });

  it("Export as code lists the saved keys as not exported, naming only env variables", () => {
    withStore({ "websearch-tavily": TAVILY_KEY });
    const note = cortexOnlySettings(base).find((n) => n.setting.startsWith("Web-search keys"));
    expect(note?.call).toBe("withTools");
    expect(note?.detail).toContain("TAVILY_API_KEY");
    expect(JSON.stringify(note)).not.toContain(TAVILY_KEY);
  });

  it("the overlay value holds each saved key under its framework provider id", () => {
    const keys: Record<string, string> = { "websearch-tavily": TAVILY_KEY, "websearch-brave": BRAVE_KEY };
    expect(webSearchOptionOf(["brave", "duckduckgo"], (id) => keys[id])).toEqual({
      apiKeys: { tavily: TAVILY_KEY, brave: BRAVE_KEY },
      providers: ["brave", "duckduckgo"],
    });
    expect(webSearchOptionOf(undefined, (id) => keys[id])).toEqual({ apiKeys: { tavily: TAVILY_KEY, brave: BRAVE_KEY } });
  });
});
