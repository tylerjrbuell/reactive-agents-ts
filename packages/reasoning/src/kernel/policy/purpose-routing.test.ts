import { describe, expect, test } from "bun:test";
import {
  mapPurposeToTier,
  resolveRoutedModel,
  type ModelRoutingPool,
} from "./purpose-routing.js";
import type { LlmPurpose } from "../llm-gateway.js";

// G2 purpose→tier mapping (meta-loop Phase 6). Audit 05-#5: gathering → cheap,
// synthesis → strong. Deterministic: same purpose → same tier.

describe("mapPurposeToTier", () => {
  test("gathering purposes route to the cheap tier", () => {
    expect(mapPurposeToTier("classify")).toBe("cheap");
    expect(mapPurposeToTier("extract")).toBe("cheap");
  });

  test("deliverable-shaping purposes route to the strong tier", () => {
    expect(mapPurposeToTier("think")).toBe("strong");
    expect(mapPurposeToTier("plan")).toBe("strong");
    expect(mapPurposeToTier("synthesize")).toBe("strong");
    expect(mapPurposeToTier("verify")).toBe("strong");
  });

  test("every LlmPurpose maps to exactly one tier", () => {
    const purposes: readonly LlmPurpose[] = [
      "think",
      "plan",
      "synthesize",
      "extract",
      "classify",
      "verify",
    ];
    for (const p of purposes) {
      expect(["cheap", "strong"]).toContain(mapPurposeToTier(p));
    }
  });
});

describe("resolveRoutedModel", () => {
  const pool: ModelRoutingPool = { cheap: "cheap-model", strong: "strong-model" };

  test("picks the cheap model for a gathering purpose", () => {
    expect(resolveRoutedModel(pool, "extract")).toBe("cheap-model");
    expect(resolveRoutedModel(pool, "classify")).toBe("cheap-model");
  });

  test("picks the strong model for a synthesis purpose", () => {
    expect(resolveRoutedModel(pool, "synthesize")).toBe("strong-model");
    expect(resolveRoutedModel(pool, "think")).toBe("strong-model");
  });
});
