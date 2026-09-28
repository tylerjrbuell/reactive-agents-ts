// GH #224 — end-to-end delivery for `ReactiveAgent.subscribe()` / `.on()`.
//
// `subscribe()` used to carry `Effect.catchAll(() => Effect.succeed(() => {}))`
// on both overloads. That clause was DEAD CODE: `EventBus.subscribe/on` are
// typed `Effect<() => void, never>`, and a missing `EventBus` is a Context
// DEFECT (which `catchAll` cannot catch). The clauses were deleted; this test
// pins the real delivery + unsubscribe contract they falsely claimed to guard.

import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";
import type { AgentEvent } from "@reactive-agents/core";

const SIMPLE_REPLY = [{ text: "The answer is 42." }];

describe("ReactiveAgent.subscribe delivery (GH #224)", () => {
  it("catch-all subscribe receives run events and returns an unsubscribe function", async () => {
    const events: AgentEvent[] = [];
    const agent = await ReactiveAgents.create()
      .withName("subscribe-catch-all")
      .withTestScenario(SIMPLE_REPLY)
      .build();

    const unsub = await agent.subscribe((event) => {
      events.push(event);
    });
    expect(typeof unsub).toBe("function");

    await agent.run("What is the answer?");
    unsub();

    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e._tag === "AgentCompleted")).toBe(true);
    await agent.dispose();
  });

  it("delivers no further events after unsubscribe()", async () => {
    const events: AgentEvent[] = [];
    const agent = await ReactiveAgents.create()
      .withName("subscribe-unsub")
      .withTestScenario(SIMPLE_REPLY)
      .build();

    const unsub = await agent.subscribe((event) => {
      events.push(event);
    });

    await agent.run("First task");
    const countAfterFirst = events.length;
    expect(countAfterFirst).toBeGreaterThan(0);

    unsub();

    await agent.run("Second task");
    expect(events.length).toBe(countAfterFirst);
    await agent.dispose();
  });

  it("tag-filtered subscribe('AgentCompleted') delivers only matching events", async () => {
    const events: AgentEvent[] = [];
    const agent = await ReactiveAgents.create()
      .withName("subscribe-tag-filtered")
      .withTestScenario(SIMPLE_REPLY)
      .build();

    const unsub = await agent.subscribe("AgentCompleted", (event) => {
      events.push(event);
    });

    await agent.run("What is the answer?");
    unsub();

    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e._tag === "AgentCompleted")).toBe(true);
    await agent.dispose();
  });

  it("agent.on('AgentCompleted') delivers the same narrowed events", async () => {
    const events: AgentEvent[] = [];
    const agent = await ReactiveAgents.create()
      .withName("on-tag-filtered")
      .withTestScenario(SIMPLE_REPLY)
      .build();

    const unsub = await agent.on("AgentCompleted", (event) => {
      events.push(event);
    });
    expect(typeof unsub).toBe("function");

    await agent.run("What is the answer?");
    unsub();

    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e._tag === "AgentCompleted")).toBe(true);
    await agent.dispose();
  });
});
