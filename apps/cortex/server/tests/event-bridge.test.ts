import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import type { ServerWebSocket } from "bun";
import { CortexEventBridge, CortexEventBridgeLive } from "../services/event-bridge.js";

function mockSocket(sent: string[], failSend = false): ServerWebSocket<unknown> {
  return {
    send(data: string) {
      if (failSend) throw new Error("send failed");
      sent.push(data);
    },
  } as unknown as ServerWebSocket<unknown>;
}

describe("CortexEventBridge", () => {
  it("starts with zero subscribers per agent", async () => {
    const program = Effect.gen(function* () {
      const b = yield* CortexEventBridge;
      return yield* b.subscriberCount("any");
    });
    const n = await Effect.runPromise(program.pipe(Effect.provide(CortexEventBridgeLive)));
    expect(n).toBe(0);
  });

  it("subscribe increments subscriberCount", async () => {
    const sent: string[] = [];
    const ws = mockSocket(sent);
    const program = Effect.gen(function* () {
      const b = yield* CortexEventBridge;
      yield* b.subscribe("agent-a", ws);
      return yield* b.subscriberCount("agent-a");
    });
    const n = await Effect.runPromise(program.pipe(Effect.provide(CortexEventBridgeLive)));
    expect(n).toBe(1);
  });

  it("unsubscribe decrements subscriberCount", async () => {
    const ws = mockSocket([]);
    const program = Effect.gen(function* () {
      const b = yield* CortexEventBridge;
      yield* b.subscribe("agent-b", ws);
      expect(yield* b.subscriberCount("agent-b")).toBe(1);
      yield* b.unsubscribe("agent-b", ws);
      return yield* b.subscriberCount("agent-b");
    });
    const n = await Effect.runPromise(program.pipe(Effect.provide(CortexEventBridgeLive)));
    expect(n).toBe(0);
  });

  it("broadcast delivers JSON message to all subscribers", async () => {
    const a: string[] = [];
    const b: string[] = [];
    const ws1 = mockSocket(a);
    const ws2 = mockSocket(b);
    const program = Effect.gen(function* () {
      const bridge = yield* CortexEventBridge;
      yield* bridge.subscribe("c", ws1);
      yield* bridge.subscribe("c", ws2);
      yield* bridge.broadcast("c", {
        v: 1,
        ts: 1,
        agentId: "c",
        runId: "r",
        source: "eventbus",
        type: "TaskCreated",
        payload: { taskId: "t" },
      });
    });
    await Effect.runPromise(program.pipe(Effect.provide(CortexEventBridgeLive)));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(JSON.parse(a[0]!)).toMatchObject({ type: "TaskCreated", runId: "r" });
  });

  it("broadcast swallows send errors", async () => {
    const ws = mockSocket([], true);
    const program = Effect.gen(function* () {
      const bridge = yield* CortexEventBridge;
      yield* bridge.subscribe("d", ws);
      yield* bridge.broadcast("d", {
        v: 1,
        ts: 1,
        agentId: "d",
        runId: "r",
        source: "eventbus",
        type: "X",
        payload: {},
      });
    });
    await expect(
      Effect.runPromise(program.pipe(Effect.provide(CortexEventBridgeLive))),
    ).resolves.toBeUndefined();
  });

  it("replayTo sends one message per event row", async () => {
    const sent: string[] = [];
    const ws = mockSocket(sent);
    const program = Effect.gen(function* () {
      const bridge = yield* CortexEventBridge;
      yield* bridge.replayTo("a", "r1", ws, [
        { ts: 10, type: "TaskCreated", payload: '{"taskId":"x"}' },
        { ts: 20, type: "AgentStarted", payload: "{}" },
      ]);
    });
    await Effect.runPromise(program.pipe(Effect.provide(CortexEventBridgeLive)));
    expect(sent).toHaveLength(2);
    const m0 = JSON.parse(sent[0]!) as { type: string; payload: unknown };
    expect(m0.type).toBe("TaskCreated");
    expect(m0.payload).toEqual({ taskId: "x" });
  });

  it("isolates subscribers by agentId", async () => {
    const sent: string[] = [];
    const ws = mockSocket(sent);
    const program = Effect.gen(function* () {
      const bridge = yield* CortexEventBridge;
      yield* bridge.subscribe("only-here", ws);
      yield* bridge.broadcast("other", {
        v: 1,
        ts: 1,
        agentId: "other",
        runId: "r",
        source: "eventbus",
        type: "X",
        payload: {},
      });
    });
    await Effect.runPromise(program.pipe(Effect.provide(CortexEventBridgeLive)));
    expect(sent).toHaveLength(0);
  });
});
