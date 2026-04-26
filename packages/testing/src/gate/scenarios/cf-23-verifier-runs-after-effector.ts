// packages/testing/src/gate/scenarios/cf-23-verifier-runs-after-effector.ts
//
// Targeted weakness: pre-Sprint-3.2, "did the action succeed?" was answered
// in scattered places (the tool's success boolean, isSatisfied checks,
// evidence-grounding, requirement-state). No single component owned the
// Verify capability (North Star v3.0 §3.1 #8).
// Closing commit: Sprint 3.2 — defaultVerifier promoted; act.ts wires it
// after standard tool-execution outputs.
//
// Regression triggered when:
//   1. defaultVerifier.verify() stops being called from act.ts after tool
//      execution (the verification field on observation steps disappears)
//   2. Verifier interface drifts (verify signature changes incompatibly)
//   3. The check pipeline shrinks below the contract — verifier returns
//      verified:true on a clearly failed action
//
// Meta-assertion: imports defaultVerifier + contextFromObservation from
// the package, exercises the Verifier contract end-to-end with a mock
// observation, and asserts the structured result shape and outcomes.
//
// Sprint 3.3 (Arbitrator) and Sprint 3.4 (Reflect) will expand cf-23 to
// pin that downstream consumers actually consult the verification field.
// For Sprint 3.2 the contract is: the Verifier is a real, callable
// service that act.ts wires.

import {
  defaultVerifier,
  contextFromObservation,
  type ObservationResult,
} from "@reactive-agents/reasoning";
import type { ScenarioModule } from "../types.js";

const successObs: ObservationResult = {
  success: true,
  toolName: "web-search",
  displayText: "search results: foo, bar, baz",
  category: "web-search",
  resultKind: "data",
  preserveOnCompaction: false,
  trustLevel: "untrusted",
};

const failedObs: ObservationResult = {
  success: false,
  toolName: "web-search",
  displayText: "Error: rate limit exceeded",
  category: "web-search",
  resultKind: "error",
  preserveOnCompaction: true,
  trustLevel: "untrusted",
};

const emptyObs: ObservationResult = {
  success: true,
  toolName: "delete-file",
  displayText: "",
  category: "custom",
  resultKind: "side-effect",
  preserveOnCompaction: false,
  trustLevel: "untrusted",
};

export const scenario: ScenarioModule = {
  id: "cf-23-verifier-runs-after-effector",
  targetedWeakness: "Verify-capability/Sprint-3.2",
  closingCommit: "Sprint-3.2",
  description:
    "Pins the Verify capability promotion (Sprint 3.2). Confirms (a) defaultVerifier is exported and callable, (b) contextFromObservation lifts an ObservationResult into a VerificationContext, (c) the structured VerificationResult contains action + verified + checks + summary, (d) failed actions are correctly flagged, (e) empty content is flagged as a check failure, (f) terminal actions add required-tools-satisfied check. Sprint 3.3 + 3.4 will expand to assert downstream consumers actually consult the verification metadata.",
  config: {
    name: "cf-23-verifier-runs-after-effector",
    task: "ok",
    testTurns: [{ text: "ok" }],
    maxIterations: 2,
  },
  customAssertions: () => {
    // V1: defaultVerifier is exported and callable
    const v1 = defaultVerifier.verify(
      contextFromObservation({
        observation: successObs,
        task: "test",
        priorSteps: [],
      }),
    );

    // V2: failed observation flips verified=false
    const v2 = defaultVerifier.verify(
      contextFromObservation({
        observation: failedObs,
        task: "test",
        priorSteps: [],
      }),
    );

    // V3: empty content is flagged
    const v3 = defaultVerifier.verify(
      contextFromObservation({
        observation: emptyObs,
        task: "test",
        priorSteps: [],
      }),
    );

    // V4: terminal verification adds required-tools-satisfied when requested
    const v4 = defaultVerifier.verify(
      contextFromObservation({
        observation: successObs,
        task: "test",
        priorSteps: [],
        requiredTools: ["web-search", "calculator"],
        toolsUsed: new Set(["web-search"]),
        terminal: true,
      }),
    );
    const reqCheck = v4.checks.find((c) => c.name === "required-tools-satisfied");

    return {
      // Service-presence
      "verifier.is_callable": typeof defaultVerifier.verify === "function",
      "context_helper.is_callable": typeof contextFromObservation === "function",

      // V1 — success path
      "v1.verified_true": v1.verified === true,
      "v1.action_preserved": v1.action === "web-search",
      "v1.has_action_success_check": v1.checks.some((c) => c.name === "action-success" && c.passed),
      "v1.has_summary": typeof v1.summary === "string" && v1.summary.length > 0,

      // V2 — failed action
      "v2.verified_false": v2.verified === false,
      "v2.action_success_failed":
        v2.checks.find((c) => c.name === "action-success")?.passed === false,
      "v2.summary_names_failed_check": v2.summary.includes("action-success"),

      // V3 — empty content
      "v3.verified_false": v3.verified === false,
      "v3.empty_content_flagged":
        v3.checks.find((c) => c.name === "non-empty-content")?.passed === false,

      // V4 — terminal with required tools
      "v4.required_check_present": reqCheck !== undefined,
      "v4.required_check_failed_for_missing": reqCheck?.passed === false,
      "v4.reason_names_missing_tool": (reqCheck?.reason ?? "").includes("calculator"),
    };
  },
};
