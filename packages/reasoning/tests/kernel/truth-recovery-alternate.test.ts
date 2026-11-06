// Run: bun test packages/reasoning/tests/kernel/truth-recovery-alternate.test.ts --timeout 15000
//
// Truthfulness audit 2026-11-06, item 2: the recovery steer named any
// not-yet-failed tool as an "alternate path" — "Recovery required: prior tool
// path failed (file-read). Try an alternate path now: file-write." (56 runs).
// An alternate must substitute for the failed tool (same work, same target);
// otherwise the steer asks for corrected arguments on the failed tool.
//
// RED-ON-CUT: drop the canSubstitute filter in recovery-steering.ts
// getToolFailureRecoveryFromSteps and the file-read→file-write test fails.
import { describe, expect, it } from "bun:test";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import { projectStepsToLedger } from "../../src/kernel/ledger/step-projection.js";
import { toolEvidence } from "../../src/kernel/capabilities/verify/requirement-state.js";
import {
  buildRecoverySteeringGuidance,
  getToolFailureRecoveryFromSteps,
} from "../../src/kernel/loop/runner-helpers/recovery-steering.js";
import { canSubstitute, toolClassOf } from "../../src/kernel/loop/runner-helpers/tool-substitution.js";
import type { ReasoningStep } from "../../src/types/index.js";

const action = (id: string, name: string): ReasoningStep =>
  makeStep("action", `${name}({})`, { toolCall: { id, name, arguments: {} }, toolUsed: name });
const failure = (id: string, name: string, error: string): ReasoningStep =>
  makeStep("observation", error, { toolCallId: id, observationResult: makeObservationResult(name, false, error) });

const recoveryAfterFailing = (failed: string, available: readonly string[], required: readonly string[] = []) => {
  const steps = [action("c1", failed), failure("c1", failed, `ENOENT: no such file or directory, open './data/in.csv'`)];
  return getToolFailureRecoveryFromSteps(steps, {
    requiredTools: required,
    availableToolNames: available,
    evidence: toolEvidence(projectStepsToLedger([], steps, 3)),
  });
};

describe("truth item 2 — recovery steer names only a substitute", () => {
  it("recorded shape: file-read failed, file-write required → no alternate named, retry file-read", () => {
    const recovery = recoveryAfterFailing("file-read", ["file-read", "file-write", "code-execute", "web-search"], [
      "file-read",
      "file-write",
    ]);
    expect(recovery.failedUnresolved).toEqual(["file-read"]);
    expect(recovery.alternativeCandidates).toEqual([]);
    const guidance = buildRecoverySteeringGuidance(recovery, 1, 3, "stall");
    expect(guidance).not.toContain("file-write");
    expect(guidance).not.toContain("alternate path");
    expect(guidance).toContain("Retry file-read with corrected arguments");
  });

  it("a real substitute is still offered (file-read failed, grep available)", () => {
    const recovery = recoveryAfterFailing("file-read", ["file-read", "file-write", "grep"]);
    expect(recovery.alternativeCandidates).toEqual(["grep"]);
    expect(buildRecoverySteeringGuidance(recovery, 1, 3, "stall")).toContain("Try an alternate path now: grep");
  });

  it("the substitution relation over the audit's recorded pairs", () => {
    expect(canSubstitute("file-read", "file-write")).toBe(false);
    expect(canSubstitute("file-write", "code-execute")).toBe(false);
    expect(canSubstitute("web-search", "file-read")).toBe(false);
    expect(canSubstitute("code-execute", "file-read")).toBe(false);
    expect(canSubstitute("web-search", "http-get")).toBe(true);
    expect(canSubstitute("fetch", "web-search")).toBe(true);
    expect(canSubstitute("code-execute", "shell-execute")).toBe(true);
    expect(canSubstitute("jira-search", "jira-get")).toBe(true);
    // no recognizable mode → never named
    expect(toolClassOf("summarizer")).toBeUndefined();
    expect(canSubstitute("summarizer", "summarizer-v2")).toBe(false);
  });
});
