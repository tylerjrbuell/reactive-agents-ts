// Run: bun test packages/llm-provider/tests/adapter.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import {
  localModelAdapter,
  midModelAdapter,
  defaultAdapter,
  selectAdapter,
  composeAdapters,
  type ProviderAdapter,
} from "../src/adapter.js";
import {
  buildCalibratedAdapter,
  clearCalibrationCache,
  type ModelCalibration,
} from "../src/calibration.js";

describe("ProviderAdapter", () => {
  describe("selectAdapter", () => {
    it("returns { adapter: localModelAdapter } for local tier", () => {
      const result = selectAdapter({ supportsToolCalling: true }, "local");
      expect(result.adapter).toBe(localModelAdapter);
      expect(result.profileOverrides).toBeUndefined();
    });

    it("returns { adapter: defaultAdapter } for frontier tier", () => {
      const result = selectAdapter({ supportsToolCalling: true }, "frontier");
      expect(result.adapter).toBe(defaultAdapter);
      expect(result.profileOverrides).toBeUndefined();
    });

    it("returns { adapter: midModelAdapter } for mid tier", () => {
      const result = selectAdapter({ supportsToolCalling: true }, "mid");
      expect(result.adapter).toBe(midModelAdapter);
    });

    it("returns { adapter: defaultAdapter } when tier is undefined", () => {
      const result = selectAdapter({ supportsToolCalling: true });
      expect(result.adapter).toBe(defaultAdapter);
    });

    it("accepts optional modelId and falls back to tier when no calibration exists", () => {
      expect(
        selectAdapter({ supportsToolCalling: true }, "local", "totally-unknown:xyz").adapter,
      ).toBe(localModelAdapter);
      expect(
        selectAdapter({ supportsToolCalling: true }, "mid", "no-calibration-model:7b").adapter,
      ).toBe(midModelAdapter);
      expect(
        selectAdapter({ supportsToolCalling: true }, "frontier", "gpt-4o").adapter,
      ).toBe(defaultAdapter);
    });

    it("returns same tier adapter when modelId is undefined", () => {
      expect(
        selectAdapter({ supportsToolCalling: true }, "local", undefined).adapter,
      ).toBe(localModelAdapter);
    });

    it("returns new shape { adapter, profileOverrides? }", () => {
      const result = selectAdapter({ supportsToolCalling: true }, "mid");
      expect(result).toHaveProperty("adapter");
      // profileOverrides may be undefined when no calibration applies
    });
  });

  describe("localModelAdapter.continuationHint", () => {
    it("returns synthesis hint after search when file-write is missing", () => {
      const hint = localModelAdapter.continuationHint!({
        toolsUsed: new Set(["web-search"]),
        requiredTools: ["web-search", "file-write"],
        missingTools: ["file-write"],
        iteration: 3,
        maxIterations: 10,
        lastToolName: "web-search",
        lastToolResultPreview: "Search results...",
      });
      expect(hint).toContain("file-write");
      expect(hint?.toLowerCase()).toContain("synthesize");
      expect(hint).toContain("Do NOT search again");
    });

    it("returns synthesis hint after http call when file-write is missing", () => {
      const hint = localModelAdapter.continuationHint!({
        toolsUsed: new Set(["http-client"]),
        requiredTools: ["http-client", "file-write"],
        missingTools: ["file-write"],
        iteration: 2,
        maxIterations: 10,
        lastToolName: "http-client",
        lastToolResultPreview: "HTTP response...",
      });
      expect(hint).toContain("file-write");
      expect(hint?.toLowerCase()).toContain("synthesize");
    });

    it("returns undefined when no missing tools", () => {
      const hint = localModelAdapter.continuationHint!({
        toolsUsed: new Set(["web-search", "file-write"]),
        requiredTools: ["web-search", "file-write"],
        missingTools: [],
        iteration: 5,
        maxIterations: 10,
      });
      expect(hint).toBeUndefined();
    });

    it("adds urgency when near max iterations", () => {
      const hint = localModelAdapter.continuationHint!({
        toolsUsed: new Set(["web-search"]),
        requiredTools: ["web-search", "file-write"],
        missingTools: ["file-write"],
        iteration: 8,
        maxIterations: 10,
        lastToolName: "web-search",
      });
      expect(hint).toContain("urgent");
    });

    it("returns single-tool hint when only one tool is missing and last tool is not search", () => {
      const hint = localModelAdapter.continuationHint!({
        toolsUsed: new Set(["summarize"]),
        requiredTools: ["summarize", "send-email"],
        missingTools: ["send-email"],
        iteration: 2,
        maxIterations: 10,
        lastToolName: "summarize",
      });
      expect(hint).toContain("send-email");
      expect(hint).toContain("Your next step");
    });

    it("returns ordered list hint when multiple tools are missing", () => {
      const hint = localModelAdapter.continuationHint!({
        toolsUsed: new Set([]),
        requiredTools: ["web-search", "analyze", "file-write"],
        missingTools: ["web-search", "analyze", "file-write"],
        iteration: 1,
        maxIterations: 10,
      });
      expect(hint).toContain("web-search");
      expect(hint).toContain("analyze");
      expect(hint).toContain("file-write");
      expect(hint).toContain("in order");
    });
  });

  describe("defaultAdapter", () => {
    it("provides structured decision framework via continuationHint", () => {
      const hint = defaultAdapter.continuationHint!({
        toolsUsed: new Set(["web-search"]),
        requiredTools: ["web-search", "file-write"],
        missingTools: ["file-write"],
        iteration: 3,
        maxIterations: 10,
      });
      expect(hint).toContain("file-write");
      expect(hint).toContain("Call");
    });

    it("qualityCheck fires when tools were used", () => {
      const qc = defaultAdapter.qualityCheck!({
        task: "Get BTC price and create a markdown table",
        requiredTools: ["web-search"],
        toolsUsed: new Set(["web-search"]),
        tier: "frontier",
      });
      expect(qc).toBeDefined();
      expect(qc).toContain("tool results");
      expect(qc).toContain("format matches");
    });

    it("qualityCheck returns undefined when no tools used", () => {
      const qc = defaultAdapter.qualityCheck!({
        task: "What is 2+2?",
        requiredTools: [],
        toolsUsed: new Set(),
        tier: "frontier",
      });
      expect(qc).toBeUndefined();
    });

    it("synthesisPrompt fires when output tools remain", () => {
      const sp = defaultAdapter.synthesisPrompt!({
        toolsUsed: new Set(["web-search"]),
        missingOutputTools: ["file-write"],
        observationCount: 3,
        tier: "frontier",
      });
      expect(sp).toBeDefined();
      expect(sp).toContain("file-write");
    });

    it("synthesisPrompt returns undefined when no output tools missing", () => {
      const sp = defaultAdapter.synthesisPrompt!({
        toolsUsed: new Set(["web-search", "file-write"]),
        missingOutputTools: [],
        observationCount: 3,
        tier: "frontier",
      });
      expect(sp).toBeUndefined();
    });
  });

  describe("midModelAdapter.qualityCheck", () => {
    it("fires when tools were used for mid tier", () => {
      const qc = midModelAdapter.qualityCheck!({
        task: "Search for crypto prices",
        requiredTools: ["web-search"],
        toolsUsed: new Set(["web-search"]),
        tier: "mid",
      });
      expect(qc).toBeDefined();
      expect(qc).toContain("exact data");
    });

    it("returns undefined for non-mid tier", () => {
      const qc = midModelAdapter.qualityCheck!({
        task: "task",
        requiredTools: [],
        toolsUsed: new Set(["web-search"]),
        tier: "frontier",
      });
      expect(qc).toBeUndefined();
    });

    it("returns undefined when no tools used", () => {
      const qc = midModelAdapter.qualityCheck!({
        task: "task",
        requiredTools: [],
        toolsUsed: new Set(),
        tier: "mid",
      });
      expect(qc).toBeUndefined();
    });
  });
});

