// Run: bun test packages/reasoning/tests/types/observation-trust-level.test.ts --timeout 15000
//
// Phase 1 Sprint 2 S2.3 — trustLevel on ObservationResult.
// Spec: docs/spec/docs/15-design-north-star.md §4 (AgentMemory + ContextCurator).
//
// Q5 resolved (user-confirmed 2026-04-24): internal meta-tools grandfather
// to trustLevel: "trusted" with trustJustification: "grandfather-phase-1".
// CI lint enforces real justifications by Phase 3.
//
// trustLevel exists so ContextCurator (S2.5) knows which observations are
// safe to render inline in the system prompt vs which must go in
// <tool_output> blocks where prompt-injection content can't escape.

import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import {
  ObservationResultSchema,
  KNOWN_TRUSTED_TOOL_NAMES,
} from "../../src/types/observation.js";
import { makeObservationResult } from "../../src/kernel/capabilities/act/tool-execution.js";

describe("ObservationResult.trustLevel (Phase 1 S2.3)", () => {
  it("schema requires trustLevel field (one of 'trusted' | 'untrusted')", () => {
    // Valid trusted
    const trusted = Schema.decodeUnknownEither(ObservationResultSchema)({
      success: true,
      toolName: "recall",
      displayText: "ok",
      category: "scratchpad",
      resultKind: "data",
      preserveOnCompaction: false,
      trustLevel: "trusted",
      trustJustification: "grandfather-phase-1",
    });
    expect(trusted._tag).toBe("Right");

    // Valid untrusted (no justification needed)
    const untrusted = Schema.decodeUnknownEither(ObservationResultSchema)({
      success: true,
      toolName: "web-search",
      displayText: "ok",
      category: "web-search",
      resultKind: "data",
      preserveOnCompaction: false,
      trustLevel: "untrusted",
    });
    expect(untrusted._tag).toBe("Right");

    // Invalid trustLevel value
    const bad = Schema.decodeUnknownEither(ObservationResultSchema)({
      success: true,
      toolName: "x",
      displayText: "ok",
      category: "custom",
      resultKind: "data",
      preserveOnCompaction: false,
      trustLevel: "kinda-trusted",
    });
    expect(bad._tag).toBe("Left");
  });

  it("makeObservationResult derives trustLevel: 'trusted' for known internal meta-tools", () => {
    const trustedNames = ["recall", "brief", "pulse", "activate-skill", "final-answer"];
    for (const name of trustedNames) {
      const r = makeObservationResult(name, true, "ok");
      expect(r.trustLevel).toBe("trusted");
      expect(r.trustJustification).toBe("grandfather-phase-1");
    }
  });

  it("makeObservationResult derives trustLevel: 'untrusted' for user-defined tools", () => {
    const untrustedNames = ["web-search", "http-get", "file-read", "code-execute", "my-custom-tool"];
    for (const name of untrustedNames) {
      const r = makeObservationResult(name, true, "ok");
      expect(r.trustLevel).toBe("untrusted");
      expect(r.trustJustification).toBeUndefined();
    }
  });

  it("KNOWN_TRUSTED_TOOL_NAMES is the documented grandfather set (Q5)", () => {
    // Pin the membership so future additions to the set are explicit.
    // Adding a name here is the framework saying "this tool's output is
    // safe to render inline" — should be a deliberate decision.
    expect(KNOWN_TRUSTED_TOOL_NAMES).toContain("recall");
    expect(KNOWN_TRUSTED_TOOL_NAMES).toContain("brief");
    expect(KNOWN_TRUSTED_TOOL_NAMES).toContain("pulse");
    expect(KNOWN_TRUSTED_TOOL_NAMES).toContain("activate-skill");
    expect(KNOWN_TRUSTED_TOOL_NAMES).toContain("final-answer");
    expect(KNOWN_TRUSTED_TOOL_NAMES).toContain("find");
    expect(KNOWN_TRUSTED_TOOL_NAMES).toContain("checkpoint");
    expect(KNOWN_TRUSTED_TOOL_NAMES).toContain("harness-deliverable");
    // user-defined tools must NOT be in the set
    expect(KNOWN_TRUSTED_TOOL_NAMES).not.toContain("web-search");
    expect(KNOWN_TRUSTED_TOOL_NAMES).not.toContain("file-write");
    expect(KNOWN_TRUSTED_TOOL_NAMES).not.toContain("code-execute");
  });

  it("makeObservationResult preserves all prior fields (backwards compat additive)", () => {
    const r = makeObservationResult("file-write", true, "wrote 5 bytes", {
      delegatedToolsUsed: ["spawn-agent"],
    });
    expect(r.success).toBe(true);
    expect(r.toolName).toBe("file-write");
    expect(r.displayText).toBe("wrote 5 bytes");
    expect(r.category).toBe("file-write");
    expect(r.preserveOnCompaction).toBe(false); // success path; only errors preserve
    expect(r.delegatedToolsUsed).toEqual(["spawn-agent"]);
    // New field also present
    expect(r.trustLevel).toBe("untrusted");
  });

  it("trustJustification is required when trustLevel is 'trusted' (per spec discipline)", () => {
    // The schema doesn't enforce this conditional today (Effect Schema
    // doesn't have a great syntax for "this field requires that field").
    // Discipline is enforced at construction site (makeObservationResult
    // always pairs them). This test pins the construction-site contract.
    const trustedResult = makeObservationResult("recall", true, "ok");
    expect(trustedResult.trustLevel).toBe("trusted");
    expect(trustedResult.trustJustification).toBeDefined();
    expect(trustedResult.trustJustification!.length).toBeGreaterThan(0);
  });
});
