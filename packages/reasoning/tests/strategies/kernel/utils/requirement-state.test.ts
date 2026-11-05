// Run: bun test packages/reasoning/tests/strategies/kernel/utils/requirement-state.test.ts --timeout 15000
//
// Every "was required tool X called / attempted / permanently failed / still
// missing" answer is a pure function of the run's ToolEvidence (Plan 9 advisor
// item 8). These pins drive the answers through the same projection + fold
// `transitionState` applies (steps -> ledger -> evidence), so they test the one
// definition, not a fixture's copy of it.
import { describe, it, expect } from "bun:test";
import { makeStep } from "../../../../src/kernel/capabilities/sense/step-utils.js";
import {
  NO_TOOL_EVIDENCE,
  effectiveMissingRequired,
  foldToolEvidence,
  missingRequired,
  permanentlyFailedRequired,
  toolEvidence,
} from "../../../../src/kernel/capabilities/verify/requirement-state.js";
import { appendEntries, type LedgerEntryInput } from "../../../../src/kernel/ledger/run-ledger.js";
import { GUARD_OBSERVATION_TAG } from "../../../../src/kernel/state/kernel-constants.js";
import { makeObservationResult } from "../../../../src/kernel/utils/observation-helpers.js";
import { evidenceOf } from "../../../kernel/tool-evidence-fixture.js";

const obs = (toolName: string, success: boolean, delegatedToolsUsed?: readonly string[]) =>
  makeStep("observation", success ? "ok" : "failed", {
    observationResult: makeObservationResult(toolName, success, success ? "ok" : "failed", { delegatedToolsUsed }),
  });

const result = (toolName: string, success: boolean, extra: Partial<LedgerEntryInput> = {}): LedgerEntryInput =>
  ({ kind: "tool-result", iteration: 1, toolName, success, preview: success ? "ok" : "failed", ...extra }) as LedgerEntryInput;

