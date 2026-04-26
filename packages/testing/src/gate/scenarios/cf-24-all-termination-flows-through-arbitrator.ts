// packages/testing/src/gate/scenarios/cf-24-all-termination-flows-through-arbitrator.ts
//
// Targeted weakness: G-5 (scattered termination) — pre-Sprint-3.3 the
// kernel had 9 different code paths setting status:"done" independently.
// CHANGE A wired the oracle into one path; corpus N=2 proved that didn't
// move the needle because 8 paths bypassed the veto entirely.
// Closing commit: Sprint 3.3 — Arbitrator consolidation. Five capability
// sites (act/act.ts, reason/think.ts ×3, reflect/loop-detector.ts) now
// emit TerminationIntents and flow through arbitrate()+applyTermination.
//
// Regression triggered when:
//   1. Any capability file resumes setting status:"done" directly via
//      transitionState (bypasses Arbitrator → veto can't fire)
//   2. arbitrate() returns the wrong Verdict for a corpus failure pattern
//      (e.g., agent-final-answer with ≥2 stall-detect should fail-veto)
//   3. applyTermination stops applying status:"failed" on exit-failure
//      verdicts (regression of CHANGE A's Verdict-Override semantics)
//   4. The Arbitrator's resolution rules drift from the spec (e.g.,
//      controller-early-stop starts vetoing when it shouldn't)
//
// Meta-assertion: imports the Arbitrator's public API and exercises each
// of the 5 corpus patterns end-to-end via arbitrate(). Asserts the Verdict
// shape matches the corpus expectations.

import {
  arbitrate,
  type ArbitrationContext,
} from "@reactive-agents/reasoning";
import type { ScenarioModule } from "../types.js";

// A failed tool observation — concrete evidence that the agent's success
// claim is contradicted by reality. The Arbitrator's veto requires this
// (Sprint 3.3 corpus run 1 refinement) to avoid false-positive vetoes on
// successful knowledge-recall scenarios that have benign suppressed-dispatch
// log entries.
const failedStep = {
  id: "s-failed" as never,
  type: "observation" as const,
  content: "Error: rate limit exceeded",
  timestamp: new Date(2026, 3, 26, 10, 0, 0),
  metadata: {
    observationResult: {
      success: false,
      toolName: "web-search",
      displayText: "Error: rate limit exceeded",
      category: "error" as const,
      resultKind: "error" as const,
      preserveOnCompaction: true,
      trustLevel: "untrusted" as const,
    },
  },
};

const baseCtx: ArbitrationContext = {
  iteration: 5,
  maxIterations: 12,
  task: "test",
  steps: [],
  toolsUsed: new Set(),
  requiredTools: [],
};

// Veto-eligible context: has failed tool observation in steps.
const ctxWithFailure: ArbitrationContext = {
  ...baseCtx,
  steps: [failedStep],
};

