import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import {
  preservePrivacy,
  classifyModelTier,
  bucketToHour,
  sanitizeToolNames,
  TelemetryAggregatorTag,
  TelemetryAggregatorLive,
  SAFE_TOOL_NAMES,
  TelemetryRecordSchema,
} from "../src/telemetry/index.js";
import type { RawRunData, TelemetryRecord } from "../src/telemetry/index.js";
import { Schema } from "effect";

// ─── Helpers ───

const sampleRawData: RawRunData = {
  strategy: "reactive",
  model: "claude-sonnet-4-20250514",
  tokensIn: 1000,
  tokensOut: 500,
  latencyMs: 3000,
  success: true,
  toolNames: ["file-read", "web-search", "my-custom-tool"],
  iterationCount: 5,
  costUsd: 0.05,
  cacheHitRate: 0.3,
  timestamp: new Date("2026-03-06T14:32:17Z"),
};

const runAgg = <A>(effect: Effect.Effect<A, never, TelemetryAggregatorTag>) =>
  Effect.runPromise(Effect.provide(effect, TelemetryAggregatorLive));

// ─── Privacy Preserver ───

describe("PrivacyPreserver", () => {
  describe("preservePrivacy", () => {
    it("generates a fresh random runId", () => {
      const r1 = preservePrivacy(sampleRawData);
      const r2 = preservePrivacy(sampleRawData);
      expect(r1.runId).not.toBe(r2.runId);
      expect(r1.runId).toMatch(
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
      );
    });

    it("classifies model to coarse tier (never leaks exact name)", () => {
      const r = preservePrivacy(sampleRawData);
      expect(["local", "small", "medium", "large", "frontier"]).toContain(r.modelTier);
      // The raw model name should NOT appear in the record
      expect(JSON.stringify(r)).not.toContain("claude-sonnet");
    });

    it("preserves strategy name unchanged", () => {
      const r = preservePrivacy(sampleRawData);
      expect(r.strategy).toBe("reactive");
    });

    it("preserves success boolean unchanged", () => {
      const r = preservePrivacy(sampleRawData);
      expect(r.success).toBe(true);
    });

    it("adds noise to numerical fields (tokens are integers)", () => {
      const r = preservePrivacy(sampleRawData);
      expect(Number.isInteger(r.tokensIn)).toBe(true);
      expect(Number.isInteger(r.tokensOut)).toBe(true);
      expect(Number.isInteger(r.latencyMs)).toBe(true);
      expect(Number.isInteger(r.iterationCount)).toBe(true);
    });

    it("clamps noised values to non-negative", () => {
      // With ε=0.1 and small values, noise can dominate. Run multiple times.
      for (let i = 0; i < 20; i++) {
        const r = preservePrivacy({ ...sampleRawData, tokensIn: 1, tokensOut: 1, costUsd: 0.001 });
        expect(r.tokensIn).toBeGreaterThanOrEqual(0);
        expect(r.tokensOut).toBeGreaterThanOrEqual(0);
        expect(r.costUsd).toBeGreaterThanOrEqual(0);
        expect(r.cacheHitRate).toBeGreaterThanOrEqual(0);
        expect(r.cacheHitRate).toBeLessThanOrEqual(1);
        expect(r.iterationCount).toBeGreaterThanOrEqual(1);
      }
    });

    it("strips custom tool names, keeps built-in", () => {
      const r = preservePrivacy(sampleRawData);
      expect(r.toolNames).toContain("file-read");
      expect(r.toolNames).toContain("web-search");
      expect(r.toolNames).not.toContain("my-custom-tool");
      expect(r.toolNames).toContain("custom");
    });

    it("buckets timestamp to the hour", () => {
      const r = preservePrivacy(sampleRawData);
      // Minutes/seconds/ms should be 0
      expect(r.timestampBucket).toMatch(/T\d{2}:00:00\.000Z$/);
      expect(r.timestampBucket).toContain("2026-03-06T14:");
    });

    it("validates against TelemetryRecordSchema", () => {
      const r = preservePrivacy(sampleRawData);
      const decoded = Schema.decodeUnknownSync(TelemetryRecordSchema)(r);
      expect(decoded.runId).toBe(r.runId);
    });

    it("respects custom epsilon (higher epsilon = less noise)", () => {
      // With very high epsilon the noise should be minimal
      const results = Array.from({ length: 50 }, () =>
        preservePrivacy(sampleRawData, { epsilon: 100 }),
      );
      const avgTokensIn = results.reduce((sum, r) => sum + r.tokensIn, 0) / results.length;
      // Average should be close to original (1000) with high epsilon
      expect(Math.abs(avgTokensIn - 1000)).toBeLessThan(200);
    });
  });

  describe("classifyModelTier", () => {
    it("classifies local models", () => {
      expect(classifyModelTier("ollama/llama3.2")).toBe("local");
      expect(classifyModelTier("mistral-7b")).toBe("local");
    });

    it("classifies frontier models", () => {
      expect(classifyModelTier("claude-opus-4-20250514")).toBe("frontier");
      expect(classifyModelTier("o1-preview")).toBe("frontier");
      expect(classifyModelTier("o3-mini")).toBe("frontier");
    });

    it("classifies large models", () => {
      expect(classifyModelTier("claude-sonnet-4-20250514")).toBe("large");
      expect(classifyModelTier("gpt-4o")).toBe("large");
    });

    it("classifies medium models", () => {
      expect(classifyModelTier("claude-3-haiku")).toBe("medium");
      expect(classifyModelTier("gpt-3.5-turbo")).toBe("medium");
      expect(classifyModelTier("gemini-flash")).toBe("medium");
    });

    it("classifies small models", () => {
      expect(classifyModelTier("gpt-4o-mini")).toBe("small");
    });

    it("defaults to medium for unknown models", () => {
      expect(classifyModelTier("some-unknown-model")).toBe("medium");
    });
  });

  describe("bucketToHour", () => {
    it("zeros out minutes, seconds, and milliseconds", () => {
      const result = bucketToHour(new Date("2026-03-06T14:32:17.456Z"));
      expect(result).toBe("2026-03-06T14:00:00.000Z");
    });

    it("preserves exact hour boundaries", () => {
      const result = bucketToHour(new Date("2026-03-06T14:00:00.000Z"));
      expect(result).toBe("2026-03-06T14:00:00.000Z");
    });
  });

  describe("sanitizeToolNames", () => {
    it("keeps known built-in tools", () => {
      const result = sanitizeToolNames(["file-read", "web-search"]);
      expect(result).toEqual(["file-read", "web-search"]);
    });

    it("replaces custom tools with 'custom'", () => {
      const result = sanitizeToolNames(["file-read", "my-secret-tool"]);
      expect(result).toEqual(["file-read", "custom"]);
    });

    it("deduplicates multiple custom tools to single 'custom'", () => {
      const result = sanitizeToolNames(["tool-a", "tool-b", "file-read"]);
      expect(result).toContain("custom");
      expect(result).toContain("file-read");
      expect(result.filter((n) => n === "custom")).toHaveLength(1);
    });

    it("handles empty array", () => {
      expect(sanitizeToolNames([])).toEqual([]);
    });

    it("knows all safe tool names", () => {
      expect(SAFE_TOOL_NAMES.size).toBeGreaterThan(0);
      for (const name of SAFE_TOOL_NAMES) {
        const result = sanitizeToolNames([name]);
        expect(result).toEqual([name]);
      }
    });
  });
});