// ─── buildCalibratedAdapter ──────────────────────────────────────────────────

const baseCalibration: ModelCalibration = {
  modelId: "test-model",
  calibratedAt: "2026-04-14T10:00:00Z",
  probeVersion: 1,
  runsAveraged: 3,
  steeringCompliance: "hybrid",
  parallelCallCapability: "reliable",
  observationHandling: "needs-inline-facts",
  systemPromptAttention: "strong",
  optimalToolResultChars: 1500,
};

describe("buildCalibratedAdapter", () => {
  it("sets profileOverrides.toolResultMaxChars from calibration", () => {
    const cal: ModelCalibration = {
      ...baseCalibration,
      optimalToolResultChars: 1500,
    };
    const { profileOverrides } = buildCalibratedAdapter(cal);
    expect(profileOverrides.toolResultMaxChars).toBe(1500);
  });

  it("compiles to an EMPTY adapter overlay — no hook is written that nothing reads", () => {
    // systemPromptPatch / toolGuidance writes were deleted 2026-07-19 (debt
    // register P0-11): their call sites died in 279b61fb. Behavioral intents
    // flow through harness-plan / blueprint / recall readers instead.
    const { adapter } = buildCalibratedAdapter({
      ...baseCalibration,
      parallelCallCapability: "sequential-only",
      systemPromptAttention: "weak",
    });
    expect(Object.keys(adapter)).toEqual([]);
  });
});

