// Run: bun test packages/runtime/tests/seam-channel-host-wiring.test.ts
//
// Seam pin: the runtime side of the always-on channel primitives. `.withChannels({ inbox, outbox,
// followUp })` reaches the router (status counts), the resolver registers the `follow-up` tool on
// the per-conversation agent, `takeFolded` drains at a tool-call boundary, and an interrupted turn
// aborts the running stream.
import { describe, expect, test } from "bun:test";
import { Effect, Fiber } from "effect";
import { WebhookChannelAdapter } from "@reactive-agents/channels";
import type { FollowUpPort, OpenSessionRequest, RoutedTurn } from "@reactive-agents/channels";
import { ReactiveAgents } from "../src/builder.js";
import type { ReactiveAgentBuilder } from "../src/builder.js";
import { makeChannelAgentResolver, type ChannelAgentHandle } from "../src/agent/channel-router-resolver.js";
import { asBuilderState } from "../src/builder/withers/_state.js";
import type { AgentStreamEvent } from "../src/stream-types.js";

const base = (exposure: OpenSessionRequest["toolExposure"] = { _tag: "AgentDefault" }, followUp?: FollowUpPort): OpenSessionRequest => ({
  routeId: "r1",
  role: "owner",
  target: { agentId: "a" },
  toolExposure: exposure,
  conversationKey: "chat-1",
  stateless: false,
  ...(followUp ? { followUp } : {}),
});

const port: FollowUpPort = {
  schedule: (r) => Effect.succeed({ id: "t1", dueAt: 1, note: r.note }),
  cancel: () => Effect.succeed(true),
  pending: () => Effect.succeed([]),
};

const turnOf = (extra: Partial<RoutedTurn> = {}): RoutedTurn => ({
  text: "go",
  parts: [],
  taskId: "t",
  sender: { platform: "telegram", userId: "1" },
  approval: { request: () => Effect.succeed("denied" as const) },
  message: {} as RoutedTurn["message"],
  ...extra,
});

type Loose = { readonly _tag: AgentStreamEvent["_tag"] } & Readonly<Record<string, unknown>>;
const ev = (e: Loose): AgentStreamEvent => e as AgentStreamEvent;

interface Harness {
  readonly builders: ReactiveAgentBuilder[];
  readonly disposed: string[];
}

const handleFor = (h: Harness, session: ChannelAgentHandle["session"]): ChannelAgentHandle => ({
  agentId: `agent-${h.builders.length}`,
  dispose: async () => {
    h.disposed.push(`agent-${h.builders.length}`);
  },
  session,
  run: async () => ({ output: "ok", agentId: "a", taskId: "t", metadata: { tokensUsed: 0, cost: 0 } }),
});

const idleSession: ChannelAgentHandle["session"] = () => ({ chat: async () => ({ message: "ok" }), end: async () => undefined });

const resolverFor = (h: Harness, session: ChannelAgentHandle["session"], perConversation = true) =>
  makeChannelAgentResolver({
    agents: { a: () => ReactiveAgents.create().withName("t").withProvider("test") },
    perConversation,
    build: async (b) => {
      h.builders.push(b);
      return handleFor(h, session);
    },
  });

const toolsOf = (b: ReactiveAgentBuilder) => asBuilderState(b)._toolsOptions?.tools ?? [];

describe("follow-up tool registration", () => {
  test("an owner conversation's agent gets the follow-up tool bound to its port", async () => {
    const h: Harness = { builders: [], disposed: [] };
    const resolver = resolverFor(h, idleSession);
    await Effect.runPromise(Effect.scoped(resolver.open(base({ _tag: "AgentDefault" }, port)).pipe(Effect.asVoid)));
    const entry = toolsOf(h.builders[0]!).find((t) => t.definition.name === "follow-up");
    expect(entry?.definition.mutatesExternalState).toBe(true);
    const out = await Effect.runPromise(entry!.handler({ in: "10m", note: "check" }) as Effect.Effect<{ ok: boolean; action: string }>);
    expect(out).toMatchObject({ ok: true, action: "scheduled" });
  });

  test("a ReadOnly surface never gets the follow-up tool", async () => {
    const h: Harness = { builders: [], disposed: [] };
    const resolver = resolverFor(h, idleSession);
    await Effect.runPromise(Effect.scoped(resolver.open(base({ _tag: "ReadOnly" }, port)).pipe(Effect.asVoid)));
    expect(toolsOf(h.builders[0]!).some((t) => t.definition.name === "follow-up")).toBe(false);
  });

  test("the per-conversation agent is disposed when its session closes", async () => {
    const h: Harness = { builders: [], disposed: [] };
    const resolver = resolverFor(h, idleSession);
    await Effect.runPromise(Effect.scoped(resolver.open(base()).pipe(Effect.asVoid)));
    expect(h.disposed).toHaveLength(1);
  });
});

