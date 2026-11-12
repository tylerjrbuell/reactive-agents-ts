// Run: bun test packages/runtime/tests/with-channels-router.test.ts
//
// `.withChannels({ adapters, routes, agents })`: the runtime side of the channel router.
// Pins: routes round-trip through AgentConfig, the resolver builds a distinct agent per
// (route, role), a sender's agent really lacks mutating tools (narrowing happens before build),
// and the router starts and stops with the gateway handle.
import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { defineTool } from "@reactive-agents/tools";
import type { ToolDefinition } from "@reactive-agents/tools";
import { WebhookChannelAdapter } from "@reactive-agents/channels";
import type { AgentResolver, OpenSessionRequest, ToolExposure } from "@reactive-agents/channels";
import { ReactiveAgents } from "../src/builder.js";
import type { ReactiveAgentBuilder } from "../src/builder.js";
import { makeChannelAgentResolver, type ChannelAgentHandle } from "../src/agent/channel-router-resolver.js";
import { asBuilderState } from "../src/builder/withers/_state.js";
import { computeExposedToolNames } from "../src/builder/contract-tool-set.js";
import { narrowToolSurface } from "../src/agent/channel-tool-narrowing.js";

const tool = (name: string, mutatesExternalState: boolean) => {
  const defined = defineTool({
    name,
    description: `${name} test tool`,
    input: Schema.Struct({ q: Schema.String }),
    handler: async () => "ok",
  });
  const definition: ToolDefinition = { ...defined.definition, mutatesExternalState };
  return { definition, handler: defined.handler };
};

const double = (agentId: string): ChannelAgentHandle => ({
  agentId,
  dispose: async () => undefined,
  session: () => ({ chat: async () => ({ message: "ok" }), end: async () => undefined }),
  run: async () => ({ output: "ok", agentId, taskId: "t", metadata: { tokensUsed: 0, cost: 0 } }),
});

const makeBuilder =(): ReactiveAgentBuilder =>
  ReactiveAgents.create()
    .withName("route-target")
    .withProvider("test")
    .withTestScenario([{ text: "FINAL ANSWER: ok" }])
    .withTools({
      tools: [tool("lookup", false), tool("publish", true)],
      builtins: ["web-search", "file-write"],
    });

const exposedOf = (b: ReactiveAgentBuilder): string[] => [...computeExposedToolNames(asBuilderState(b)._toolsOptions)].sort();

const open = (resolver: AgentResolver, req: OpenSessionRequest) =>
  Effect.runPromise(Effect.scoped(resolver.open(req).pipe(Effect.map(() => undefined))));

const req = (role: "owner" | "sender", toolExposure: ToolExposure, routeId = "r1"): OpenSessionRequest => ({
  routeId,
  role,
  target: { agentId: "support" },
  toolExposure,
  conversationKey: "chat-1",
  stateless: false,
});

describe("withChannels routes in AgentConfig", () => {
  const routes = [{ id: "r1", match: { channelId: "tg" }, target: { agentId: "support" }, owners: ["telegram:1"] }];

  test("routes round-trip through toConfig and fromConfig", async () => {
    const builder = ReactiveAgents.create().withName("cfg").withProvider("test").withChannels({ adapters: [], routes });
    const config = builder.toConfig();
    expect(config.channelRoutes?.map((r) => r.id)).toEqual(["r1"]);
    const rebuilt = await ReactiveAgents.fromConfig(config);
    expect(rebuilt.toConfig().channelRoutes?.[0]?.owners).toEqual(["telegram:1"]);
    expect(rebuilt.toConfig().channelRoutes?.[0]?.match).toEqual({ channelId: "tg" });
  });

  test("a config without routes emits no channelRoutes", () => {
    expect(ReactiveAgents.create().withName("none").withProvider("test").toConfig().channelRoutes).toBeUndefined();
  });
});

