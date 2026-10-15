// packages/llm-provider/tests/calibration-prior-floor.test.ts
// Run: bun test packages/llm-provider/tests/calibration-prior-floor.test.ts --timeout 15000
//
// GH #243 — a shipped calibration prior can only flip live routing to
// unsupported when it clears the confidence floor. Wave-2 close capture
// measured S3 qwen3:4b regressing 5/5 -> 0/5 because a 2026-05-24
// runsAveraged:1 prior (which the calibration-runner never even measured —
// it ships a hardcoded stub `toolCallDialect: "none"`) overrode live template
// evidence. Review Focus #2's "unknown never strands" applies to UNKNOWN
// CONFIDENCE too: ra < floor = contradicted-by-probe territory = permissive.

import { describe, it, expect, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  deriveSupportsToolCalling,
  DIALECT_PRIOR_CONFIDENCE_FLOOR,
} from "../src/providers/local.js";
import { clearCalibrationCache } from "../src/calibration.js";
import { detectToolTemplateEmission } from "../src/providers/local-probe.js";
import type { Capability } from "../src/capability.js";

function capWith(overrides: Partial<Capability>): Capability {
  return {
    provider: "ollama",
    model: "floor-test-model:v1",
    tier: "local",
    maxContextTokens: 32_768,
    recommendedNumCtx: 32_768,
    maxOutputTokens: 4096,
    tokenizerFamily: "llama",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    source: "probe",
    ...overrides,
  };
}

/** Plant a prebaked-style user-cache calibration; returns the model id. */
function plantPrior(dialect: string | null, runsAveraged: number, model: string): () => void {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ra-243-home-"));
  const originalHome = process.env.HOME;
  process.env.HOME = home;
  const norm = model.toLowerCase().replace(/:/g, "-").replace(/\s+/g, "-");
  fs.mkdirSync(path.join(home, ".reactive-agents", "calibrations"), { recursive: true });
  const body: Record<string, unknown> = {
    modelId: model,
    calibratedAt: "2026-05-24T00:00:00.000Z",
    probeVersion: 1,
    runsAveraged,
    steeringCompliance: "hybrid",
    parallelCallCapability: "sequential-only",
    observationHandling: "uses-recall",
    systemPromptAttention: "moderate",
    optimalToolResultChars: 1200,
  };
  if (dialect !== null) body.toolCallDialect = dialect;
  fs.writeFileSync(path.join(home, ".reactive-agents", "calibrations", `${norm}.json`), JSON.stringify(body), "utf-8");
  clearCalibrationCache();
  return () => {
    process.env.HOME = originalHome;
    fs.rmSync(home, { recursive: true, force: true });
    clearCalibrationCache();
  };
}

describe("GH #243 — dialect prior confidence floor", () => {
  afterEach(() => {
    clearCalibrationCache();
  });

  it("floor constant is 2 (wave-2 close capture: ra=1 prior caused the regression)", () => {
    expect(DIALECT_PRIOR_CONFIDENCE_FLOOR).toBe(2);
  }, 15_000);

  it("RED CORE: explicit dialect:none prior with runsAveraged:1 + probe says template emits => supportsToolCalling STAYS TRUE", () => {
    const cleanup = plantPrior("none", 1, "floor-red:v1");
    try {
      const claim = deriveSupportsToolCalling(
        capWith({ model: "floor-red:v1", toolTemplateEmitsTokens: true, toolCallDialect: "native-fc" }),
      );
      expect(claim.supported).toBe(true);
      expect(claim.provisional).toBe(true);
      expect(claim.reason).toContain("floor");
    } finally {
      cleanup();
    }
  }, 15_000);

  it("explicit dialect:none prior at/above the floor is honored (false, not provisional)", () => {
    const cleanup = plantPrior("none", 3, "floor-honor:v1");
    try {
      const claim = deriveSupportsToolCalling(
        capWith({ model: "floor-honor:v1", toolTemplateEmitsTokens: true, toolCallDialect: "native-fc" }),
      );
      expect(claim.supported).toBe(false);
      expect(claim.provisional).toBe(false);
      expect(claim.reason).toContain("posterior");
    } finally {
      cleanup();
    }
  }, 15_000);

  it("ABSENT toolCallDialect field is NOT a none-claim (schema-default priors never strand)", () => {
    // The runner historically omitted the field on some models while the
    // schema defaulted it to "none" — a phantom claim. Explicit-presence is
    // required for any prior to affect routing.
    const cleanup = plantPrior(null, 3, "floor-absent:v1");
    try {
      const claim = deriveSupportsToolCalling(
        capWith({ model: "floor-absent:v1", toolTemplateEmitsTokens: true, toolCallDialect: "native-fc" }),
      );
      expect(claim.supported).toBe(true);
    } finally {
      cleanup();
    }
  }, 15_000);

  it("template UNMEASURED + confident prior (ra >= floor, explicit none) => prior honored", () => {
    const cleanup = plantPrior("none", 3, "floor-arm1:v1");
    try {
      const claim = deriveSupportsToolCalling(
        capWith({ model: "floor-arm1:v1", toolTemplateEmitsTokens: undefined, source: "static-table" }),
      );
      expect(claim.supported).toBe(false);
      expect(claim.reason).toContain("prior");
    } finally {
      cleanup();
    }
  }, 15_000);

  it("template UNMEASURED + below-floor prior => permissive provisional stands", () => {
    const cleanup = plantPrior("none", 1, "floor-arm1low:v1");
    try {
      const claim = deriveSupportsToolCalling(
        capWith({ model: "floor-arm1low:v1", toolTemplateEmitsTokens: undefined, source: "static-table" }),
      );
      expect(claim.supported).toBe(true);
      expect(claim.provisional).toBe(true);
    } finally {
      cleanup();
    }
  }, 15_000);

  it("qwen3:4b at HEAD derives tool-capable (floor logic + refreshed prior)", () => {
    // The shipped prior (src/calibrations/qwen3-4b.json) is what bricked S3
    // in the wave-2 capture. Post-fix it must BOTH (a) be refreshed to a
    // probe-measured dialect (audit) and (b) be inert under the floor if not.
    // Probe-realistic capability: template emits true, card says native-fc.
    clearCalibrationCache();
    const claim = deriveSupportsToolCalling(
      capWith({ model: "qwen3:4b", toolTemplateEmitsTokens: true, toolCallDialect: "native-fc" }),
    );
    expect(claim.supported).toBe(true);
  }, 15_000);

  it("GH #243 audit: plugin-model stub templates are UNMEASURED, never a stranding false", () => {
    // gemma4:e4b /api/show returns a 13-char passthrough stub (the real
    // template lives in Ollama's Go code) while behaving native-FC 2/3 —
    // scanning the stub for tool tokens would measure a stranding `false`.
    expect(detectToolTemplateEmission("{{ .Prompt }}")).toBeUndefined();
    // A scannable plain template (>= floor length) still measures false.
    expect(
      detectToolTemplateEmission(
        "{{- range .Messages }}<|start|>{{ .Role }}<|split|>{{ .Content }}<|end|>{{- end }}",
      ),
    ).toBe(false);
  }, 15_000);
});
