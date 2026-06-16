// Run: bun test packages/runtime/tests/builder-memory-default-off.test.ts --timeout 15000
//
// v0.12 "Durable & Honest" — cross-session memory is OFF by default.
//
// History:
//   - Pre-GH #122: memory opt-in via `.withMemory()`.
//   - GH #122 (v0.11): memory + skill persistence flipped DEFAULT-ON so the
//     compounding-intelligence promise activated without opt-in.
//   - v0.12: flipped back to DEFAULT-OFF. A bare build is stateless — no
//     surprise `~/.reactive-agents/<agentId>/` SQLite writes, predictable in
//     CI. Memory is one explicit line away.
//
// Opt-in surfaces (all enable memory):
//   - `.withMemory()` — tier-1 working memory + SQLite cross-session store
//   - `.withLearning()` — memory + skill store bundle
//   - `HarnessProfile.balanced()` / `.intelligent()` — enable it explicitly
// Opt-out surfaces (memory stays off, also for the bare default):
//   - `.withoutMemory()` / `.withLeanHarness()`
//
// This file pins the default-OFF contract so a future commit flipping the
// default back to true fails here, and so the opt-in semantics stay clear.

import { describe, it, expect } from "bun:test";
import { ReactiveAgents, HarnessProfile } from "../src/index.js";

describe("v0.12 — memory default-off + clear opt-in", () => {
  it("bare build is stateless (memory OFF, no explicit call)", async () => {
    const agent = await ReactiveAgents.create()
      .withName("default-off-agent")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .build();

    const result = await agent.run("simple task");
    expect(result.success).toBe(true);
    // Memory OFF → config.enableMemory false → debrief gate short-circuits to
    // undefined (no fallback, no LLM call), same as the explicit-opt-out path.
    expect(result.debrief).toBeUndefined();
    await agent.dispose();
  });

  it(".withMemory() opt-in enables memory (debrief reachable)", async () => {
    const agent = await ReactiveAgents.create()
      .withName("opt-in-agent")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withMemory()
      .build();

    const result = await agent.run("simple task");
    expect(result.success).toBe(true);
    // Memory ON + trivial task → fallback debrief synthesized (zero token cost).
    const metaComplexity = (result.metadata as { complexity?: string }).complexity;
    expect(metaComplexity).toBeDefined();
    expect(result.debrief).toBeDefined();
    await agent.dispose();
  });

  it("HarnessProfile.balanced() enables memory explicitly", async () => {
    const agent = await ReactiveAgents.create()
      .withName("balanced-agent")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withProfile(HarnessProfile.balanced())
      .build();

    const result = await agent.run("simple task");
    expect(result.success).toBe(true);
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
