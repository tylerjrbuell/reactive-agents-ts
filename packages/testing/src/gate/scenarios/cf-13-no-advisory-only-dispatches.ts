// packages/testing/src/gate/scenarios/cf-13-no-advisory-only-dispatches.ts
//
// Targeted weakness: Principle-11 (no half-implemented features).
// Closing commit: fd58a6d4.
//
// Regression triggered when: any of the four removed advisory-only
// evaluators (prompt-switch / memory-boost / skill-reinject / human-escalate)
// reappears in the dispatch path. Those evaluators previously fired
// ControllerDecisions that the dispatcher always suppressed with
// "mode-advisory" — pure overhead, zero action. Removed in P0 cleanup.
//
// Scenario design: any minimal scripted-LLM run is sufficient. The
// outcome MUST show none of the four decision types in
// `interventionsDispatched`. If a future change re-imports one of the
// evaluators into controller-service.ts, this scenario fails and points
// the reader at fd58a6d4 + the loop-state Principle-11 entry.

import type { ScenarioModule } from "../types.js";

const REMOVED_DECISIONS: readonly string[] = [
  "prompt-switch",
  "memory-boost",
  "skill-reinject",
  "human-escalate",
];

export const scenario: ScenarioModule = {
  id: "cf-13-no-advisory-only-dispatches",
  targetedWeakness: "Principle-11",
  closingCommit: "fd58a6d4",
  description:
    "Confirms that none of the four removed advisory-only evaluators (prompt-switch, memory-boost, skill-reinject, human-escalate) ever appear in interventionsDispatched. Reintroducing one without a registered handler regresses North Star principle 11.",
  config: {
    name: "cf-13-no-advisory-only-dispatches",
    task: "Reply with 'ok'.",
    testTurns: [{ text: "ok" }],
    withReactiveIntelligence: true,
    maxIterations: 3,
  },
  customAssertions: (result) => {
    const dispatched = new Set(
      result.trace.events
        .filter((e) => e.kind === "intervention-dispatched")
        .map((e) => (e as { decisionType: string }).decisionType),
    );
    return Object.fromEntries(
      REMOVED_DECISIONS.map((d) => [`removed.${d}.dispatched`, dispatched.has(d)]),
    );
  },
};
