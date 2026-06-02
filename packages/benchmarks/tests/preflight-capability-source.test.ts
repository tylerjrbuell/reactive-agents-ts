// Run: bun test packages/benchmarks/tests/preflight-capability-source.test.ts --timeout 15000
//
// Sprint-2 measurement-honesty gate. The bench MUST refuse to score a cell
// whose model capability resolved from `source === "fallback"` — fallback means
// the resolver had no probe / cache / static-table entry and silently used a
// conservative 2048-ctx default. Scoring such a cell produces a number that
// looks like a model result but is actually a misconfigured-budget artifact
// (root cause of the 2026-06-02 claude-haiku-4-5 baseline regression).
//
// Mirrors the existing Rule-4 judge guard discipline (rule4-guard.test.ts):
// refuse to run, loudly, rather than emit a dishonest score.
import { describe, it, expect } from "bun:test";
import {
  checkCapabilitySourcePreflight,
  type PreFlightViolation,
} from "../src/preflight.js";

describe("capability-source preflight gate", () => {
  it("emits a capability-source-fallback violation for a model that resolves to source=fallback", () => {
    const violations = checkCapabilitySourcePreflight([
      { provider: "ollama", model: "definitely-not-a-real-model-xyz" },
    ]);

    expect(violations.length).toBe(1);
    const v = violations[0] as PreFlightViolation;
    expect(v.kind).toBe("capability-source-fallback");
    expect(v.provider).toBe("ollama");
    expect(v.model).toBe("definitely-not-a-real-model-xyz");
    expect(v.source).toBe("fallback");
    expect(v.message).toContain("fallback");
  }, 15000);

  it("emits NO violation for a model present in the static-table (source=static-table)", () => {
    const violations = checkCapabilitySourcePreflight([
      { provider: "ollama", model: "qwen3:14b" },
    ]);

    expect(violations.length).toBe(0);
  }, 15000);

  it("reports one violation per fallback model across a mixed set", () => {
    const violations = checkCapabilitySourcePreflight([
      { provider: "ollama", model: "qwen3:14b" }, // static-table — clean
      { provider: "ollama", model: "bogus-a" }, // fallback
      { provider: "anthropic", model: "bogus-b" }, // fallback
    ]);

    expect(violations.length).toBe(2);
    expect(violations.map((v) => v.model).sort()).toEqual(["bogus-a", "bogus-b"]);
  }, 15000);

  it("suppresses all violations when allowFallback override is set (explicit opt-out)", () => {
    const violations = checkCapabilitySourcePreflight(
      [{ provider: "ollama", model: "definitely-not-a-real-model-xyz" }],
      { allowFallback: true },
    );

    expect(violations.length).toBe(0);
  }, 15000);
});
