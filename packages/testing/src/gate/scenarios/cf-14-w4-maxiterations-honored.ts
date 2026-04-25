// packages/testing/src/gate/scenarios/cf-14-w4-maxiterations-honored.ts
//
// Targeted weakness: W4 (`withReasoning({ maxIterations })` ignored —
// maxIterations stored in wrong builder field, silently dropped).
// Closing commits: builder.ts:1503-1504 fix + Phase 1 S1.4 regression
// pin (this scenario).
//
// Regression triggered when: builder.toConfig().execution.maxIterations
// returns undefined or a wrong value after withReasoning({ maxIterations: N }).
// The asserted invariant is "what the user wrote ends up where the
// runtime reads it", surfaced via the public toConfig() snapshot.
//
// Why a meta-assertion (no agent run): the runtime path that consumes
// maxIterations is wired but the original W4 bug was in the *builder*
// field-name mismatch — caught most reliably by asserting against the
// "Agent as Data" serialization, not by counting iterations in a real
// run (which would require enough scripted turns to actually hit the
// limit and would conflate W4 with other termination paths).

import { ReactiveAgents } from "@reactive-agents/runtime";
import type { ScenarioModule } from "../types.js";

export const scenario: ScenarioModule = {
  id: "cf-14-w4-maxiterations-honored",
  targetedWeakness: "W4",
  closingCommit: "builder.ts:1503",
  description:
    "Confirms withReasoning({ maxIterations: N }) lands in toConfig().execution.maxIterations === N. W4 was the silent-drop bug where the builder stored the value in _reasoningOptions.maxIterations but the runtime layer read from _maxIterations only — fixed in builder.ts:1503-1504 hoist, pinned by this scenario + tests/w4-maxiterations-honored.test.ts.",
  config: {
    name: "cf-14-w4-maxiterations-honored",
    task: "ok",
    testTurns: [{ text: "ok" }],
    maxIterations: 2,
  },
  customAssertions: () => {
    // Assert the invariant directly via the public builder API. This isolates
    // W4 from any runtime-side maxIterations enforcement so a regression in
    // *just* the field-name plumbing fails this scenario specifically.
    const explicitOnly = ReactiveAgents.create()
      .withTestScenario([{ text: "ok" }])
      .withMaxIterations(20)
      .toConfig();

    const reasoningOnly = ReactiveAgents.create()
      .withTestScenario([{ text: "ok" }])
      .withReasoning({ maxIterations: 7 })
      .toConfig();

    const reasoningThenExplicit = ReactiveAgents.create()
      .withTestScenario([{ text: "ok" }])
      .withReasoning({ maxIterations: 7 })
      .withMaxIterations(15)
      .toConfig();

    return {
      "explicit.maxIterations": explicitOnly.execution?.maxIterations ?? -1,
      "reasoning.maxIterations": reasoningOnly.execution?.maxIterations ?? -1,
      "reasoning.then.explicit.maxIterations":
        reasoningThenExplicit.execution?.maxIterations ?? -1,
    };
  },
};
