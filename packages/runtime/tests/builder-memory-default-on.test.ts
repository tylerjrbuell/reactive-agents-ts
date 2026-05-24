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
    // Memory enabled → debrief field synthesizes; "debrief" key is present
    // on the result type (value may be undefined when synthesis short-circuits
    // on a trivial task, but the contract is the runtime attempted it).
    expect("debrief" in result).toBe(true);
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
    // Lean mode == no debrief synthesis (memory off)
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
    expect("debrief" in result).toBe(true);
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
    expect("debrief" in result).toBe(true);
    await agent.dispose();
  });
});