describe("takeFolded at the tool-call boundary", () => {
  test("a tool result carries the folded texts once, and an idle turn drains nothing", async () => {
    const h: Harness = { builders: [], disposed: [] };
    const results: unknown[] = [];
    const resolver = makeChannelAgentResolver({
      agents: {
        a: () =>
          ReactiveAgents.create()
            .withName("t")
            .withProvider("test")
            .withTools({
              tools: [
                {
                  definition: {
                    name: "lookup",
                    description: "d",
                    parameters: [],
                    riskLevel: "low",
                    timeoutMs: 1000,
                    requiresApproval: false,
                    source: "function",
                  },
                  handler: () => Effect.succeed("found"),
                },
              ],
            }),
      },
      perConversation: true,
      build: async (b) => {
        h.builders.push(b);
        return handleFor(h, () => ({
          chat: async () => ({ message: "" }),
          end: async () => undefined,
          runStream: async function* () {
            const lookup = toolsOf(b).find((t) => t.definition.name === "lookup")!;
            results.push(await Effect.runPromise(lookup.handler({}) as Effect.Effect<unknown>));
            results.push(await Effect.runPromise(lookup.handler({}) as Effect.Effect<unknown>));
            yield ev({ _tag: "StreamCompleted", output: "done", metadata: { tokensUsed: 1, cost: 0 } });
          },
        }));
      },
    });
    const queue = ["also tests please"];
    const takeFolded = () => queue.splice(0);
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* resolver.open(base());
          const reply = yield* session.send(turnOf({ takeFolded }));
          expect(reply.text).toBe("done");
        }),
      ),
    );
    expect(results[0]).toMatchObject({ result: "found", userMessages: ["also tests please"] });
    expect(results[1]).toBe("found");
  });
});

describe("interruption", () => {
  test("interrupting send aborts the running stream's signal", async () => {
    const h: Harness = { builders: [], disposed: [] };
    let seen: AbortSignal | undefined;
    const resolver = resolverFor(
      h,
      () => ({
        chat: async () => ({ message: "" }),
        end: async () => undefined,
        runStream: (_t, o) => {
          seen = o.signal;
          return (async function* (): AsyncGenerator<AgentStreamEvent> {
            await new Promise<void>((resolve) => o.signal?.addEventListener("abort", () => resolve()));
            yield ev({ _tag: "StreamCancelled", reason: "x" });
          })();
        },
      }),
    );
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* resolver.open(base());
          const fiber = yield* Effect.fork(session.send(turnOf({ takeFolded: () => [] })));
          yield* Effect.sleep("30 millis");
          yield* Fiber.interrupt(fiber);
        }),
      ),
    );
    expect(seen?.aborted).toBe(true);
  });
});

describe(".withChannels inbox / outbox / followUp reach the router", () => {
  test("status carries inbox, outbox and timers counts; the store closes with the router", async () => {
    const hook = new WebhookChannelAdapter({ id: "hook-wiring", platform: "webhook", allowUnsigned: true });
    const agent = await ReactiveAgents.create()
      .withName("wiring-host")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .withGateway({ heartbeat: { intervalMs: 999_999, policy: "adaptive" } })
      .withChannels({
        adapters: [hook],
        routes: [{ id: "hooks", match: { channelId: "hook-wiring" }, target: { agentId: "support" } }],
        agents: { support: () => ReactiveAgents.create().withName("t").withProvider("test").withTestScenario([{ text: "FINAL ANSWER: ok" }]) },
        inbox: { path: ":memory:" },
        outbox: { maxAttempts: 3, minGapMs: 0 },
        followUp: true,
      })
      .build();
    const handle = agent.start();
    const deadline = Date.now() + 5000;
    while ((await agent.channelRouterStatus()) === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    const status = await agent.channelRouterStatus();
    expect(status?.durableStore).toBe(true);
    expect(status?.inbox).toBeDefined();
    expect(status?.outbox).toBeDefined();
    expect(status?.timers).toBeDefined();
    await handle.stop();
    await agent.dispose();
  }, 20000);
});
