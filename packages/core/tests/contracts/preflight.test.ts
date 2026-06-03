// Run: bun test packages/core/tests/contracts/preflight.test.ts --timeout 15000
//
// Canonical PreFlight contract (2026-06-02-canonical-contracts-and-invariants §2.5).
// The single typed boundary that asserts "this run can honor the contracts."
// Both consumers — agent.build() and the bench runner — share ONE decision
// function so "capability source=fallback is a violation" is defined in exactly
// one place. This is the forward-value unification of the two ad-hoc gates
// shipped earlier (bench preflight + runtime build gate).
import { describe, it, expect } from "bun:test";
import {
  capabilitySourcePreflight,
  formatViolations,
  emptyPreFlightReport,
  type PreFlightViolation,
} from "../../src/contracts/preflight.js";

describe("PreFlight contract — capability-source", () => {
  it("returns a capability-source violation when source is fallback", () => {
    const v = capabilitySourcePreflight({
      provider: "ollama",
      model: "definitely-not-real",
      source: "fallback",
      recommendedNumCtx: 2048,
    });
    expect(v).not.toBeNull();
    const violation = v as PreFlightViolation;
    expect(violation.kind).toBe("capability-source");
    expect(violation.provider).toBe("ollama");
    expect(violation.model).toBe("definitely-not-real");
    expect(violation.source).toBe("fallback");
    expect(violation.recommendedNumCtx).toBe(2048);
    expect(violation.remedy.length).toBeGreaterThan(0);
  }, 15000);

  it("returns null for a trusted source (static-table)", () => {
    expect(
      capabilitySourcePreflight({
        provider: "ollama",
        model: "qwen3:14b",
        source: "static-table",
        recommendedNumCtx: 32768,
      }),
    ).toBeNull();
  }, 15000);

  it("returns null for probe and cache sources", () => {
    expect(
      capabilitySourcePreflight({ provider: "a", model: "b", source: "probe", recommendedNumCtx: 1 }),
    ).toBeNull();
    expect(
      capabilitySourcePreflight({ provider: "a", model: "b", source: "cache", recommendedNumCtx: 1 }),
    ).toBeNull();
  }, 15000);

  it("formatViolations renders model + fallback signal for each violation", () => {
    const v = capabilitySourcePreflight({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      source: "fallback",
      recommendedNumCtx: 2048,
    })!;
    const text = formatViolations([v]);
    expect(text).toContain("claude-sonnet-4-5");
    expect(text).toMatch(/fallback/i);
  }, 15000);

  it("emptyPreFlightReport has empty violations and warnings", () => {
    expect(emptyPreFlightReport.violations).toEqual([]);
    expect(emptyPreFlightReport.warnings).toEqual([]);
  }, 15000);
});
