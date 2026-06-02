// Run: bun test packages/runtime/tests/build-validation-capability-source.test.ts --timeout 15000
//
// Runtime-side capability-source honesty gate. Mirrors the bench preflight
// (packages/benchmarks/src/preflight.ts) but at agent BUILD time. When a model
// resolves to Capability.source === "fallback" (no probe/cache/static-table
// entry → silent 2048-ctx default), the framework must SURFACE it, not run
// silently degraded: a loud warning by default, an error under strictValidation.
//
// Closes the bench↔runtime asymmetry: the bench refuses to SCORE a fallback
// cell; the agent should still RUN (the user wants their answer) but must not
// HIDE that it's running on a misconfigured budget (anti-mission #4).
import { describe, it, expect } from "bun:test";
import { validateBuild } from "../src/build-validation.js";

const FALLBACK_MODEL = "claude-sonnet-4-5"; // not in STATIC_CAPABILITIES → source=fallback
const STATIC_MODEL = "claude-haiku-4-5"; // in STATIC_CAPABILITIES → source=static-table

describe("build-validation capability-source gate", () => {
  it("warns (non-strict) when the model resolves to source=fallback", () => {
    const { warnings, errors } = validateBuild(
      "anthropic",
      FALLBACK_MODEL,
      "claude-haiku-4-5",
      false,
    );
    expect(warnings.some((w) => /fallback/i.test(w) && w.includes(FALLBACK_MODEL))).toBe(true);
    expect(errors.some((e) => /fallback/i.test(e))).toBe(false);
  }, 15000);

  it("does NOT emit a capability-source warning for a static-table model", () => {
    const { warnings } = validateBuild("anthropic", STATIC_MODEL, "claude-haiku-4-5", false);
    expect(warnings.some((w) => /capability.*fallback|source.*fallback/i.test(w))).toBe(false);
  }, 15000);

  it("promotes the fallback warning to an error under strictValidation", () => {
    const { warnings, errors } = validateBuild(
      "anthropic",
      FALLBACK_MODEL,
      "claude-haiku-4-5",
      true,
    );
    expect(errors.some((e) => /fallback/i.test(e) && e.includes(FALLBACK_MODEL))).toBe(true);
    expect(warnings.some((w) => /fallback/i.test(w) && w.includes(FALLBACK_MODEL))).toBe(false);
  }, 15000);
});
