// Run: bun test packages/llm-provider/tests/params-output-budget.test.ts
//
// F1 — clampOutputBudget: capability.maxOutputTokens becomes a live signal
// at the wire-assembly point. Covers the pure helper plus the two provider
// wire points that are pure/unit-testable (openai buildTokenField, gemini
// buildGenerationConfig).

import { describe, it, expect } from "bun:test";
import { clampOutputBudget } from "../src/params/output-budget.js";
import { buildTokenField } from "../src/providers/openai.js";
import { buildGenerationConfig } from "../src/providers/gemini.js";

describe("clampOutputBudget", () => {
  const staticCap = { maxOutputTokens: 8192, source: "static-table" };

  it("clamps requested above the ceiling to the ceiling", () => {
    expect(clampOutputBudget(64_000, staticCap)).toBe(8192);
  });

  it("passes requested at or below the ceiling through unchanged", () => {
    expect(clampOutputBudget(8192, staticCap)).toBe(8192);
    expect(clampOutputBudget(4096, staticCap)).toBe(4096);
  });

  it("returns undefined when requested is undefined", () => {
    expect(clampOutputBudget(undefined, staticCap)).toBeUndefined();
  });

  it("no-ops when the capability has no maxOutputTokens", () => {
    expect(clampOutputBudget(64_000, {})).toBe(64_000);
  });

  it("no-ops for fallback-sourced capabilities (ceiling is a guess, not a limit)", () => {
    expect(
      clampOutputBudget(64_000, { maxOutputTokens: 2048, source: "fallback" }),
    ).toBe(64_000);
  });

  it("clamps for probe-sourced capabilities (ceiling is authoritative)", () => {
    expect(
      clampOutputBudget(64_000, { maxOutputTokens: 4096, source: "probe" }),
    ).toBe(4096);
  });
});

describe("buildTokenField applies the F1 clamp (openai wire point)", () => {
  it("clamps max_tokens on the legacy path", () => {
    const field = buildTokenField(
      { maxOutputTokens: 16_384, source: "static-table" },
      100_000,
      undefined,
      "medium",
    );
    expect(field).toEqual({ max_tokens: 16_384 });
  });

  it("clamps max_completion_tokens AFTER the thinking reserve is added", () => {
    const field = buildTokenField(
      {
        requiresMaxCompletionTokens: true,
        maxOutputTokens: 16_384,
        source: "static-table",
      },
      100_000,
      8192,
      "high",
    );
    expect(field).toEqual({
      max_completion_tokens: 16_384,
      reasoning_effort: "high",
    });
  });

  it("leaves under-ceiling budgets untouched", () => {
    const field = buildTokenField(
      { maxOutputTokens: 16_384, source: "static-table" },
      4096,
      undefined,
      "medium",
    );
    expect(field).toEqual({ max_tokens: 4096 });
  });

  it("never clamps against a fallback capability", () => {
    const field = buildTokenField(
      { maxOutputTokens: 8192, source: "fallback" },
      64_000,
      undefined,
      "medium",
    );
    expect(field).toEqual({ max_tokens: 64_000 });
  });
});

describe("buildGenerationConfig applies the F1 clamp (gemini wire point)", () => {
  it("clamps maxOutputTokens against the static-table ceiling (gemini-2.5-flash = 65536)", () => {
    const cfg = buildGenerationConfig(
      { model: "gemini-2.5-flash", maxTokens: 100_000, temperature: 0.7 },
      undefined,
      undefined,
    );
    expect(cfg.maxOutputTokens).toBe(65_536);
  });

  it("leaves under-ceiling budgets untouched", () => {
    const cfg = buildGenerationConfig(
      { model: "gemini-2.5-flash", maxTokens: 4096, temperature: 0.7 },
      undefined,
      undefined,
    );
    expect(cfg.maxOutputTokens).toBe(4096);
  });

  it("does not clamp unknown gemini models (fallback capability)", () => {
    const cfg = buildGenerationConfig(
      { model: "gemini-99-unreleased", maxTokens: 100_000, temperature: 0.7 },
      undefined,
      undefined,
    );
    expect(cfg.maxOutputTokens).toBe(100_000);
  });
});
