// packages/testing/src/gate/scenarios/cf-18-meta-tools-trusted.ts
//
// Targeted weakness: prompt-injection defense gap (Phase 1 §4) +
// Q5 grandfather decision protection.
// Closing commit: this PR (S2.3) introduces ObservationResult.trustLevel
// + KNOWN_TRUSTED_TOOL_NAMES set. ContextCurator (S2.5) consumes the
// field to render untrusted observations in <tool_output> blocks where
// prompt-injection content can't escape the role boundary.
//
// Regression triggered when:
//   1. A name is removed from KNOWN_TRUSTED_TOOL_NAMES without a matching
//      change to who consumes that observation (e.g. a meta-tool starts
//      getting wrapped in <tool_output> blocks → may break templates)
//   2. An untrusted tool name (web-search, file-read, etc.) is added to
//      the set without justification (security regression — adversarial
//      content from the web could now land inline in the system prompt)
//   3. makeObservationResult stops stamping trustJustification on trusted
//      results (Phase 3 lint won't be able to detect grandfather entries)
//
// Meta-assertion: imports KNOWN_TRUSTED_TOOL_NAMES + makeObservationResult
// directly and pins the trust assignments.

import {
  KNOWN_TRUSTED_TOOL_NAMES,
  GRANDFATHER_TRUST_JUSTIFICATION,
} from "@reactive-agents/reasoning";
import type { ScenarioModule } from "../types.js";

export const scenario: ScenarioModule = {
  id: "cf-18-meta-tools-trusted",
  targetedWeakness: "Q5/S2.3",
  closingCommit: "S2.3",
  description:
    "Confirms KNOWN_TRUSTED_TOOL_NAMES contains the framework-internal meta-tools (recall, brief, pulse, activate-skill, final-answer, find, checkpoint, harness-deliverable) and excludes user/network-input tools (web-search, file-read, code-execute, file-write, http-get). Q5 grandfather decision: trustJustification is the literal 'grandfather-phase-1' string (Phase 3 lint will require real one-paragraph justifications before v1.0).",
  config: {
    name: "cf-18-meta-tools-trusted",
    task: "ok",
    testTurns: [{ text: "ok" }],
    maxIterations: 2,
  },
  customAssertions: () => {
    // Pin both inclusion AND exclusion. Adding a name to either side
    // requires deliberate intent + a baseline update.
    const trustedExpected = [
      "recall",
      "brief",
      "pulse",
      "activate-skill",
      "final-answer",
      "find",
      "checkpoint",
      "harness-deliverable",
    ];
    const untrustedExpected = [
      "web-search",
      "file-read",
      "file-write",
      "http-get",
      "code-execute",
    ];

    const result: Record<string, number | string | boolean | null> = {};
    for (const name of trustedExpected) {
      result[`trusted.${name}.in_set`] = KNOWN_TRUSTED_TOOL_NAMES.has(name);
    }
    for (const name of untrustedExpected) {
      result[`untrusted.${name}.in_set`] = KNOWN_TRUSTED_TOOL_NAMES.has(name);
    }
    result["set.size"] = KNOWN_TRUSTED_TOOL_NAMES.size;
    result["grandfather.justification"] = GRANDFATHER_TRUST_JUSTIFICATION;
    return result;
  },
};