// ─── Local Aggregator ───

describe("TelemetryAggregator", () => {
  const makeSampleRecord = (overrides: Partial<TelemetryRecord> = {}): TelemetryRecord => ({
    runId: crypto.randomUUID(),
    strategy: "reactive",
    modelTier: "large",
    tokensIn: 1000,
    tokensOut: 500,
    latencyMs: 3000,
    success: true,
    toolNames: ["file-read"],
    iterationCount: 5,
    costUsd: 0.05,
    cacheHitRate: 0.3,
    timestampBucket: "2026-03-06T14:00:00.000Z",
    ...overrides,
  });

  it("starts with zero runs", async () => {
    const total = await runAgg(
      Effect.gen(function* () {
        const agg = yield* TelemetryAggregatorTag;
        return yield* agg.getTotalRuns();
      }),
    );
    expect(total).toBe(0);
  });

  it("records entries and increments total", async () => {
    const total = await runAgg(
      Effect.gen(function* () {
        const agg = yield* TelemetryAggregatorTag;
        yield* agg.record(makeSampleRecord());
        yield* agg.record(makeSampleRecord());
        yield* agg.record(makeSampleRecord());
        return yield* agg.getTotalRuns();
      }),
    );
    expect(total).toBe(3);
  });

  it("returns all records", async () => {
    const records = await runAgg(
      Effect.gen(function* () {
        const agg = yield* TelemetryAggregatorTag;
        yield* agg.record(makeSampleRecord({ strategy: "plan-execute" }));
        yield* agg.record(makeSampleRecord({ strategy: "tree-of-thought" }));
        return yield* agg.getRecords();
      }),
    );
    expect(records).toHaveLength(2);
    expect(records[0].strategy).toBe("plan-execute");
    expect(records[1].strategy).toBe("tree-of-thought");
  });

  it("computes aggregate statistics", async () => {
    const agg = await runAgg(
      Effect.gen(function* () {
        const a = yield* TelemetryAggregatorTag;
        yield* a.record(makeSampleRecord({ success: true, latencyMs: 1000, costUsd: 0.01 }));
        yield* a.record(makeSampleRecord({ success: true, latencyMs: 2000, costUsd: 0.02 }));
        yield* a.record(makeSampleRecord({ success: false, latencyMs: 5000, costUsd: 0.10 }));
        return yield* a.getAggregate();
      }),
    );

    expect(agg.totalRuns).toBe(3);
    expect(agg.successfulRuns).toBe(2);
    expect(agg.successRate).toBeCloseTo(2 / 3, 5);
    expect(agg.meanLatencyMs).toBeCloseTo((1000 + 2000 + 5000) / 3, 1);
    expect(agg.totalCostUsd).toBeCloseTo(0.13, 5);
    expect(agg.meanCostUsd).toBeCloseTo(0.13 / 3, 5);
  });

  it("computes p95 latency", async () => {
    const agg = await runAgg(
      Effect.gen(function* () {
        const a = yield* TelemetryAggregatorTag;
        // Record 20 entries with known latencies
        for (let i = 1; i <= 20; i++) {
          yield* a.record(makeSampleRecord({ latencyMs: i * 100 }));
        }
        return yield* a.getAggregate();
      }),
    );
    // p95 of sorted [100, 200, ..., 2000] at index ceil(20*0.95)-1 = 18 → 1900
    expect(agg.p95LatencyMs).toBe(1900);
  });

  it("tracks strategy distribution", async () => {
    const agg = await runAgg(
      Effect.gen(function* () {
        const a = yield* TelemetryAggregatorTag;
        yield* a.record(makeSampleRecord({ strategy: "reactive" }));
        yield* a.record(makeSampleRecord({ strategy: "reactive" }));
        yield* a.record(makeSampleRecord({ strategy: "plan-execute" }));
        return yield* a.getAggregate();
      }),
    );
    expect(agg.strategyDistribution).toEqual({ reactive: 2, "plan-execute": 1 });
  });

  it("tracks model tier distribution", async () => {
    const agg = await runAgg(
      Effect.gen(function* () {
        const a = yield* TelemetryAggregatorTag;
        yield* a.record(makeSampleRecord({ modelTier: "large" }));
        yield* a.record(makeSampleRecord({ modelTier: "local" }));
        yield* a.record(makeSampleRecord({ modelTier: "large" }));
        return yield* a.getAggregate();
      }),
    );
    expect(agg.modelTierDistribution).toEqual({ large: 2, local: 1 });
  });

  it("tracks tool usage counts", async () => {
    const agg = await runAgg(
      Effect.gen(function* () {
        const a = yield* TelemetryAggregatorTag;
        yield* a.record(makeSampleRecord({ toolNames: ["file-read", "web-search"] }));
        yield* a.record(makeSampleRecord({ toolNames: ["file-read"] }));
        return yield* a.getAggregate();
      }),
    );
    expect(agg.toolUsage).toEqual({ "file-read": 2, "web-search": 1 });
  });

  it("reset clears records but keeps totalRuns", async () => {
    const [countAfterReset, recordsAfterReset] = await runAgg(
      Effect.gen(function* () {
        const a = yield* TelemetryAggregatorTag;
        yield* a.record(makeSampleRecord());
        yield* a.record(makeSampleRecord());
        yield* a.reset();
        return [yield* a.getTotalRuns(), yield* a.getRecords()] as const;
      }),
    );
    expect(countAfterReset).toBe(2); // total preserved
    expect(recordsAfterReset).toHaveLength(0); // records cleared
  });

  it("handles empty aggregate gracefully", async () => {
    const agg = await runAgg(
      Effect.gen(function* () {
        const a = yield* TelemetryAggregatorTag;
        return yield* a.getAggregate();
      }),
    );
    expect(agg.totalRuns).toBe(0);
    expect(agg.successRate).toBe(0);
    expect(agg.meanLatencyMs).toBe(0);
  });
});
