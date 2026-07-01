import { describe, it, expect } from "bun:test";
import {
  resolveThinkingEnabled,
  reserveThinkingBudget,
  THINKING_MIN,
  THINKING_MAX,
} from "./index.js";

describe("resolveThinkingEnabled — tri-state, opt-in", () => {
  it("undefined → off (opt-in, no auto-enable by inference)", () => {
    expect(resolveThinkingEnabled("gemini", "gemini-2.5-pro", undefined, true)).toBe(false);
    expect(resolveThinkingEnabled("anthropic", "claude-opus-4-8", undefined, true)).toBe(false);
  });
  it("false → off even when capable", () => {
    expect(resolveThinkingEnabled("anthropic", "claude-opus-4-8", false, true)).toBe(false);
  });
  it("true + capable → on", () => {
    expect(resolveThinkingEnabled("anthropic", "claude-opus-4-8", true, true)).toBe(true);
  });
  it("true + incapable → off (degrade, no crash)", () => {
    expect(resolveThinkingEnabled("openai", "gpt-5.5", true, false)).toBe(false);
  });
  it("requestOverride wins over config (unbuilt seam, precedence proven)", () => {
    expect(resolveThinkingEnabled("anthropic", "claude-opus-4-8", false, true, true)).toBe(true);
    expect(resolveThinkingEnabled("anthropic", "claude-opus-4-8", true, true, false)).toBe(false);
  });
});

describe("reserveThinkingBudget — bounded", () => {
  it("off/undefined enabled → undefined (caller leaves budget untouched)", () => {
    expect(reserveThinkingBudget(2000, true, { enabled: false })).toBeUndefined();
    expect(reserveThinkingBudget(2000, true, undefined)).toBeUndefined();
  });
  it("incapable → undefined", () => {
    expect(reserveThinkingBudget(2000, false, { enabled: true })).toBeUndefined();
  });
  it("enabled + capable → clamp(answer*4, MIN, MAX)", () => {
    expect(reserveThinkingBudget(2000, true, { enabled: true })).toBe(8000); // 2000*4
    expect(reserveThinkingBudget(100, true, { enabled: true })).toBe(THINKING_MIN); // floor
    expect(reserveThinkingBudget(100000, true, { enabled: true })).toBe(THINKING_MAX); // ceil
  });
  it("explicit budgetTokens overrides the scaled default (still clamped)", () => {
    expect(reserveThinkingBudget(2000, true, { enabled: true, budgetTokens: 4096 })).toBe(4096);
    expect(reserveThinkingBudget(2000, true, { enabled: true, budgetTokens: 999999 })).toBe(THINKING_MAX);
  });
});
