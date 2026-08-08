// Run: bun test packages/reasoning/tests/kernel/capabilities/verify/requirement-state.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { makeStep } from "../../../../src/kernel/capabilities/sense/step-utils.js";
import {
  buildSuccessfulToolCallCounts,
  getMissingRequiredToolsFromSteps,
  buildAttemptedToolCallCounts,
  getPermanentlyFailedRequiredTools,
  getEffectiveMissingRequiredTools,
} from "../../../../src/kernel/capabilities/verify/requirement-state.js";
import { appendEntries, type RunLedger } from "../../../../src/kernel/ledger/run-ledger.js";

describe("requirement-state", () => {
  it("counts successful observations by tool name", () => {
    const steps = [
      makeStep("observation", "ok", {
        observationResult: {
          success: true,
          toolName: "web-search",
        } as any,
      }),
      makeStep("observation", "failed", {
        observationResult: {
          success: false,
          toolName: "web-search",
        } as any,
      }),
    ];

    expect(buildSuccessfulToolCallCounts(steps)["web-search"]).toBe(1);
  });

  it("does not double-count when delegated tool overlaps parent toolName", () => {
    const steps = [
      makeStep("observation", "delegated", {
        observationResult: {
          success: true,
          toolName: "spawn-agent",
          delegatedToolsUsed: ["web-search", "web-search"],
        } as any,
      }),
      makeStep("observation", "overlap", {
        observationResult: {
          success: true,
          toolName: "web-search",
          delegatedToolsUsed: ["web-search"],
        } as any,
      }),
    ];

    const counts = buildSuccessfulToolCallCounts(steps);
    expect(counts["web-search"]).toBe(2);
  });

  it("counts all observation attempts regardless of success", () => {
    const steps = [
      makeStep("observation", "fail1", {
        observationResult: { success: false, toolName: "gws-cli" } as any,
      }),
      makeStep("observation", "fail2", {
        observationResult: { success: false, toolName: "gws-cli" } as any,
      }),
      makeStep("observation", "ok", {
        observationResult: { success: true, toolName: "web-search" } as any,
      }),
    ];

    const counts = buildAttemptedToolCallCounts(steps);
    expect(counts["gws-cli"]).toBe(2);
    expect(counts["web-search"]).toBe(1);
  });

  it("identifies required tools that were attempted but never succeeded", () => {
    const steps = [
      makeStep("observation", "fail", {
        observationResult: { success: false, toolName: "gws-cli" } as any,
      }),
      makeStep("observation", "ok", {
        observationResult: { success: true, toolName: "web-search" } as any,
      }),
    ];

    const failed = getPermanentlyFailedRequiredTools(steps, ["gws-cli", "web-search", "file-write"]);
    // gws-cli: attempted + failed, web-search: succeeded, file-write: never attempted
    expect(failed).toContain("gws-cli");
    expect(failed).not.toContain("web-search");
    expect(failed).not.toContain("file-write");
  });

  it("does not mark a tool as permanently failed if it eventually succeeded", () => {
    const steps = [
      makeStep("observation", "fail", {
        observationResult: { success: false, toolName: "web-search" } as any,
      }),
      makeStep("observation", "ok", {
        observationResult: { success: true, toolName: "web-search" } as any,
      }),
    ];

    const failed = getPermanentlyFailedRequiredTools(steps, ["web-search"]);
    expect(failed).toHaveLength(0);
  });

  it("getEffectiveMissingRequiredTools excludes permanently-failed tools from nudge list", () => {
    const steps = [
      makeStep("observation", "fail", {
        observationResult: { success: false, toolName: "gws-cli" } as any,
      }),
    ];

    // gws-cli is required but permanently failed — should be excluded from effective missing
    const effective = getEffectiveMissingRequiredTools(steps, ["gws-cli", "file-write"]);
    expect(effective).not.toContain("gws-cli");
    // file-write was never attempted — still genuinely missing
    expect(effective).toContain("file-write");
  });

  it("getEffectiveMissingRequiredTools returns empty when all required tools either succeeded or permanently failed", () => {
    const steps = [
      makeStep("observation", "ok", {
        observationResult: { success: true, toolName: "web-search" } as any,
      }),
      makeStep("observation", "fail", {
        observationResult: { success: false, toolName: "gws-cli" } as any,
      }),
    ];

    const effective = getEffectiveMissingRequiredTools(steps, ["web-search", "gws-cli"]);
    expect(effective).toHaveLength(0);
  });

  it("computes missing required tools from successful counts", () => {
    const steps = [
      makeStep("observation", "ok", {
        observationResult: {
          success: true,
          toolName: "web-search",
        } as any,
      }),
    ];

    const missing = getMissingRequiredToolsFromSteps(
      steps,
      ["web-search", "file-write"],
      { "web-search": 2, "file-write": 1 },
    );

    expect(missing).toEqual(["web-search", "file-write"]);
  });

  // ── Substrate unification (Cascade B root, Sys-audit 2026-07-29 RC#1) ────────
  // The missing-required-tool authority read `steps` only; `isToolCalled`
  // (post-conditions) reads the run-scoped RunLedger — which merges a
  // sub-agent's calls (incl. GRANDCHILDREN) into the parent. A required tool
  // satisfied 2+ delegation levels deep was therefore MISSING here while CALLED
  // there, and runner.ts §8 then failed the run + NULLED the correct
  // deliverable. These pin the ledger onto the same substrate.
  describe("ledger substrate (delegated / grandchild success)", () => {
    // A grandchild's file-write lives ONLY in the run-scoped ledger as a
    // `tool-result` (merged, stamped sub-agent), never in the parent's steps.
    const delegatedLedger = (): RunLedger =>
      appendEntries(undefined, [
        {
          kind: "tool-result",
          iteration: 1,
          toolName: "file-write",
          toolCallId: "grandchild-tc-1",
          success: true,
          preview: "wrote ./out.md",
        },
      ]);

    it("credits a required tool satisfied only via a ledger tool-result (not in steps)", () => {
      const steps = [
        makeStep("observation", "delegated", {
          observationResult: { success: true, toolName: "spawn-agent" } as any,
        }),
      ];
      // Steps-only: file-write looks missing (RED without the fix).
      expect(getMissingRequiredToolsFromSteps(steps, ["file-write"])).toEqual(["file-write"]);
      // Ledger-aware: the grandchild's write counts → nothing missing.
      expect(
        getMissingRequiredToolsFromSteps(steps, ["file-write"], undefined, delegatedLedger()),
      ).toEqual([]);
      expect(
        getEffectiveMissingRequiredTools(steps, ["file-write"], undefined, delegatedLedger()),
      ).toEqual([]);
    });

    it("does NOT double-count a local call present in BOTH steps and ledger (toolCallId dedupe)", () => {
      const steps = [
        makeStep("observation", "local write", {
          toolCallId: "local-tc-1",
          observationResult: { success: true, toolName: "file-write" } as any,
        }),
      ];
      // The ledger grows a tool-result from that SAME local observation.
      const ledger = appendEntries(undefined, [
        {
          kind: "tool-result",
          iteration: 1,
          toolName: "file-write",
          toolCallId: "local-tc-1",
          success: true,
          preview: "wrote ./out.md",
        },
      ]);
      // Count must stay 1 — a quantity>1 requirement must NOT be satisfied by a
      // single call double-counted across the two substrates.
      expect(buildSuccessfulToolCallCounts(steps, ledger)["file-write"]).toBe(1);
      expect(
        getMissingRequiredToolsFromSteps(steps, ["file-write"], { "file-write": 2 }, ledger),
      ).toEqual(["file-write"]);
    });

    it("is byte-identical to steps-only when no ledger is supplied", () => {
      const steps = [
        makeStep("observation", "ok", {
          observationResult: { success: true, toolName: "web-search" } as any,
        }),
      ];
      expect(buildSuccessfulToolCallCounts(steps)).toEqual(
        buildSuccessfulToolCallCounts(steps, undefined),
      );
      expect(getMissingRequiredToolsFromSteps(steps, ["file-write"])).toEqual(["file-write"]);
    });

    it("a ledger-success clears a locally permanently-failed required tool", () => {
      // file-write failed locally, but a grandchild succeeded (ledger).
      const steps = [
        makeStep("observation", "local fail", {
          observationResult: { success: false, toolName: "file-write" } as any,
        }),
      ];
      // Steps-only: permanently failed.
      expect(getPermanentlyFailedRequiredTools(steps, ["file-write"])).toEqual(["file-write"]);
      // Ledger-aware: it DID succeed deeper → not permanently failed.
      expect(getPermanentlyFailedRequiredTools(steps, ["file-write"], delegatedLedger())).toEqual([]);
    });
  });
});
