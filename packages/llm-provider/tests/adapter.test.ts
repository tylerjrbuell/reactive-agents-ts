// Run: bun test packages/llm-provider/tests/adapter.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { localModelAdapter, midModelAdapter, defaultAdapter, selectAdapter } from "../src/adapter.js";
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
        selectAdapter({ supportsToolCalling: true }, "mid", "qwen2.5-coder:7b").adapter,
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

  describe("localModelAdapter.systemPromptPatch", () => {
    it("appends multi-step instruction for local tier", () => {
      const patched = localModelAdapter.systemPromptPatch!("Base prompt.", "local");
      expect(patched).toContain("Base prompt.");
      expect(patched).toContain("IMPORTANT");
      expect(patched).toContain("ALL steps");
    });

    it("returns undefined for non-local tier", () => {
      const result = localModelAdapter.systemPromptPatch!("Base prompt.", "frontier");
      expect(result).toBeUndefined();
    });

    it("returns undefined for mid tier", () => {
      const result = localModelAdapter.systemPromptPatch!("Base prompt.", "mid");
      expect(result).toBeUndefined();
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

    it("has no systemPromptPatch", () => {
      expect(defaultAdapter.systemPromptPatch).toBeUndefined();
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
  it("sets toolGuidance for sequential-only models", () => {
    const cal: ModelCalibration = {
      ...baseCalibration,
      parallelCallCapability: "sequential-only",
    };
    const { adapter } = buildCalibratedAdapter(cal);
    expect(adapter.toolGuidance).toBeDefined();
    const guidance = adapter.toolGuidance!({
      toolNames: [],
      requiredTools: [],
      tier: "local",
    });
    expect(guidance?.toLowerCase()).toContain("one at a time");
  });

  it("sets toolGuidance for partial parallel models", () => {
    const cal: ModelCalibration = {
      ...baseCalibration,
      parallelCallCapability: "partial",
    };
    const { adapter } = buildCalibratedAdapter(cal);
    expect(adapter.toolGuidance).toBeDefined();
    const guidance = adapter.toolGuidance!({
      toolNames: [],
      requiredTools: [],
      tier: "local",
    });
    expect(guidance).toContain("2");
  });

  it("does NOT set toolGuidance for reliable parallel models", () => {
    const cal: ModelCalibration = {
      ...baseCalibration,
      parallelCallCapability: "reliable",
    };
    const { adapter } = buildCalibratedAdapter(cal);
    expect(adapter.toolGuidance).toBeUndefined();
  });

  it("sets systemPromptPatch for weak attention models", () => {
    const cal: ModelCalibration = {
      ...baseCalibration,
      systemPromptAttention: "weak",
    };
    const { adapter } = buildCalibratedAdapter(cal);
    expect(adapter.systemPromptPatch).toBeDefined();
    const patched = adapter.systemPromptPatch!("base prompt", "local");
    expect(patched).toContain("base prompt");
    expect((patched ?? "").length).toBeGreaterThan("base prompt".length);
  });

  it("does NOT set systemPromptPatch for strong attention models", () => {
    const cal: ModelCalibration = {
      ...baseCalibration,
      systemPromptAttention: "strong",
    };
    const { adapter } = buildCalibratedAdapter(cal);
    expect(adapter.systemPromptPatch).toBeUndefined();
  });

  it("sets profileOverrides.toolResultMaxChars from calibration", () => {
    const cal: ModelCalibration = {
      ...baseCalibration,
      optimalToolResultChars: 1500,
    };
    const { profileOverrides } = buildCalibratedAdapter(cal);
    expect(profileOverrides.toolResultMaxChars).toBe(1500);
  });

  it("compiles moderate systemPromptAttention to no patch", () => {
    const cal: ModelCalibration = {
      ...baseCalibration,
      systemPromptAttention: "moderate",
    };
    const { adapter } = buildCalibratedAdapter(cal);
    expect(adapter.systemPromptPatch).toBeUndefined();
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
});
