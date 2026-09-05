/**
 * requirement-state.test.ts — pins `deriveRequirementEvidence`, the single
 * ledger-backed "covered = COMPLETED SUCCESSFULLY" derivation (09 §6.5 / Step
 * 3 item 3c). Before this, the kernel's terminal-gate callers passed
 * `state.toolsUsed` (attempted semantics, written before tool execution) as
 * `coveredTools`, so a required tool that was attempted and FAILED counted as
 * covered — see wiki/Planning/Implementation-Plans/2026-08-18-step-3-one-
 * execution-boundary.md §4 and the live probe
 * scripts/probes/step3-requirement-evidence-probe.ts.
 */
import { describe, expect, it } from "bun:test";
import { deriveRequirementEvidence } from "./requirement-state.js";
import { makeStep } from "../sense/step-utils.js";
import { makeObservationResult } from "../../utils/observation-helpers.js";
import { appendEntries, type RunLedger } from "../../ledger/run-ledger.js";
import type { ReasoningStep } from "../../../types/index.js";

function toolSteps(toolName: string, success: boolean): ReasoningStep[] {
  return [
    makeStep(
      "action",
      `${toolName}({})`,
      { toolCall: { id: "tc-1", name: toolName, arguments: {} } },
    ),
    makeStep(
      "observation",
      success ? "ok" : "error",
      {
        toolCallId: "tc-1",
        observationResult: makeObservationResult(toolName, success, success ? "ok" : "error"),
      },
    ),
  ];
}

describe("deriveRequirementEvidence — covered means COMPLETED, not attempted", () => {
  it("RED: a required tool attempted and FAILED is NOT covered", () => {
    const steps = toolSteps("record_finding", false);
    const evidence = deriveRequirementEvidence(steps, ["record_finding"]);
    expect(evidence.coveredTools.has("record_finding")).toBe(false);
  });

  it("a required tool that completed successfully IS covered", () => {
    const steps = toolSteps("record_finding", true);
    const evidence = deriveRequirementEvidence(steps, ["record_finding"]);
    expect(evidence.coveredTools.has("record_finding")).toBe(true);
  });

  it("a required tool never attempted is not covered", () => {
    const evidence = deriveRequirementEvidence([], ["record_finding"]);
    expect(evidence.coveredTools.has("record_finding")).toBe(false);
  });

  it("both calls erroring (the live probe shape: 2/2 failures) leaves the tool uncovered", () => {
    const call = (id: string): ReasoningStep[] => [
      makeStep("action", "record_finding({})", {
        toolCall: { id, name: "record_finding", arguments: {} },
      }),
      makeStep("observation", "error", {
        toolCallId: id,
        observationResult: makeObservationResult("record_finding", false, "error"),
      }),
    ];
    const steps = [...call("tc-1"), ...call("tc-2")];
    const evidence = deriveRequirementEvidence(steps, ["record_finding"]);
    expect(evidence.coveredTools.has("record_finding")).toBe(false);
  });

  it("a ledger-only successful call (e.g. delegated/merged, absent from local steps) still counts as covered", () => {
    const ledger: RunLedger = appendEntries(undefined, [
      { kind: "tool-invocation", iteration: 0, toolName: "record_finding", toolCallId: "tc-9" },
      {
        kind: "tool-result",
        iteration: 0,
        toolName: "record_finding",
        toolCallId: "tc-9",
        success: true,
        preview: "ok",
      },
    ]);
    const evidence = deriveRequirementEvidence([], ["record_finding"], ledger);
    expect(evidence.coveredTools.has("record_finding")).toBe(true);
  });

  it("unrelated required tools not in the failing set stay unaffected", () => {
    const steps = [...toolSteps("record_finding", false), ...toolSteps("file-write", true)];
    const evidence = deriveRequirementEvidence(steps, ["record_finding", "file-write"]);
    expect(evidence.coveredTools.has("record_finding")).toBe(false);
    expect(evidence.coveredTools.has("file-write")).toBe(true);
  });
});
