/**
 * debrief-fork.test.ts — debrief-off-critical-path (2026-06-12).
 *
 * The post-answer LLM debrief no longer blocks run()'s return: the engine forks
 * it. This pins the observable contract:
 *   (1) a non-trivial memory-enabled run exposes result.debrief (the instant
 *       deterministic fallback) AND result.debriefRich() (awaits the forked
 *       rich synthesis);
 *   (2) debriefRich() resolves to a debrief;
 *   (3) dispose() joins the pending debrief fiber without hanging;
 *   (4) a non-memory run schedules no debrief fork (debriefRich absent).
 */
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/builder.js";

// A long final answer (>100 chars) so the trivial-debrief gate does NOT fire and
// the rich LLM debrief path is scheduled (forked).
const LONG_ANSWER =
  "FINAL ANSWER: Prompt caching reuses the stable prefix of the conversation " +
  "across turns so the provider only re-encodes the small changing suffix, which " +
  "cuts both latency and input-token cost on multi-turn agent loops substantially.";

describe("debrief — forked off critical path", () => {
  it("exposes fallback debrief + debriefRich() on a non-trivial memory run", async () => {
    const agent = await ReactiveAgents.create()
      .withName("debrief-fork-on")
      .withTestScenario([{ text: LONG_ANSWER }])
      .withReasoning()
      .withMemory()
      .build();
    try {
      const result = await agent.run("explain prompt caching in detail");

      // Instant fallback present (contract: never null on memory runs).
      expect(result.debrief).toBeDefined();
      // Lazy rich accessor present.
      expect(typeof result.debriefRich).toBe("function");

      const rich = await result.debriefRich!();
      expect(rich).toBeDefined();
    } finally {
      await agent.dispose();
    }
  }, 30000);

  it("dispose() joins the pending debrief fiber without hanging", async () => {
    const agent = await ReactiveAgents.create()
      .withName("debrief-fork-dispose")
      .withTestScenario([{ text: LONG_ANSWER }])
      .withReasoning()
      .withMemory()
      .build();

    const result = await agent.run("explain prompt caching in detail");
    expect(result.debrief).toBeDefined();

    // dispose() immediately after run() must await the forked persist, not drop
    // it — and must resolve (no hang).
    const t0 = Date.now();
    await agent.dispose();
    expect(Date.now() - t0).toBeLessThan(20000);
  }, 30000);

  it("schedules no debrief fork when memory is disabled", async () => {
    // Memory is default-ON, so the fork fires on a normal reasoning run; the
    // opt-out path (.withoutMemory()) is what suppresses the debrief entirely.
    const agent = await ReactiveAgents.create()
      .withName("debrief-fork-off")
      .withTestScenario([{ text: LONG_ANSWER }])
      .withReasoning()
      .withoutMemory()
      .build();
    try {
      const result = await agent.run("explain prompt caching in detail");
      // No memory → no debrief produced → no rich accessor.
      expect(result.debriefRich).toBeUndefined();
    } finally {
      await agent.dispose();
    }
  }, 30000);
});
