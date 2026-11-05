// Run: bun test packages/reasoning/tests/kernel/recovery-steering-evidence.test.ts --timeout 20000
//
// Plan 9 advisor record item 9, part 2 (gap flagged in 77b6d6122): failure-
// recovery steering decided "failed unresolved" by scanning this pass's
// observation steps. That scan counted a guard's own refusal as a tool failure
// (the call never ran) and could not see a failure a seeded earlier pass left.
// It now reads `state.evidence.permanentlyFailed`, the run-wide value the
// required-tool gates already use: executed attempts only, no success anywhere
// in the run.
//
// RED-ON-CUT: in recovery-steering.ts getToolFailureRecoveryFromSteps, build the
// failed set from the observation-step scan again and the guard-blocked and
// seeded-failure tests fail.
import { describe, expect, it } from "bun:test";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import { GUARD_OBSERVATION_TAG } from "../../src/kernel/state/kernel-constants.js";
import { appendEntries, type RunLedger } from "../../src/kernel/ledger/run-ledger.js";
import { projectStepsToLedger } from "../../src/kernel/ledger/step-projection.js";
import { toolEvidence } from "../../src/kernel/capabilities/verify/requirement-state.js";
import { getToolFailureRecoveryFromSteps } from "../../src/kernel/loop/runner-helpers/recovery-steering.js";
import type { ReasoningStep } from "../../src/types/index.js";

const action = (id: string, name: string): ReasoningStep =>
  makeStep("action", `${name}({})`, { toolCall: { id, name, arguments: {} }, toolUsed: name });
const failure = (id: string, name: string, error: string): ReasoningStep =>
  makeStep("observation", error, { toolCallId: id, observationResult: makeObservationResult(name, false, error) });
const success = (id: string, name: string, content: string): ReasoningStep =>
  makeStep("observation", content, { toolCallId: id, observationResult: makeObservationResult(name, true, content) });
const guardBlocked = (id: string, name: string, warning: string): ReasoningStep =>
  makeStep("observation", warning, {
    toolCallId: id,
    frameworkInstrumentation: GUARD_OBSERVATION_TAG,
    observationResult: makeObservationResult(name, false, warning),
  });

/** The recovery scan over this pass's steps, with evidence from the whole run ledger. */
const recoveryOf = (steps: readonly ReasoningStep[], earlierPasses: RunLedger = []) =>
  getToolFailureRecoveryFromSteps(steps, {
    availableToolNames: ["fetch", "web-search"],
    evidence: toolEvidence(projectStepsToLedger(earlierPasses, steps, 3)),
  });

describe("failure-recovery steering reads the run's tool evidence", () => {
  it("a guard-blocked call is not a failure: no recovery steering", () => {
    const blocked = "⚠️ fetch is blocked: you already called it with these arguments.";
    const recovery = recoveryOf([action("c1", "fetch"), guardBlocked("c1", "fetch", blocked)]);
    expect(recovery.failedUnresolved).toEqual([]);
    expect(recovery.policyBlocked).toEqual([]);
  });

  it("CONTROL: an executed failure this pass is failed unresolved", () => {
    const recovery = recoveryOf([action("c1", "fetch"), failure("c1", "fetch", "HTTP 503: upstream unavailable")]);
    expect(recovery.failedUnresolved).toEqual(["fetch"]);
    expect(recovery.alternativeCandidates).toEqual(["web-search"]);
  });

  it("a guard warning after a real failure does not replace the failure's text", () => {
    const recovery = recoveryOf([
      action("c1", "fetch"),
      failure("c1", "fetch", "HTTP 503: upstream unavailable"),
      action("c2", "fetch"),
      guardBlocked("c2", "fetch", "⚠️ fetch is blocked: already called with these arguments."),
    ]);
    expect(recovery.failedUnresolved).toEqual(["fetch"]);
    // The guard's "blocked" wording would classify as a policy denial.
    expect(recovery.policyBlocked).toEqual([]);
  });

  it("a failure from pass 1 that pass 2 fixed is not failed unresolved", () => {
    const pass1: RunLedger = appendEntries([], [
      { kind: "tool-invocation", iteration: 1, toolName: "fetch", toolCallId: "p1", args: {} },
      { kind: "tool-result", iteration: 1, toolName: "fetch", toolCallId: "p1", success: false, preview: "HTTP 503" },
    ]);
    const recovery = recoveryOf([action("c1", "fetch"), success("c1", "fetch", "status: all systems up")], pass1);
    expect(recovery.failedUnresolved).toEqual([]);
  });

  it("a failure a seeded pass 1 left unresolved is failed unresolved in pass 2 (run-wide)", () => {
    const pass1: RunLedger = appendEntries([], [
      { kind: "tool-invocation", iteration: 1, toolName: "fetch", toolCallId: "p1", args: {} },
      { kind: "tool-result", iteration: 1, toolName: "fetch", toolCallId: "p1", success: false, preview: "HTTP 503" },
    ]);
    const recovery = recoveryOf([], pass1);
    expect(recovery.failedUnresolved).toEqual(["fetch"]);
  });
});
