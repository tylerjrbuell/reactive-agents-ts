import { describe, expect, it } from "bun:test";
import { calculateCost } from "../src/token-counter.js";

describe("Cost Tracking & Resolution", () => {
  describe("Static & Heuristic Pricing", () => {
    it("should resolve exact flagship models correctly", () => {
      // Claude 3.5 Sonnet: $3.00 in / $15.00 out per 1M
      const sonnetCost = calculateCost(1_000_000, 1_000_000, "claude-3-5-sonnet-20241022");
      expect(sonnetCost).toBe(18.0); // 3 + 15

      // GPT-4o: $2.50 in / $10.00 out per 1M
      const gpt4oCost = calculateCost(1_000_000, 1_000_000, "gpt-4o");
      expect(gpt4oCost).toBe(12.5); // 2.5 + 10
    });

    it("should apply heuristics to unknown models correctly", () => {
      // Cheap tier (Flash/Mini/Haiku): $0.15 in / $0.60 out per 1M
      const flashCost = calculateCost(1_000_000, 1_000_000, "my-custom-flash-model");
      expect(flashCost).toBe(0.75); // 0.15 + 0.6

      // Premium tier (Opus/Large): $15.00 in / $75.00 out per 1M
      const opusCost = calculateCost(1_000_000, 1_000_000, "claude-4-opus-future");
      expect(opusCost).toBe(90.0); // 15 + 75
    });
  });

  describe("Provider-Specific Caching", () => {
    it("should apply Anthropic prompt caching multipliers (10% read, 125% write)", () => {
      const model = "claude-3-5-sonnet-20241022"; // $3.00 base input
      const inputTokens = 1_000_000;
      const usage = {
        cache_read_input_tokens: 500_000,    // 500k hits
        cache_creation_input_tokens: 100_000, // 100k writes
      };
      
      // Breakdown:
      // Base: (400k / 1M) * 3.0 = 1.2
      // Hits: (500k / 1M) * 3.0 * 0.1 = 0.15
      // Writes: (100k / 1M) * 3.0 * 1.25 = 0.375
      // Total Input: 1.2 + 0.15 + 0.375 = 1.725
      
      const cost = calculateCost(inputTokens, 0, model, usage);
      expect(cost).toBeCloseTo(1.725, 5);
    });

    it("should apply OpenAI prompt caching discount (50%)", () => {
      const model = "gpt-4o"; // $2.50 base input
      const inputTokens = 1_000_000;
      const usage = {
        cached_tokens: 600_000, // 60% hit rate
      };
      
      // Breakdown:
      // Base: (400k / 1M) * 2.5 = 1.0
      // Hits: (600k / 1M) * 2.5 * 0.5 = 0.75
      // Total: 1.75
      
      const cost = calculateCost(inputTokens, 0, model, usage);
      expect(cost).toBe(1.75);
    });

    it("should apply Gemini context caching discount (25%)", () => {
      const model = "gemini-1.5-pro"; // $1.25 base input
      const inputTokens = 1_000_000;
      const usage = {
        cached_content_token_count: 800_000, // 80% hit rate
      };
      
      // Breakdown:
      // Base: (200k / 1M) * 1.25 = 0.25
      // Hits: (800k / 1M) * 1.25 * 0.25 = 0.25
      // Total: 0.50
      
      const cost = calculateCost(inputTokens, 0, model, usage);
      expect(cost).toBe(0.50);
    });
  });

  describe("Overrides (Registry & Injected)", () => {
    it("should prioritize custom registry overrides", () => {
      const model = "gpt-4o"; // Static: $2.50 / $10.00
      const registry = {
        "gpt-4o": { input: 1.0, output: 2.0 }
      };
      
      const cost = calculateCost(1_000_000, 1_000_000, model, undefined, registry);
      expect(cost).toBe(3.0);
    });

    it("should prioritize direct injected pricing (LiteLLM scenario)", () => {
      const model = "gpt-4o";
      const pricing = { input: 0.5, output: 0.5 };
      
      const cost = calculateCost(1_000_000, 1_000_000, model, undefined, undefined, pricing);
      expect(cost).toBe(1.0);
    });
  });
});
