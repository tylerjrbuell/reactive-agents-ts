// Run: bun test packages/runtime/tests/seam-gateway-lifecycle.test.ts
//
// Seam pins for the gateway lifecycle (audit F3/F4/F9/F11/F16, 2026-11-12):
// F3  one Scope per gateway: stop() during async startup leaks no timer, subscription, or port
// F4  a rejecting session.end() finalizer is swallowed, never dies the scope close
// F9  router host rejects with the TAGGED error; a router that fails to start fails the gateway
// F11 channel dedup keys on delivery identity, expires by Clock, and schedules no timer per message
// F16 non-string webhook `metadata.instruction` is ignored, never cast
import { describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { Effect, Exit, TestClock, TestContext } from "effect";
import { RoutingError } from "@reactive-agents/channels";
import { ReactiveAgents } from "../src/builder.js";
import { makeGatewayLifecycle } from "../src/agent/gateway-lifecycle.js";
import { makeChannelAgentResolver, type ChannelAgentHandle } from "../src/agent/channel-router-resolver.js";
import { startChannelRouterHost } from "../src/agent/channel-router-host.js";
import { makeDeliveryDedup, deliveryKey } from "../src/agent/channel-dedup.js";
import { subscribeChannelHandler } from "../src/agent/gateway-driver.js";
import { instructionOf } from "../src/agent/gateway-ingress.js";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("F3 gateway lifecycle scope", () => {
  test("cleanups run newest first; a failing cleanup does not stop the rest", async () => {
    const order: string[] = [];
    const errors: string[] = [];
    const lc = makeGatewayLifecycle((label) => errors.push(label));
    await lc.onClose("a", () => void order.push("a"));
    await lc.onClose("boom", async () => {
      throw new Error("cleanup failed");
    });
    await lc.onClose("c", () => void order.push("c"));
    await lc.close();
    await lc.close(); // idempotent
    expect(order).toEqual(["c", "a"]);
    expect(errors).toEqual(["boom"]);
  });

  test("a cleanup registered after close runs immediately (resource landed after stop)", async () => {
    const lc = makeGatewayLifecycle(() => undefined);
    await lc.close();
    let ran = false;
    await lc.onClose("late", () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  test("stop() before async startup resolves leaves no heartbeat interval running", async () => {
    const HB = 7_777;
    const created = new Set<unknown>();
    const cleared = new Set<unknown>();
    const realSet = globalThis.setInterval;
    const realClear = globalThis.clearInterval;
    globalThis.setInterval = ((fn: () => void, ms?: number, ...rest: unknown[]) => {
      const id = (realSet as (...a: unknown[]) => unknown)(fn, ms, ...rest);
      if (ms === HB) created.add(id);
      return id;
    }) as typeof setInterval;
    globalThis.clearInterval = ((id: unknown) => {
      cleared.add(id);
      return (realClear as (i: unknown) => void)(id);
    }) as typeof clearInterval;
    try {
      const agent = await ReactiveAgents.create()
        .withName("early-stop")
        .withProvider("test")
        .withTestScenario([{ text: "FINAL ANSWER: ok" }])
        .withGateway({ heartbeat: { intervalMs: HB } })
        .build();
      const handle = agent.start();
      await handle.stop(); // lands before the async startup has acquired anything
      await tick(400); // startup keeps going in the background
      for (const id of created) expect(cleared.has(id)).toBe(true);
      await agent.dispose();
    } finally {
      globalThis.setInterval = realSet;
      globalThis.clearInterval = realClear;
    }
  }, 20000);

  test("stop() before startup resolves leaves the ingress port unbound", async () => {
    const port = await new Promise<number>((resolve) => {
      const probe = createServer();
      probe.listen(0, () => {
        const p = (probe.address() as { port: number }).port;
        probe.close(() => resolve(p));
      });
    });
    const agent = await ReactiveAgents.create()
      .withName("early-stop-ingress")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .withGateway({
        heartbeat: { intervalMs: 999_999 },
        port,
        webhooks: [{ path: "/hook", adapter: "generic", secret: "s3cret" }],
      })
      .build();
    const handle = agent.start();
    await handle.stop();
    await tick(400);
    const listening = await fetch(`http://127.0.0.1:${port}/hook`, { method: "POST", body: "{}" }).then(
      () => true,
      () => false,
    );
    expect(listening).toBe(false);
    await agent.dispose();
  }, 20000);
});

describe("F4 route-session finalizer", () => {
  const doubleWithEnd = (end: () => Promise<void>): ChannelAgentHandle => ({
    agentId: "a",
    dispose: async () => undefined,
    session: () => ({ chat: async () => ({ message: "ok" }), end }),
    run: async () => ({ output: "ok", agentId: "a", taskId: "t", metadata: { tokensUsed: 0, cost: 0 } }),
  });

  test("a rejecting end() does not die the scope close, and later sessions still close", async () => {
    let secondEnded = false;
    let calls = 0;
    const resolver = makeChannelAgentResolver({
      agents: { support: () => ({}) as never },
      build: async () =>
        doubleWithEnd(async () => {
          calls += 1;
          if (calls === 1) throw new Error("end failed");
          secondEnded = true;
        }),
    });
    const req = (key: string) => ({
      routeId: "r1",
      role: "sender" as const,
      target: { agentId: "support" },
      toolExposure: { _tag: "AgentDefault" as const },
      conversationKey: key,
      stateless: false,
    });
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          yield* resolver.open(req("c1"));
          yield* resolver.open(req("c2"));
        }),
      ),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(secondEnded).toBe(true);
    await Effect.runPromise(resolver.disposeAll);
  });
});

describe("F9 router host failure modes", () => {
  const badRoute = [{ id: "r1", match: { channelId: "missing" }, target: { agentId: "support" } }];

  test("a router start failure rejects with the tagged RoutingError, not a FiberFailure", async () => {
    const err = await startChannelRouterHost({
      config: { adapters: [], routes: badRoute, agents: {} } as never,
      log: () => undefined,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RoutingError);
    expect((err as RoutingError).reason).toBe("unknown_channel");
  });

  test("a gateway whose router fails to start stops and reports the error in its summary", async () => {
    const agent = await ReactiveAgents.create()
      .withName("router-fails")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .withGateway({ heartbeat: { intervalMs: 999_999 } })
      .withChannels({ adapters: [], routes: badRoute as never, agents: {} })
      .build();
    const handle = agent.start();
    const summary = await handle.done;
    expect(summary.error).toContain("channel router failed to start");
    expect(summary.error).toContain("no channel missing");
    await agent.dispose();
  }, 20000);
});

describe("F11 channel dedup", () => {
  const msg = { sender: "u1", message: "yes" };

  test("same delivery is a duplicate; a repeat with a new timestamp is not; entries expire by Clock", async () => {
    const program = Effect.gen(function* () {
      const dedup = yield* makeDeliveryDedup(30_000);
      const first = yield* dedup.seen(deliveryKey({ ...msg, timestamp: 1 }));
      const echo = yield* dedup.seen(deliveryKey({ ...msg, timestamp: 1 }));
      const repeat = yield* dedup.seen(deliveryKey({ ...msg, timestamp: 2 }));
      yield* TestClock.adjust("31 seconds");
      const afterTtl = yield* dedup.seen(deliveryKey({ ...msg, timestamp: 1 }));
      return { first, echo, repeat, afterTtl };
    });
    const result = await Effect.runPromise(program.pipe(Effect.provide(TestContext.TestContext)));
    expect(result).toEqual({ first: false, echo: true, repeat: false, afterTtl: false });
  });

  test("subscriber processes an identical repeat, drops the echo, and schedules no per-message timer", async () => {
    type Handler = (e: Record<string, unknown>) => Effect.Effect<void>;
    let handler: Handler | undefined;
    const processed: string[] = [];
    const eb = {
      on: (_tag: string, h: Handler) =>
        Effect.sync(() => {
          handler = h;
          return () => undefined;
        }),
    };
    const gw = {
      processEvent: (e: { payload: { message: string } }) =>
        Effect.sync(() => {
          processed.push(e.payload.message);
          return { action: "skip" as const };
        }),
    };
    const timeouts: Array<number | undefined> = [];
    const realTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) => {
      timeouts.push(ms);
      return (realTimeout as (...a: unknown[]) => unknown)(fn, ms, ...rest);
    }) as typeof setTimeout;
    try {
      await subscribeChannelHandler({
        eb: eb as never,
        gw: gw as never,
        glog: () => undefined,
        channelMode: "chat",
        channelOutboundToolGuidance: () => "",
        queue: {} as never,
        chatManager: {} as never,
        runtime: { runPromise: (e: Effect.Effect<unknown>) => Effect.runPromise(e) } as never,
        agentId: "a",
        getStopped: () => false,
        incrementChatTurns: () => undefined,
      });
      const base = { _tag: "ChannelMessageReceived", sender: "u1", platform: "signal", message: "yes", mcpServer: "m" };
      for (const timestamp of [100, 100, 200]) {
        await Effect.runPromise(handler!({ ...base, timestamp }));
      }
    } finally {
      globalThis.setTimeout = realTimeout;
    }
    expect(processed).toEqual(["yes", "yes"]); // echo (same timestamp) dropped, repeat kept
    expect(timeouts.filter((ms) => ms === 30_000)).toEqual([]);
  });
});

describe("F16 webhook instruction accessor", () => {
  const ev = (instruction: unknown) => ({ metadata: { instruction } }) as never;
  test("only a string instruction is used", () => {
    expect(instructionOf(ev("do it"))).toBe("do it");
    expect(instructionOf(ev(42))).toBeUndefined();
    expect(instructionOf(ev({ a: 1 }))).toBeUndefined();
    expect(instructionOf(ev(undefined))).toBeUndefined();
  });
});
