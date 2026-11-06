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
import { isRunMeterSettled, type RunBudgetMeter } from "@reactive-agents/reasoning";
import { makeChildSpendProbe } from "../src/builder/build-effect/child-spend-probe.js";

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

  it("debrief LLM call joins the run (taskId) and its spend is readable after the fact", async () => {
    // tokensUsed/llmCalls count the run up to its result; the forked debrief
    // call is reported separately. Billed = result + debrief, all on the run's taskId.
    const agent = await ReactiveAgents.create()
      .withName("debrief-fork-spend")
      .withTestScenario([{ text: LONG_ANSWER }])
      .withReasoning()
      .withMemory()
      .build();
    const calls: Array<{ taskId: string; tokens: number; tokensIn: number; tokensOut: number }> = [];
    const debriefEvents: Array<{ taskId: string; synthesis: unknown }> = [];
    await agent.subscribe((event) => {
      if (event._tag === "LLMRequestCompleted") {
        calls.push({ taskId: event.taskId, tokens: event.tokensUsed, tokensIn: event.tokensIn ?? 0, tokensOut: event.tokensOut ?? 0 });
      }
      if (event._tag === "DebriefCompleted") {
        // Core's DebriefCompleted type does not declare synthesisTokens yet;
        // the runtime value carries it, so read it through an `in` guard.
        const m = event.debrief.metrics;
        debriefEvents.push({ taskId: event.taskId, synthesis: "synthesisTokens" in m ? m.synthesisTokens : undefined });
      }
    });
    try {
      const result = await agent.run("explain prompt caching in detail");
      const rich = await result.debriefRich!();
      const synthesis = rich?.metrics.synthesisTokens;
      expect(synthesis).toBeDefined();
      expect(synthesis!.calls).toBe(1);
      // Every billed call carries the run's taskId (no "llm-direct" placeholder).
      expect(calls.map((c) => c.taskId)).toEqual(calls.map(() => String(result.taskId)));
      const billed = calls.reduce(
        (a, c) => ({ tokens: a.tokens + c.tokens, in: a.in + c.tokensIn, out: a.out + c.tokensOut, calls: a.calls + 1 }),
        { tokens: 0, in: 0, out: 0, calls: 0 },
      );
      expect(billed.tokens).toBe(result.metadata.tokensUsed + synthesis!.total);
      expect(billed.in).toBe((result.metadata.inputTokens ?? 0) + synthesis!.input);
      expect(billed.out).toBe((result.metadata.outputTokens ?? 0) + synthesis!.output);
      expect(billed.calls).toBe((result.metadata.llmCalls ?? 0) + synthesis!.calls);
      // Telemetry fact: DebriefCompleted carries the same spend, keyed to the run.
      expect(debriefEvents).toEqual([{ taskId: String(result.taskId), synthesis }]);
    } finally {
      await agent.dispose();
    }
  }, 30000);

  it("forked debrief spend never lands on the settled run meter (no detach needed)", async () => {
    // The engine settles the run meter (settleRunSpend → settleRunMeter) before
    // forking the debrief, and the debrief no longer detaches CurrentRunBudget.
    // Pin: after the debrief's LLM call completes, the run meter still equals
    // the reported spend. RED if settle is cut: the meter grows by synthesis.
    const probe = makeChildSpendProbe();
    let builder = ReactiveAgents.create()
      .withName("debrief-fork-settled")
      .withTestScenario([{ text: LONG_ANSWER }])
      .withReasoning()
      .withMemory()
      .withBudget({ tokenLimit: 1_000_000 });
    for (const hook of probe.hooks) builder = builder.withHook(hook);
    const agent = await builder.build();
    try {
      const result = await agent.run("explain prompt caching in detail");
      const rich = await result.debriefRich!();
      const synthesis = rich?.metrics.synthesisTokens;
      // Precondition: the debrief really spent tokens after the result.
      expect(synthesis).toBeDefined();
      expect(synthesis!.total).toBeGreaterThan(0);
      const meter = probe.read() as RunBudgetMeter;
      expect(meter.tokens).toBeGreaterThan(0);
      expect(meter.tokens).toBe(result.metadata.tokensUsed);
      expect(meter.llmCalls).toBe(result.metadata.llmCalls);
      expect(isRunMeterSettled(meter)).toBe(true);
      expect(result.metadata.runBudgetSpend?.tokens).toBe(result.metadata.tokensUsed);
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
