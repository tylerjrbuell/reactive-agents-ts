import { describe, expect, it } from "bun:test";
import type { AgentStreamEvent } from "@reactive-agents/runtime";
import { knownWindowTokens, makeContextFallback } from "../services/chat-context-fallback.js";

const usage = (provider: string, model: string, tokensIn?: number): AgentStreamEvent => ({
  _tag: "TokenUsage",
  callId: "c1",
  tokensTotal: (tokensIn ?? 0) + 10,
  ...(tokensIn !== undefined ? { tokensIn } : {}),
  tokensOut: 10,
  estimated: false,
  model,
  provider,
  durationMs: 100,
  costUsd: 0.001,
});

describe("chat context fallback (hosted providers send no ContextPressure)", () => {
  it("derives a reading from the reported prompt tokens for a model with a capability row", () => {
    const fb = makeContextFallback();
    const out = fb.observe(usage("openai", "gpt-4o-mini", 12_800));
    expect(out).toMatchObject({ _tag: "ContextPressure", tokensUsed: 12_800, tokensAvailable: 115_200, utilizationPct: 10, level: "low" });
  });

  it("gives no reading for a model whose capability is only the conservative fallback", () => {
    expect(knownWindowTokens("openai", "no-such-model-xyz")).toBeUndefined();
    expect(makeContextFallback().observe(usage("openai", "no-such-model-xyz", 5_000))).toBeUndefined();
  });

  it("never invents a reading without reported prompt tokens", () => {
    expect(makeContextFallback().observe(usage("openai", "gpt-4o-mini"))).toBeUndefined();
  });

  it("stands down once the stream carries its own ContextPressure", () => {
    const fb = makeContextFallback();
    fb.observe({ _tag: "ContextPressure", tokensUsed: 1, tokensAvailable: 9, utilizationPct: 10, level: "low" });
    expect(fb.observe(usage("openai", "gpt-4o-mini", 1_000))).toBeUndefined();
  });

  it("covers the other hosted families the framework has rows for", () => {
    expect(knownWindowTokens("anthropic", "claude-haiku-4-5")).toBe(200_000);
    expect(knownWindowTokens("gemini", "gemini-2.5-flash")).toBe(1_000_000);
    expect(knownWindowTokens("openai", "gpt-5.4-mini")).toBe(400_000);
  });
});
