/**
 * seam: `ChatModeChanged` is published once per ACTUAL session mode change
 * (never for a no-op set), carrying the session id, and reaches the agent's
 * EventBus for engine-backed `agent.session()` sessions.
 *
 * Run: bun test packages/runtime/tests/seam-chat-mode-changed.test.ts --timeout 15000
 */
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import type { ChatModeChangedEvent } from "@reactive-agents/core";
import { EventBus } from "@reactive-agents/core";
import { ChatEngine } from "../src/chat/engine.js";
import { ReactiveAgents } from "../src/builder.js";

const make = (mode?: "plan" | "execute") => {
  const events: ChatModeChangedEvent[] = [];
  const engine = new ChatEngine(
    { complete: async () => ({ message: "d" }), publishMode: async (e) => void events.push(e) },
    { sessionId: "s-1", ...(mode ? { mode } : {}) },
  );
  return { engine, events };
};

describe("seam: ChatModeChanged publication", () => {
  test("one event per actual change; no-op sets publish nothing", () => {
    const { engine, events } = make();
    engine.setMode("execute"); // no-op: default is execute
    expect(events).toEqual([]);
    engine.setMode("plan");
    expect(events.map((e) => [e._tag, e.sessionId, e.from, e.to])).toEqual([["ChatModeChanged", "s-1", "execute", "plan"]]);
    expect(typeof events[0]!.timestamp).toBe("number");
    engine.setMode("plan"); // no-op
    expect(events).toHaveLength(1);
    engine.setMode("execute");
    expect(events.map((e) => `${e.from}>${e.to}`)).toEqual(["execute>plan", "plan>execute"]);
  });

  test("seeded mode is the baseline for `from`", () => {
    const { engine, events } = make("plan");
    engine.setMode("plan");
    expect(events).toEqual([]);
    engine.setMode("execute");
    expect(events.map((e) => `${e.from}>${e.to}`)).toEqual(["plan>execute"]);
  });

  test("a rejecting publish port never throws into setMode", async () => {
    const engine = new ChatEngine(
      { complete: async () => ({ message: "d" }), publishMode: async () => { throw new Error("bus down"); } },
      { sessionId: "s-2" },
    );
    expect(() => engine.setMode("plan")).not.toThrow();
    await new Promise((r) => setTimeout(r, 5));
    expect(engine.mode()).toBe("plan");
  });

  test("agent.session().setMode reaches the agent EventBus once per change", async () => {
    const agent = await ReactiveAgents.create().withName("mode-evt").withProvider("test").withModel("test-model").build();
    try {
      const seen: ChatModeChangedEvent[] = [];
      await agent.runtime.runPromise(
        EventBus.pipe(Effect.flatMap((bus) => bus.on("ChatModeChanged", (e) => Effect.sync(() => void seen.push(e))))),
      );
      const s = agent.session({ id: "sess-bus" });
      s.setMode("plan");
      s.setMode("plan");
      s.setMode("execute");
      await new Promise((r) => setTimeout(r, 20));
      expect(seen.map((e) => [e.sessionId, e.from, e.to])).toEqual([
        ["sess-bus", "execute", "plan"],
        ["sess-bus", "plan", "execute"],
      ]);
    } finally { await agent.dispose(); }
  });
});