describe("channel agent resolver", () => {
  test("builds a distinct agent per role and reuses it within a role", async () => {
    const built: ReactiveAgentBuilder[] = [];
    const resolver = makeChannelAgentResolver({
      agents: { support: makeBuilder },
      build: async (b) => {
        built.push(b);
        return double(`agent-${built.length}`);
      },
    });
    await open(resolver, req("owner", { _tag: "AgentDefault" }));
    await open(resolver, req("sender", { _tag: "ReadOnly" }));
    await open(resolver, req("sender", { _tag: "ReadOnly" }));
    expect(built).toHaveLength(2);
    expect(built[0]).not.toBe(built[1]);
    await Effect.runPromise(resolver.disposeAll);
  });

  test("an unknown target fails with resolve_failed and builds nothing", async () => {
    const resolver = makeChannelAgentResolver({ agents: {}, build: async () => { throw new Error("must not build"); } });
    const exit = await Effect.runPromiseExit(Effect.scoped(resolver.open(req("sender", { _tag: "ReadOnly" }))));
    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("resolve_failed");
  });

  test("ReadOnly removes every mutating tool from the sender's built agent; the owner keeps them", async () => {
    const surfaces: Record<string, string[]> = {};
    const resolver = makeChannelAgentResolver({
      agents: { support: makeBuilder },
      build: async (b) => {
        const role = Object.keys(surfaces).length === 0 ? "first" : "second";
        surfaces[role] = exposedOf(b);
        return double(role);
      },
    });
    await open(resolver, req("owner", { _tag: "AgentDefault" }));
    await open(resolver, req("sender", { _tag: "ReadOnly" }));
    expect(surfaces["first"]).toEqual(["file-write", "lookup", "publish", "web-search"]);
    expect(surfaces["second"]).toEqual(["lookup", "web-search"]);
    await Effect.runPromise(resolver.disposeAll);
  });
});

describe("narrowToolSurface", () => {
  test("ReadOnly keeps only tools declared read-only; unclassified custom tools are dropped", () => {
    const b = makeBuilder().withTools({ tools: [tool("mystery", false)] });
    // `mystery` declares read-only here; strip the flag to model an unclassified third-party tool.
    const s = asBuilderState(b);
    s._toolsOptions = {
      ...s._toolsOptions,
      tools: (s._toolsOptions?.tools ?? []).map((t) =>
        t.definition.name === "mystery" ? { ...t, definition: { ...t.definition, mutatesExternalState: undefined } } : t,
      ),
    };
    expect([...narrowToolSurface(b, { _tag: "ReadOnly" })].sort()).toEqual(["lookup", "web-search"]);
  });

  test("Allowlist never widens beyond what the agent already had", () => {
    const b = makeBuilder();
    expect([...narrowToolSurface(b, { _tag: "Allowlist", tools: ["lookup", "code-execute"] })]).toEqual(["lookup"]);
  });

  test("an empty Allowlist leaves no tools and does not fall back to unfiltered", () => {
    const b = makeBuilder();
    expect(narrowToolSurface(b, { _tag: "Allowlist", tools: [] })).toEqual([]);
    expect(exposedOf(b)).toEqual([]);
  });

  test("ReadOnly drops MCP servers and sub-agent tools", () => {
    const b = makeBuilder();
    const s = asBuilderState(b);
    s._mcpServers = [{ name: "m", transport: "stdio", command: "x" } as never];
    narrowToolSurface(b, { _tag: "ReadOnly" });
    expect(s._mcpServers).toEqual([]);
    expect(s._agentTools).toEqual([]);
  });

  test("AgentDefault leaves the surface untouched", () => {
    const b = makeBuilder();
    narrowToolSurface(b, { _tag: "AgentDefault" });
    expect(exposedOf(b)).toEqual(["file-write", "lookup", "publish", "web-search"]);
  });
});

describe("router lifecycle", () => {
  test("the router starts with agent.start() and stops with the handle", async () => {
    const hook = new WebhookChannelAdapter({ id: "hook-router", platform: "webhook", allowUnsigned: true });
    const agent = await ReactiveAgents.create()
      .withName("router-host")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .withGateway({ heartbeat: { intervalMs: 999_999, policy: "adaptive" } })
      .withChannels({
        adapters: [hook],
        routes: [{ id: "hooks", match: { channelId: "hook-router" }, target: { agentId: "support" } }],
        agents: { support: makeBuilder },
      })
      .build();

    expect(await agent.channelRouterStatus()).toBeNull();
    const handle = agent.start();
    const deadline = Date.now() + 5000;
    while ((await agent.channelRouterStatus()) === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    const status = await agent.channelRouterStatus();
    expect(status?.routes).toBe(1);
    expect(status?.channels.map((c) => c.id)).toEqual(["hook-router"]);
    expect(status?.durableStore).toBe(false);

    await handle.stop();
    expect(await agent.channelRouterStatus()).toBeNull();
    await agent.dispose();
  }, 20000);
});
