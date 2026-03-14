/**
 * IterationProgress Events Tests
 *
 * Verifies that IterationProgress events are emitted during runStream()
 * and have the correct shape and ordering relative to StreamCompleted.
 */

import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/builder.js";
import type { AgentStreamEvent } from "../src/stream-types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function collectStreamEvents(
  builder: ReturnType<typeof ReactiveAgents.create>,
  input = "test task",
): Promise<AgentStreamEvent[]> {
  const agent = await builder.build();
  const events: AgentStreamEvent[] = [];
  try {
    for await (const event of agent.runStream(input)) {
      events.push(event);
    }
  } finally {
    await agent.dispose();
  }
  return events;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("IterationProgress events in runStream()", () => {
  it("at least one IterationProgress event is emitted during a run", async () => {
    const events = await collectStreamEvents(
      ReactiveAgents.create()
        .withTestScenario([{ text: "FINAL ANSWER: done" }])
        .withReasoning()
        .withMaxIterations(3),
    );

    const progressEvents = events.filter((e) => e._tag === "IterationProgress");
    expect(progressEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("all IterationProgress events have iteration >= 1", async () => {
    const events = await collectStreamEvents(
      ReactiveAgents.create()
        .withTestScenario([{ text: "FINAL ANSWER: done" }])
        .withReasoning()
        .withMaxIterations(3),
    );

    const progressEvents = events.filter((e) => e._tag === "IterationProgress");
    expect(progressEvents.length).toBeGreaterThanOrEqual(1);

    for (const event of progressEvents) {
      if (event._tag === "IterationProgress") {
        expect(event.iteration).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("IterationProgress events have a positive maxIterations field", async () => {
    // The maxIterations on the event comes from the reasoning kernel's state.meta.
    // We verify it is a positive number (not zero or negative).
    const events = await collectStreamEvents(
      ReactiveAgents.create()
        .withTestScenario([{ text: "FINAL ANSWER: done" }])
        .withReasoning()
        .withMaxIterations(5),
    );

    const progressEvents = events.filter((e) => e._tag === "IterationProgress");
    expect(progressEvents.length).toBeGreaterThanOrEqual(1);

    for (const event of progressEvents) {
      if (event._tag === "IterationProgress") {
        expect(event.maxIterations).toBeGreaterThan(0);
        expect(typeof event.maxIterations).toBe("number");
      }
    }
  });

  it("StreamCompleted is emitted after IterationProgress events", async () => {
    const events = await collectStreamEvents(
      ReactiveAgents.create()
        .withTestScenario([{ text: "FINAL ANSWER: done" }])
        .withReasoning()
        .withMaxIterations(3),
    );

    const completedIndex = events.findIndex((e) => e._tag === "StreamCompleted");
    expect(completedIndex).toBeGreaterThanOrEqual(0);

    const progressEvents = events
      .map((e, i) => ({ event: e, index: i }))
      .filter(({ event }) => event._tag === "IterationProgress");

    // All IterationProgress events must come before StreamCompleted
    for (const { index } of progressEvents) {
      expect(index).toBeLessThan(completedIndex);
    }
  });

  it("stream always terminates with StreamCompleted (not hanging)", async () => {
    const events = await collectStreamEvents(
      ReactiveAgents.create()
        .withTestScenario([{ text: "FINAL ANSWER: done" }])
        .withReasoning()
        .withMaxIterations(3),
    );

    const lastEvent = events[events.length - 1];
    expect(lastEvent).toBeDefined();
    // Last event should be StreamCompleted (or StreamError on failure — both are terminal)
    expect(["StreamCompleted", "StreamError"]).toContain(lastEvent!._tag);
  });

  it("IterationProgress events have a status field", async () => {
    const events = await collectStreamEvents(
      ReactiveAgents.create()
        .withTestScenario([{ text: "FINAL ANSWER: done" }])
        .withReasoning()
        .withMaxIterations(3),
    );

    const progressEvents = events.filter((e) => e._tag === "IterationProgress");
    expect(progressEvents.length).toBeGreaterThanOrEqual(1);

    for (const event of progressEvents) {
      if (event._tag === "IterationProgress") {
        expect(typeof event.status).toBe("string");
      }
    }
  });

  it("iteration numbers are monotonically increasing across IterationProgress events", async () => {
    const events = await collectStreamEvents(
      ReactiveAgents.create()
        .withTestScenario([{ text: "FINAL ANSWER: done" }])
        .withReasoning()
        .withMaxIterations(5),
    );

    const progressEvents = events
      .filter((e) => e._tag === "IterationProgress")
      .map((e) => (e as Extract<AgentStreamEvent, { _tag: "IterationProgress" }>).iteration);

    // If multiple progress events, iteration values should be non-decreasing
    for (let i = 1; i < progressEvents.length; i++) {
      expect(progressEvents[i]!).toBeGreaterThanOrEqual(progressEvents[i - 1]!);
    }
  });
});
