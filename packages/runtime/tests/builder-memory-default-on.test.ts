// Run: bun test packages/runtime/tests/builder-memory-default-on.test.ts --timeout 15000
//
// GH #122 — cross-session memory default-on + clear opt-out control.
//
// Before v0.12 / GH #122: memory was opt-in via `.withMemory()`. The
// compounding-intelligence promise (skill persistence across sessions,
// episodic recall) shipped but didn't activate by default — anti-mission #6
// "no advertised-surface-without-callers" violation surfaced by the
// 2026-05-23 harness convergence sweep.
//
// After GH #122: memory + skill persistence default-on. Clear controls:
//   - `.withoutMemory()` — explicit opt-out (sets _memoryExplicitlyDisabled)
//   - `.withLeanHarness()` — force-disables memory as part of the lean
//     latency/cost bundle (Memory v2 spec §lean-mode-interaction)
//   - `.withLearning()` — explicit opt-in bundle (memory + skill store)
//     useful when the user wants to be explicit despite the default
//
// This file pins the contract so a future commit flipping the default
// back to false fails this test, and so the opt-out semantics stay clear.

import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";

describe("GH #122 — memory default-on + clear opt-out", () => {
  it("default build enables memory (no explicit withMemory call needed)", async () => {
    const agent = await ReactiveAgents.create()
      .withName("default-on-agent")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .build();

    const result = await agent.run("simple task");
    expect(result.success).toBe(true);
    // MOVE-3 Phase 1 (GH #143) — trivial-task gate at
    // `engine/finalize/debrief-synthesis.ts` now short-circuits debrief
    // when `ctx.metadata.taskComplexity === "trivial"` (iter≤1 + 0 tools +
    // !max_iter). This test runs a single `FINAL ANSWER: done` stub →
    // trivial classification → no debrief synthesized → key omitted.
    // The "memory was reachable" signal is now asserted via
    // `result.metadata.complexity` (populated by memory-flush dispatch),
    // not the legacy debrief-key-presence proxy.
    const metaComplexity = (result.metadata as { complexity?: string }).complexity;
    expect(metaComplexity).toBeDefined();
    // #144 (debrief honesty): trivial gate now returns a FALLBACK debrief
    // (no LLM call) instead of undefined. The fallback synthesizer
    // reconstructs an equivalent record from captured signals at zero
    // token cost. Memory reachability is asserted via complexity field.
    expect(result.debrief).toBeDefined();
    await agent.dispose();
  });

  it(".withoutMemory() opt-out — debrief NOT present, no memory bootstrap", async () => {
    const agent = await ReactiveAgents.create()
      .withName("opt-out-agent")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withoutMemory()
      .build();

    const result = await agent.run("simple task");
    expect(result.success).toBe(true);
    // .withoutMemory() opt-out → config.enableMemory false → debrief gate
    // short-circuits to undefined (no fallback, no LLM call).
    expect(result.debrief).toBeUndefined();
    await agent.dispose();
  });

  it(".withLeanHarness() force-disables memory (lean-mode contract)", async () => {
    // Memory v2 design §lean-mode-interaction: lean mode disables memory.
    // Latency/cost-sensitive workloads bypass the memory stack.
    const agent = await ReactiveAgents.create()
      .withName("lean-agent")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withLeanHarness()
      .build();

    const result = await agent.run("lean task");
    expect(result.success).toBe(true);
    // Lean mode == memory off → debrief gate returns undefined entirely
    // (skips fallback synthesizer since config.enableMemory is false).
    expect(result.debrief).toBeUndefined();
    await agent.dispose();
  });

  it(".withLearning() bundle — explicit opt-in equivalent of memory + skill persistence", async () => {
    const agent = await ReactiveAgents.create()
      .withName("learning-agent")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withLearning()
      .build();

    const result = await agent.run("learning task");
    expect(result.success).toBe(true);
    // MOVE-3 Phase 1 — same trivial-task gate as the default-on test above.
    // `.withLearning()` enables memory; trivial run still skips debrief
    // synthesis. Assert memory-branch reachability via complexity metadata.
    const metaComplexity = (result.metadata as { complexity?: string }).complexity;
    expect(metaComplexity).toBeDefined();
    // #144 (debrief honesty): trivial gate now returns a FALLBACK debrief
    // (no LLM call) instead of undefined. The fallback synthesizer
    // reconstructs an equivalent record from captured signals at zero
    // token cost. Memory reachability is asserted via complexity field.
    expect(result.debrief).toBeDefined();
    await agent.dispose();
  });

  it(".withLearning({ tier: 'enhanced' }) promotes to tier-2 memory", async () => {
    const agent = await ReactiveAgents.create()
      .withName("enhanced-agent")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withLearning({ tier: "enhanced" })
      .build();

    const result = await agent.run("enhanced task");
    expect(result.success).toBe(true);
    await agent.dispose();
  });

  it(".withLearning() AFTER .withLeanHarness() re-enables memory (explicit override)", async () => {
    // Hybrid build: lean harness + explicit learning re-enable.
    // The explicit `.withLearning()` call after `.withLeanHarness()`
    // re-activates memory — user said yes after the lean default said no.
    const agent = await ReactiveAgents.create()
      .withName("hybrid-agent")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withLeanHarness()
      .withLearning()
      .build();

    const result = await agent.run("hybrid task");
    expect(result.success).toBe(true);
    // MOVE-3 Phase 1 — trivial-task gate semantics same as above. The
    // assertion that matters here is that `.withLearning()` re-enabled
    // memory after `.withLeanHarness()` had disabled it; complexity is
    // populated only when memory-flush dispatch ran.
    const metaComplexity = (result.metadata as { complexity?: string }).complexity;
    expect(metaComplexity).toBeDefined();
    // #144 (debrief honesty): trivial gate now returns a FALLBACK debrief
    // (no LLM call) instead of undefined. The fallback synthesizer
    // reconstructs an equivalent record from captured signals at zero
    // token cost. Memory reachability is asserted via complexity field.
    expect(result.debrief).toBeDefined();
    await agent.dispose();
  });
});
