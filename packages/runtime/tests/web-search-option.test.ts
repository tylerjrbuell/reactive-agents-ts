// Run: bun test packages/runtime/tests/web-search-option.test.ts --timeout 15000
import { Effect, Redacted } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ReactiveAgents } from "../src/index.js";
import { webSearchRegistration } from "../src/builder/build-effect/web-search-registration.js";
import { ToolService, webSearchHandler } from "@reactive-agents/tools";

const KEY = "tvly-explicit-secret-key";
const realFetch = globalThis.fetch;
let seenBodies: string[] = [];
let seenUrls: string[] = [];

beforeEach(() => {
  seenBodies = [];
  seenUrls = [];
  const stub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    seenUrls.push(String(input));
    seenBodies.push(String(init?.body ?? ""));
    return new Response(
      JSON.stringify({ results: [{ title: "T", url: "https://x.test", content: "C" }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  globalThis.fetch = Object.assign(stub, { preconnect: realFetch.preconnect });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

// Method signature (bivariant): the agent's runtime provides ToolService.
type Rt = { runtime: { runPromise<A, R>(e: Effect.Effect<A, never, R>): Promise<A> } };
const search = (agent: Rt): Promise<unknown> =>
  agent.runtime.runPromise(
    Effect.gen(function* () {
      const ts = yield* ToolService;
      return yield* ts
        .execute({ toolName: "web-search", arguments: { query: "hello" }, agentId: "a", sessionId: "s" })
        .pipe(Effect.catchAll((e) => Effect.succeed({ error: String(e) })));
    }),
  );

describe("withTools({ webSearch })", () => {
  it("registered handler uses the explicit key (stub fetch)", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTools({
        builtins: ["web-search"],
        webSearch: { apiKeys: { tavily: Redacted.make(KEY) }, providers: ["tavily"] },
      })
      .build();
    await search(agent);
    expect(seenUrls.some((u) => u.includes("tavily"))).toBe(true);
    expect(seenBodies.some((b) => b.includes(KEY))).toBe(true);
    await agent.dispose();
  }, 15000);

  it("unset: no registration, default handler untouched", () => {
    expect(webSearchRegistration({ builtins: ["web-search"] })).toBeUndefined();
    expect(webSearchRegistration(undefined)).toBeUndefined();
    expect(webSearchHandler).toBeDefined();
  });

  it("web-search not a permitted builtin: nothing registered", () => {
    const webSearch = { apiKeys: { tavily: KEY } };
    expect(webSearchRegistration({ webSearch })).toBeUndefined();
    expect(webSearchRegistration({ builtins: ["file-read"], webSearch })).toBeUndefined();
    expect(webSearchRegistration({ builtins: ["web-search"], allowedTools: ["file-read"], webSearch })).toBeUndefined();
    expect(webSearchRegistration({ builtins: ["web-search"], webSearch })).toBeDefined();
  });

  it("round trips providers through toConfig/fromConfig; keys never serialized", async () => {
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withTools({
        builtins: ["web-search"],
        webSearch: { apiKeys: { tavily: KEY }, providers: ["tavily", "duckduckgo"] },
      });
    const config = builder.toConfig();
    expect(config.tools?.webSearch).toEqual({ providers: ["tavily", "duckduckgo"] });
    expect(JSON.stringify(config)).not.toContain(KEY);
    const rebuilt = await (await import("../src/agent-config.js")).agentConfigToBuilder(config);
    expect(rebuilt.toConfig().tools?.webSearch).toEqual({ providers: ["tavily", "duckduckgo"] });
    // Keys-only config serializes no webSearch at all.
    const keysOnly = ReactiveAgents.create()
      .withProvider("test")
      .withTools({ builtins: ["web-search"], webSearch: { apiKeys: { brave: KEY } } })
      .toConfig();
    expect(keysOnly.tools?.webSearch).toBeUndefined();
    expect(JSON.stringify(keysOnly)).not.toContain(KEY);
  });
});
