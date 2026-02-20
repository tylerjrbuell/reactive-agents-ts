import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { estimateTokenCount, calculateCost } from "../src/index.js";

describe("Token Counter", () => {
  it("should estimate tokens from messages", async () => {
    const result = await Effect.runPromise(
      estimateTokenCount([
        { role: "user", content: "Hello world" },
        { role: "assistant", content: "Hi there, how can I help?" },
      ]),
    );

    expect(result).toBeGreaterThan(0);
    // ~11 + 25 chars + 32 overhead = ~68 chars / 4 = ~17 tokens
    expect(result).toBeGreaterThanOrEqual(10);
    expect(result).toBeLessThan(100);
  });

  it("should count tokens for content blocks", async () => {
    const result = await Effect.runPromise(
      estimateTokenCount([
        {
          role: "user",
          content: [
            { type: "text" as const, text: "Describe this image" },
            {
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: "image/png" as const,
                data: "abc123",
              },
            },
          ],
        },
      ]),
    );

    expect(result).toBeGreaterThan(0);
  });

  it("should calculate cost for known models", () => {
    const cost = calculateCost(1_000_000, 500_000, "claude-sonnet-4-20250514");
    // 1M input * $3/1M + 500K output * $15/1M = $3 + $7.5 = $10.5
    expect(cost).toBeCloseTo(10.5, 1);
  });

  it("should calculate cost for gpt-4o-mini", () => {
    const cost = calculateCost(1_000_000, 1_000_000, "gpt-4o-mini");
    // 1M * $0.15/1M + 1M * $0.6/1M = $0.15 + $0.6 = $0.75
    expect(cost).toBeCloseTo(0.75, 2);
  });

  it("should use default cost for unknown models", () => {
    const cost = calculateCost(1_000, 1_000, "unknown-model");
    // Uses default: $3/1M input + $15/1M output
    expect(cost).toBeGreaterThan(0);
  });
});
