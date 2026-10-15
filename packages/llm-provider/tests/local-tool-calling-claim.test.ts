// packages/llm-provider/tests/local-tool-calling-claim.test.ts
// Run: bun test packages/llm-provider/tests/local-tool-calling-claim.test.ts --timeout 15000
//
// Wave 2a Area 2 — the `supportsToolCalling` claim is DERIVED from the probe
// ladder (template tool-token emission ∧ dialect), not hardcoded true.
// Pins the four fail-safe arms of deriveSupportsToolCalling:
//   measured-no-emission → strict false
//   emission + dialect none → false with reason
//   emission + dialect ok → true
//   unmeasured → permissive true, provisional

import { describe, it, expect, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deriveSupportsToolCalling } from "../src/providers/local.js";
import { clearCalibrationCache } from "../src/calibration.js";
import type { Capability } from "../src/capability.js";

function capWith(overrides: Partial<Capability>): Capability {
  return {
    provider: "ollama",
    model: "claim-test-model:v1",
    tier: "local",
    maxContextTokens: 32_768,
    recommendedNumCtx: 32_768,
    maxOutputTokens: 4096,
    tokenizerFamily: "unknown",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "probe",
    ...overrides,
  };
}

describe("deriveSupportsToolCalling — fail-safe arms", () => {
  afterEach(() => {
    clearCalibrationCache();
  });

  it("arm 1: measured NO template emission → strict false, not provisional", () => {
    const claim = deriveSupportsToolCalling(
      capWith({ toolTemplateEmitsTokens: false }),
    );
    expect(claim.supported).toBe(false);
    expect(claim.provisional).toBe(false);
    expect(claim.reason).toContain("no tool-call tokens");
  }, 15_000);

  it("arm 2: emission + dialect none (capability record) → false with reason", () => {
    const claim = deriveSupportsToolCalling(
      capWith({ toolTemplateEmitsTokens: true, toolCallDialect: "none" }),
    );
    expect(claim.supported).toBe(false);
    expect(claim.provisional).toBe(false);
    expect(claim.reason).toContain("dialect");
  }, 15_000);

  it("arm 2b: emission + measured dialect posterior 'none' overrides native-fc record", () => {
    // Plant a user-cache calibration with toolCallDialect "none" for this model.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ra-claim-home-"));
    const originalHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const norm = "claim-posterior-model-v1"; // normalizeModelId("claim-posterior-model:v1")
      fs.mkdirSync(path.join(home, ".reactive-agents", "calibrations"), { recursive: true });
      fs.writeFileSync(
        path.join(home, ".reactive-agents", "calibrations", `${norm}.json`),
        JSON.stringify({
          modelId: "claim-posterior-model:v1",
          calibratedAt: "2026-10-13T00:00:00.000Z",
          probeVersion: 1,
          runsAveraged: 3,
          steeringCompliance: "hybrid",
          parallelCallCapability: "sequential-only",
          observationHandling: "uses-recall",
          systemPromptAttention: "moderate",
          optimalToolResultChars: 1200,
          toolCallDialect: "none",
        }),
        "utf-8",
      );
      clearCalibrationCache();
      const claim = deriveSupportsToolCalling(
        capWith({
          model: "claim-posterior-model:v1",
          toolTemplateEmitsTokens: true,
          toolCallDialect: "native-fc",
        }),
      );
      expect(claim.supported).toBe(false);
      expect(claim.reason).toContain("posterior");
    } finally {
      process.env.HOME = originalHome;
      fs.rmSync(home, { recursive: true, force: true });
    }
  }, 15_000);

  it("arm 3: emission + dialect ok → true", () => {
    const claim = deriveSupportsToolCalling(
      capWith({ toolTemplateEmitsTokens: true, toolCallDialect: "native-fc" }),
    );
    expect(claim.supported).toBe(true);
    expect(claim.reason).toContain("emits tool tokens");
  }, 15_000);

  it("arm 4: unmeasured template → permissive true with provisional mark", () => {
    const claim = deriveSupportsToolCalling(
      capWith({
        toolTemplateEmitsTokens: undefined,
        source: "static-table",
      }),
    );
    expect(claim.supported).toBe(true);
    expect(claim.provisional).toBe(true);
    expect(claim.reason).toContain("unmeasured");
  }, 15_000);
});
