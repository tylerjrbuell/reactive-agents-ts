// Run: bun test packages/runtime/tests/w4-maxiterations-honored.test.ts --timeout 15000
//
// Phase 1 Sprint 1 S1.4 — W4 regression test.
//
// Pins the existing builder fix at builder.ts:1503-1504 where
// `withReasoning({ maxIterations })` hoists the value to `_maxIterations`.
// Before that fix, the value was silently dropped because it was stored
// in `_reasoningOptions.maxIterations` but the runtime layer read from
// `_maxIterations` only.
//
// Uses `builder.toConfig()` — the public "Agent as Data" snapshot — so the
// test asserts the user-facing serialization, not internal builder state.
// If a future change re-routes withReasoning's maxIterations through any
// field that toConfig() doesn't expose, this test fails and W4 returns.
//
// The full Invariant signature change to `createRuntime(config: AgentConfig,
// capability: Capability)` (which would fix W4 by construction at the type
// level) is deferred to a Phase 1 follow-up PR — too large for sprint
// closeout. This regression test is sufficient protection in the meantime.

import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/builder.js";

describe("W4 — withReasoning({ maxIterations }) honored (Phase 1 S1.4)", () => {
  it("withReasoning({ maxIterations: 7 }) lands in toConfig().maxIterations", () => {
    const config = ReactiveAgents.create()
      .withTestScenario([{ text: "ok" }])
      .withReasoning({ maxIterations: 7 })
      .toConfig();

    expect(config.execution?.maxIterations).toBe(7);
  }, 15000);

  it("explicit withMaxIterations(N) takes precedence when called after withReasoning", () => {
    const config = ReactiveAgents.create()
      .withTestScenario([{ text: "ok" }])
      .withReasoning({ maxIterations: 7 })
      .withMaxIterations(15) // explicit later call wins
      .toConfig();

    expect(config.execution?.maxIterations).toBe(15);
  }, 15000);

  it("withReasoning() without maxIterations field does not clobber a prior withMaxIterations(N)", () => {
    const config = ReactiveAgents.create()
      .withTestScenario([{ text: "ok" }])
      .withMaxIterations(20)
      .withReasoning({ defaultStrategy: "reactive" }) // no maxIterations field
      .toConfig();

    expect(config.execution?.maxIterations).toBe(20);
  }, 15000);

  it("withReasoning({ maxIterations }) survives a JSON round-trip through agentConfigToJSON", async () => {
    // The "Agent as Data" pitch — the configured maxIterations must survive
    // serialization. If a future schema change drops maxIterations from
    // AgentConfigSchema, this round-trip fails (Schema.decode rejects).
    const { agentConfigToJSON, agentConfigFromJSON } = await import("../src/agent-config.js");

    const config = ReactiveAgents.create()
      .withTestScenario([{ text: "ok" }])
      .withReasoning({ maxIterations: 13 })
      .toConfig();

    const json = agentConfigToJSON(config);
    const restored = agentConfigFromJSON(json);

    expect(restored.execution?.maxIterations).toBe(13);
  }, 15000);
});
