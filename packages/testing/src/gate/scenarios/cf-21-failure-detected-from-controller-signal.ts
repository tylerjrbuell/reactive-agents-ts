// packages/testing/src/gate/scenarios/cf-21-failure-detected-from-controller-signal.ts
//
// Targeted weakness: corpus false positives — labeled-failure scenarios that
// terminate with success=true while the controller has been firing tactical
// interventions without ever escalating to switch-strategy.
// Closing commit: CHANGE A — controllerSignalVetoEvaluator (Verdict-Override).
//
// Regression triggered when:
//   1. controllerSignalVetoEvaluator stops vetoing on the canonical trigger
//      patterns (≥2 stall-detect / ≥3 tool-inject / 1 stall + high entropy)
//   2. Someone removes the veto from defaultEvaluators (chain order change
//      or evaluator drop) — the run silently falls back to llmEndTurn-as-success
//   3. The TerminationContext.controllerDecisionLog wiring breaks (think.ts
//      stops passing state.controllerDecisionLog to the oracle context) and
//      the veto becomes a no-op even when conditions match
//   4. The "fail" verdict action is removed from SignalVerdict's union or
//      stops being short-circuited in the evaluateTermination resolver
//
// Meta-assertion: imports controllerSignalVetoEvaluator AND defaultEvaluators
// AND evaluateTermination directly. Constructs a TerminationContext that
// matches the failure-corpus's pathological pattern (2 stall-detect, no
// switch-strategy) and pins the resolver's verdict to action="fail".

import {
  controllerSignalVetoEvaluator,
  defaultEvaluators,
  evaluateTermination,
  type TerminationContext,
} from "@reactive-agents/reasoning";
import type { ScenarioModule } from "../types.js";

const baseCtx: TerminationContext = {
  thought: "Done. Best I can do.",
  stopReason: "end_turn",
  toolRequest: null,
  iteration: 6,
  steps: [],
  toolsUsed: new Set(),
  requiredTools: [],
  allToolSchemas: [],
  redirectCount: 0,
  priorFinalAnswerAttempts: 0,
  taskDescription: "test",
};

export const scenario: ScenarioModule = {
  id: "cf-21-failure-detected-from-controller-signal",
  targetedWeakness: "corpus-false-positive/CHANGE-A",
  closingCommit: "CHANGE-A",
  description:
    "Pins the Verdict-Override pattern: when the controller has fired tactical interventions repeatedly (≥2 stall-detect, ≥3 tool-inject, or stall + high entropy) without ever escalating to switch-strategy, an apparent successful end_turn exit is overridden to action=\"fail\". Mirrors the corpus false-positive pattern where 3/4 labeled-failure scenarios terminated with success=true at iter 3-9. Asserts (a) veto fires on canonical triggers, (b) veto stays silent when controller already escalated, (c) veto is in defaultEvaluators, (d) resolver short-circuits on high-confidence fail.",
  config: {
    name: "cf-21-failure-detected-from-controller-signal",
    task: "ok",
    testTurns: [{ text: "ok" }],
    maxIterations: 2,
  },
  customAssertions: () => {
    // T1: pathological pattern (≥2 stall-detect, no escalation) → veto fires
    const v1 = controllerSignalVetoEvaluator.evaluate({
      ...baseCtx,
      controllerDecisionLog: [
        "stall-detect: low entropy delta",
        "stall-detect: still stuck",
      ],
    });

    // T2: agent escalated (switch-strategy present) → veto stays silent
    const v2 = controllerSignalVetoEvaluator.evaluate({
      ...baseCtx,
      controllerDecisionLog: [
        "stall-detect: stuck",
        "stall-detect: stuck",
        "switch-strategy: escalating to plan-execute",
      ],
    });

    // T3: 1 stall-detect at high entropy → veto fires
    const v3 = controllerSignalVetoEvaluator.evaluate({
      ...baseCtx,
      controllerDecisionLog: ["stall-detect: stuck"],
      entropy: { composite: 0.7 },
    });

    // T4: 1 stall-detect at low entropy → veto stays silent
    const v4 = controllerSignalVetoEvaluator.evaluate({
      ...baseCtx,
      controllerDecisionLog: ["stall-detect: low entropy"],
      entropy: { composite: 0.15 },
    });

    // T5: ≥3 tool-inject without escalation → veto fires
    const v5 = controllerSignalVetoEvaluator.evaluate({
      ...baseCtx,
      controllerDecisionLog: [
        "tool-inject: more tools",
        "tool-inject: more tools",
        "tool-inject: more tools",
      ],
    });

    // T6: full resolver — pathological log + would-be exit → resolver returns fail
    const decision = evaluateTermination(
      {
        ...baseCtx,
        controllerDecisionLog: [
          "stall-detect: stuck",
          "stall-detect: stuck",
        ],
      },
      defaultEvaluators,
    );

    const inDefaults = defaultEvaluators.some(
      (e) => e.name === "ControllerSignalVeto",
    );

    return {
      // Veto presence in default chain — removing it would silently regress
      "veto.in_default_evaluators": inDefaults,

      // Trigger correctness — each canonical pattern fires the right verdict
      "T1.fires_on_2_stall_detect": v1?.action === "fail" && v1.confidence === "high",
      "T2.silent_when_escalated": v2 === null,
      "T3.fires_on_stall_with_high_entropy": v3?.action === "fail",
      "T4.silent_on_low_entropy_with_one_stall": v4 === null,
      "T5.fires_on_3_tool_inject": v5?.action === "fail",

      // Resolver — fail verdict short-circuits and is the final decision
      "resolver.returns_fail": decision.action === "fail",
      "resolver.shouldExit": decision.shouldExit,
      "resolver.evaluator_is_veto": decision.evaluator === "ControllerSignalVeto",
    };
  },
};