// ─── composeAdapters (boundary B6) ───────────────────────────────────────────

describe("composeAdapters", () => {
  const base: ProviderAdapter = {
    continuationHint: () => "base-hint",
    qualityCheck: () => "base-qc",
  };

  it("overlay hook wins where set", () => {
    const overlay: ProviderAdapter = { qualityCheck: () => "overlay-qc" };
    const merged = composeAdapters(base, overlay);
    expect(
      merged.qualityCheck!({ task: "t", requiredTools: [], toolsUsed: new Set(), tier: "local" }),
    ).toBe("overlay-qc");
  });

  it("base hook survives where overlay is silent", () => {
    const merged = composeAdapters(base, { qualityCheck: () => "overlay-qc" });
    expect(
      merged.continuationHint!({
        toolsUsed: new Set(),
        requiredTools: [],
        missingTools: [],
        iteration: 1,
        maxIterations: 10,
      }),
    ).toBe("base-hint");
  });

  it("overlay keys explicitly set to undefined never clobber base hooks", () => {
    const overlay: ProviderAdapter = { continuationHint: undefined };
    const merged = composeAdapters(base, overlay);
    expect(merged.continuationHint).toBe(base.continuationHint);
  });

  it("never removes capability: every base hook is present after composing", () => {
    for (const tierAdapter of [localModelAdapter, midModelAdapter, defaultAdapter]) {
      const merged = composeAdapters(tierAdapter, {});
      for (const key of Object.keys(tierAdapter) as Array<keyof ProviderAdapter>) {
        expect(merged[key]).toBe(tierAdapter[key]!);
      }
    }
  });
});

describe("selectAdapter with calibration", () => {
  it("falls back to tier adapter when no calibration exists", () => {
    clearCalibrationCache();
    const result = selectAdapter(
      { supportsToolCalling: true },
      "local",
      "totally-unknown-model:xyz",
    );
    expect(result.adapter).toBe(localModelAdapter);
    expect(result.profileOverrides).toBeUndefined();
  });

  it("returns { adapter, profileOverrides? } shape", () => {
    const result = selectAdapter({ supportsToolCalling: true }, "mid");
    expect(result).toHaveProperty("adapter");
    // profileOverrides is optional when no calibration was loaded.
  });

  // ── MUTATION TEST (debt register P0-2, boundary B6) ────────────────────────
  // llama3.2:3b has a prebaked calibration in src/calibrations/llama3.2-3b.json
  // (optimalToolResultChars: 2000). Re-introducing the old early-return
  // `if (cal) return buildCalibratedAdapter(cal)` — which DISCARDS the tier
  // adapter — turns every hook assertion below red. Deleting the calibration
  // branch instead turns the profileOverrides assertion red. Both mutations
  // are killed.
  it("calibrated model keeps every tier hook (calibration is additive, never capability-removing)", () => {
    clearCalibrationCache();
    const { adapter, profileOverrides } = selectAdapter(
      { supportsToolCalling: true },
      "local",
      "llama3.2:3b",
    );

    // Proof the calibration actually loaded (kills the drop-calibration mutation):
    expect(profileOverrides).toBeDefined();
    expect(profileOverrides!.toolResultMaxChars).toBe(2000);

    // Proof the tier adapter survived (kills the early-return-discard mutation):
    expect(adapter.continuationHint).toBe(localModelAdapter.continuationHint!);
    expect(adapter.errorRecovery).toBe(localModelAdapter.errorRecovery!);
    expect(adapter.synthesisPrompt).toBe(localModelAdapter.synthesisPrompt!);
    expect(adapter.qualityCheck).toBe(localModelAdapter.qualityCheck!);
  });

  it("calibrated model is never weaker than its uncalibrated tier baseline", () => {
    clearCalibrationCache();
    const calibrated = selectAdapter({ supportsToolCalling: true }, "local", "llama3.2:3b");
    const baseline = selectAdapter({ supportsToolCalling: true }, "local");
    for (const key of Object.keys(baseline.adapter) as Array<keyof ProviderAdapter>) {
      expect(calibrated.adapter[key]).toBeDefined();
    }
  });
});