describe("requirement-state — answers derived from the run's tool evidence", () => {
  it("counts successful calls by tool name", () => {
    expect(evidenceOf([obs("web-search", true), obs("web-search", false)]).successfulCounts["web-search"]).toBe(1);
  });

  it("does not double-count when a delegated tool overlaps the parent toolName", () => {
    const evidence = evidenceOf([
      obs("spawn-agent", true, ["web-search", "web-search"]),
      obs("web-search", true, ["web-search"]),
    ]);
    expect(evidence.successfulCounts["web-search"]).toBe(2);
  });

  it("counts every executed attempt regardless of success", () => {
    const evidence = evidenceOf([obs("gws-cli", false), obs("gws-cli", false), obs("web-search", true)]);
    expect(evidence.attemptedCounts["gws-cli"]).toBe(2);
    expect(evidence.attemptedCounts["web-search"]).toBe(1);
  });

  it("identifies required tools that were attempted but never succeeded", () => {
    const evidence = evidenceOf([obs("gws-cli", false), obs("web-search", true)]);
    // gws-cli: attempted + failed, web-search: succeeded, file-write: never attempted
    expect(permanentlyFailedRequired(evidence, ["gws-cli", "web-search", "file-write"])).toEqual(["gws-cli"]);
    expect(evidence.permanentlyFailed).toEqual(["gws-cli"]);
  });

  it("does not mark a tool as permanently failed if it eventually succeeded", () => {
    const evidence = evidenceOf([obs("web-search", false), obs("web-search", true)]);
    expect(permanentlyFailedRequired(evidence, ["web-search"])).toEqual([]);
  });

  it("effectiveMissingRequired excludes permanently-failed tools from the nudge list", () => {
    const effective = effectiveMissingRequired(evidenceOf([obs("gws-cli", false)]), ["gws-cli", "file-write"]);
    // gws-cli failed every attempt — excluded; file-write was never attempted — still missing.
    expect(effective).toEqual(["file-write"]);
  });

  it("effectiveMissingRequired is empty when every required tool succeeded or permanently failed", () => {
    const evidence = evidenceOf([obs("web-search", true), obs("gws-cli", false)]);
    expect(effectiveMissingRequired(evidence, ["web-search", "gws-cli"])).toEqual([]);
  });

  it("missingRequired honours quantity floors", () => {
    const evidence = evidenceOf([obs("web-search", true)]);
    expect(missingRequired(evidence, ["web-search", "file-write"], { "web-search": 2, "file-write": 1 })).toEqual([
      "web-search",
      "file-write",
    ]);
    expect(missingRequired(NO_TOOL_EVIDENCE, [])).toEqual([]);
  });

  // Pin (c): a quantity counts across passes. The pass seed starts a later
  // pass's ledger from the earlier pass's, so the fold continues the counts.
  it("a required quantity counts run-wide: seed calls plus this pass's calls", () => {
    const seed = toolEvidence(appendEntries(undefined, [result("web-search", true, { toolCallId: "p1" })]));
    expect(missingRequired(seed, ["web-search"], { "web-search": 2 })).toEqual(["web-search"]);
    const run = foldToolEvidence(seed, appendEntries(undefined, [result("web-search", true, { toolCallId: "p2" })]));
    expect(missingRequired(run, ["web-search"], { "web-search": 2 })).toEqual([]);
  });

  // Pin (b): a guard-blocked call never executed. Its warning (even a
  // success:true one, repetitionGuard's shape) is neither a success nor an attempt.
  it("a guard-blocked call satisfies no quantity and is no attempt", () => {
    const blocked = (success: boolean) =>
      makeStep("observation", "⚠️ already called probe 2 times", {
        frameworkInstrumentation: GUARD_OBSERVATION_TAG,
        observationResult: makeObservationResult("probe", success, "⚠️ already called probe 2 times"),
      });
    const evidence = evidenceOf([obs("probe", true), blocked(true), blocked(false)]);
    expect(evidence.successfulCounts["probe"]).toBe(1);
    expect(evidence.attemptedCounts["probe"]).toBe(1);
    expect(missingRequired(evidence, ["probe"], { probe: 2 })).toEqual(["probe"]);
    expect(evidenceOf([blocked(false)]).permanentlyFailed).toEqual([]);
  });

  // ── Delegation (Cascade B root, Sys-audit 2026-07-29 RC#1) ──────────────────
  // A required tool satisfied 2+ delegation levels deep must count. The
  // executor rolls a grandchild's tools up into the spawn result's
  // `delegatedToolsUsed`, which the fold credits on success.
  describe("delegated / grandchild success", () => {
    it("credits a required tool satisfied only through delegation", () => {
      const evidence = evidenceOf([obs("spawn-agent", true, ["file-write"])]);
      expect(missingRequired(evidence, ["file-write"])).toEqual([]);
      expect(effectiveMissingRequired(evidence, ["file-write"])).toEqual([]);
    });

    it("a sub-agent's merged ledger entries are not this agent's calls or attempts", () => {
      const evidence = toolEvidence(
        appendEntries(undefined, [
          result("spawn-agent", true, { toolCallId: "s1", delegatedToolsUsed: ["file-write"] }),
          result("file-write", true, { toolCallId: "child-1", pass: "sub-agent:writer" }),
          result("web-search", false, { toolCallId: "child-2", pass: "sub-agent:writer" }),
        ]),
      );
      // One delegation credits file-write once — not again for the child's own entry.
      expect(evidence.successfulCounts["file-write"]).toBe(1);
      expect(missingRequired(evidence, ["file-write"], { "file-write": 2 })).toEqual(["file-write"]);
      // The child's failed search is not a failed attempt of this agent.
      expect(evidence.attemptedCounts["web-search"]).toBeUndefined();
      expect(evidence.permanentlyFailed).toEqual([]);
    });

    it("a delegated success clears a locally failed required tool", () => {
      const evidence = evidenceOf([obs("file-write", false), obs("spawn-agent", true, ["file-write"])]);
      expect(permanentlyFailedRequired(evidence, ["file-write"])).toEqual([]);
      expect(missingRequired(evidence, ["file-write"])).toEqual([]);
    });
  });
});
