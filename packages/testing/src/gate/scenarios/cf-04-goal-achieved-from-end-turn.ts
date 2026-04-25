// packages/testing/src/gate/scenarios/cf-04-goal-achieved-from-end-turn.ts
//
// Targeted weakness: W11 / IC-17 (`result.success` always returned `true`,
// masking semantic failures). Closing commit: 28259db6.
//
// Regression triggered when: a run that terminates via plain text (no
// `final-answer` tool call) is misclassified — `goalAchieved` should be
// `null` (ambiguous) for `terminatedBy === "end_turn"`, not `true`.
//
// Scenario design: scripted LLM emits a single text turn. The kernel
// reaches `end_turn` because the model never calls a final-answer tool.
// The Tier 1 outcome must record `terminatedBy: "end_turn"` and
// `goalAchieved: null`.

import type { ScenarioModule } from "../types.js";

export const scenario: ScenarioModule = {
  id: "cf-04-goal-achieved-from-end-turn",
  targetedWeakness: "W11/IC-17",
  closingCommit: "28259db6",
  description:
    "When a run ends via end_turn (model finished talking, no final-answer call), result.goalAchieved must be null — not true. IC-17 protects against the prior bug where success=true was treated as goal-achieved=true universally.",
  config: {
    name: "cf-04-goal-achieved-from-end-turn",
    task: "Say a one-word greeting.",
    testTurns: [{ text: "Hello" }],
    maxIterations: 3,
  },
  customAssertions: (result) => {
    // Capture an explicit `goalAchievedFromTrace` field that this scenario
    // pins. Even if future changes alter what the trace exposes, the gate
    // failure message will name *this* assertion as the source of regression
    // and point at IC-17 as the closing fix.
    const completed = result.trace.events.find((e) => e.kind === "run-completed") as
      | { terminatedBy?: string }
      | undefined;
    return {
      sawRunCompleted: completed !== undefined,
      terminatedByCaptured: completed?.terminatedBy ?? "missing",
    };
  },
};