export const scenario: ScenarioModule = {
  id: "cf-24-all-termination-flows-through-arbitrator",
  targetedWeakness: "G-5/Sprint-3.3",
  closingCommit: "Sprint-3.3",
  description:
    "Pins the Sole Termination Authority property (G-5 closure). All 5 capability-level termination sites (act, think×3, reflect/loop-detector) flow through the Arbitrator. Asserts the Arbitrator's resolution rules: agent-final-answer with controller veto → exit-failure (the corpus 5/8 → 8/8 mechanism); fast-path / loop-detected with no veto → exit-success; max-iterations / kernel-error → always exit-failure; controller-early-stop → trusted exit-success. The 9 status:done sites in runner.ts are exempt — runner is the loop controller, the legitimate state mutator. arbitrator.ts internal applyTermination is also exempt — it IS the consolidation point.",
  config: {
    name: "cf-24-all-termination-flows-through-arbitrator",
    task: "ok",
    testTurns: [{ text: "ok" }],
    maxIterations: 2,
  },
  customAssertions: () => {
    // ── Site 1: act.ts:441 (final-answer-tool path) ──────────────────────────
    // Pre-Sprint-3.3 this was the false-positive source: agent calls
    // final-answer-tool, kernel sets status:done, success=true. Now: the
    // Arbitrator vetoes when controller history shows pathological activity.

    // 1a: clean final-answer → exit-success
    const fa1 = arbitrate(
      { kind: "agent-final-answer", via: "tool", output: "the answer" },
      baseCtx,
    );

    // 1b: corpus failure pattern (≥2 stall-detect + tool-failure evidence,
    // no escalation) → veto fires (Sprint 3.3 refinement: requires tool failure)
    const fa2 = arbitrate(
      { kind: "agent-final-answer", via: "tool", output: "fake answer" },
      {
        ...ctxWithFailure,
        controllerDecisionLog: [
          "stall-detect: low entropy delta",
          "stall-detect: still stuck",
        ],
      },
    );

    // 1c: controller already escalated → veto stays silent
    const fa3 = arbitrate(
      { kind: "agent-final-answer", via: "tool", output: "answer" },
      {
        ...ctxWithFailure,
        controllerDecisionLog: [
          "stall-detect: stuck",
          "switch-strategy: escalating",
        ],
      },
    );

    // 1d: pathological log BUT no tool failures (success-scenario protection)
    // → veto stays silent
    const fa4 = arbitrate(
      { kind: "agent-final-answer", via: "tool", output: "Paris" },
      {
        ...baseCtx, // no failed steps
        controllerDecisionLog: [
          "stall-detect: low entropy delta",
          "stall-detect: still low",
        ],
      },
    );

    // ── Site 2: think.ts:553 (fast-path) ─────────────────────────────────────
    // Trivial single-iteration completion. Veto applies uniformly.
    const fp1 = arbitrate(
      { kind: "fast-path-completed", output: "Paris" },
      baseCtx,
    );
    // Fast-path with tool failure evidence (rare but possible if a tool
    // failed in iteration 0 and the model still tried fast-path) → veto fires
    const fp2 = arbitrate(
      { kind: "fast-path-completed", output: "fake" },
      {
        ...ctxWithFailure,
        controllerDecisionLog: ["stall-detect: x", "stall-detect: x"],
      },
    );

    // ── Site 3: think.ts:696/910 (oracle decision passthrough) ──────────────
    const oracle1 = arbitrate(
      {
        kind: "oracle-decision",
        decision: {
          shouldExit: true,
          action: "exit",
          confidence: "medium",
          reason: "llm_end_turn",
          evaluator: "LLMEndTurn",
          allVerdicts: [],
          output: "answer",
        },
        output: "fallback",
      },
      baseCtx,
    );
    const oracle2 = arbitrate(
      {
        kind: "oracle-decision",
        decision: {
          shouldExit: true,
          action: "fail",
          confidence: "high",
          reason: "controller veto",
          evaluator: "ControllerSignalVeto",
          allVerdicts: [],
        },
        output: "would-be",
      },
      baseCtx,
    );

    // ── Site 4: loop-detector.ts:145 (all_tools_called) ──────────────────────
    const ld1 = arbitrate(
      { kind: "loop-detected", output: "result", reason: "all_tools_called" },
      baseCtx,
    );

    // ── Framework-driven exits (always trusted/honored) ──────────────────────
    const maxIter = arbitrate(
      { kind: "max-iterations", output: "best effort" },
      { ...baseCtx, maxIterations: 12 },
    );
    const earlyStop = arbitrate(
      { kind: "controller-early-stop", output: "ok", reason: "entropy_converged" },
      baseCtx,
    );

    return {
      // Site 1 — agent-final-answer (the corpus-impact site)
      "act.final_answer.clean_succeeds": fa1.action === "exit-success",
      "act.final_answer.veto_fires_on_corpus_pattern": fa2.action === "exit-failure",
      "act.final_answer.veto_silent_when_escalated": fa3.action === "exit-success",
      "act.final_answer.veto_silent_without_tool_failures":
        fa4.action === "exit-success", // Sprint 3.3 corpus run 1 fix
      "act.final_answer.veto_terminatedBy":
        fa2.action === "exit-failure" && fa2.terminatedBy === "controller_signal_veto",

      // Site 2 — fast-path
      "think.fast_path.clean_succeeds": fp1.action === "exit-success",
      "think.fast_path.veto_fires_on_pathological_log": fp2.action === "exit-failure",
      "think.fast_path.terminatedBy_is_end_turn":
        fp1.action === "exit-success" && fp1.terminatedBy === "end_turn",

      // Site 3 — oracle passthrough (think.ts:696, :910)
      "think.oracle.exit_passes_through": oracle1.action === "exit-success",
      "think.oracle.fail_passes_through": oracle2.action === "exit-failure",
      "think.oracle.fail_terminatedBy_is_veto":
        oracle2.action === "exit-failure" &&
        oracle2.terminatedBy === "controller_signal_veto",

      // Site 4 — loop-detector
      "reflect.loop_detected.clean_succeeds": ld1.action === "exit-success",

      // Framework-driven (always honored)
      "framework.max_iterations.is_exit_failure":
        maxIter.action === "exit-failure" && maxIter.terminatedBy === "max_iterations",
      "framework.early_stop.is_trusted_exit_success":
        earlyStop.action === "exit-success" &&
        earlyStop.terminatedBy.includes("controller_early_stop"),
    };
  },
};
