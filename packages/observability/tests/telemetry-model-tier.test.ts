// Run: bun test packages/observability/tests/telemetry-model-tier.test.ts --timeout 15000
//
// G-2 surgical regression test — the observability package exposes
// TelemetryModelTier (5 buckets for privacy-preserving aggregation), distinct
// from reasoning's operational ModelTier (4 buckets for runtime behavior).
// This test pins both the rename and the semantic mapping between the two.

import { describe, it, expect } from "bun:test";
import {
  TelemetryModelTier,
  toTelemetryTier,
} from "../src/telemetry/telemetry-schema.js";
import { classifyModelTier } from "../src/telemetry/privacy-preserver.js";
import { Schema } from "effect";

// Local mirror of `@reactive-agents/reasoning`'s operational ModelTier — we
// can't import it directly (observability → reasoning would be a reverse
// dependency). This literal union is the contract this test pins.
type OperationalModelTier = "local" | "mid" | "large" | "frontier";

describe("TelemetryModelTier (G-2 surgical)", () => {
  it("is a 5-bucket literal schema — never narrower", () => {
    const valid: readonly string[] = ["local", "small", "medium", "large", "frontier"];
    for (const v of valid) {
      const decoded = Schema.decodeUnknownEither(TelemetryModelTier)(v);
      expect(decoded._tag).toBe("Right");
    }
  });

  it("rejects operational-tier-only values (e.g. 'mid' is not a telemetry tier)", () => {
    const decoded = Schema.decodeUnknownEither(TelemetryModelTier)("mid");
    expect(decoded._tag).toBe("Left");
  });

  it("toTelemetryTier maps operational 'mid' to a telemetry bucket (either small or medium is acceptable)", () => {
    const mapped = toTelemetryTier("mid" as OperationalModelTier);
    expect(["small", "medium"]).toContain(mapped);
  });

  it("toTelemetryTier preserves local/large/frontier 1:1", () => {
    expect(toTelemetryTier("local" as OperationalModelTier)).toBe("local");
    expect(toTelemetryTier("large" as OperationalModelTier)).toBe("large");
    expect(toTelemetryTier("frontier" as OperationalModelTier)).toBe("frontier");
  });

  it("classifyModelTier still returns valid TelemetryModelTier values for real model names", () => {
    // The existing classifier should still produce telemetry-valid tiers.
    for (const modelName of [
      "cogito:14b",     // local
      "gpt-4o-mini",    // small
      "claude-haiku-4-5", // medium
      "claude-sonnet-4-20250514", // large
      "claude-opus-4-20250514",   // frontier
    ]) {
      const tier = classifyModelTier(modelName);
      const decoded = Schema.decodeUnknownEither(TelemetryModelTier)(tier);
      expect(decoded._tag).toBe("Right");
    }
  });
});
