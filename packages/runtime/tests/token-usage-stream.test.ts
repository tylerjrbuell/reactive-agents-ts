/**
 * Pins the bus -> public-stream projection of `TokenUsage`
 * (engine/token-usage-stream.ts, wired in engine/execute-stream.ts, density "full").
 */
import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { toTokenUsageStreamEvent } from "../src/engine/token-usage-stream.js";

const bus = {
  _tag: "LLMRequestCompleted",
  taskId: "t1",
  requestId: "req-1",
  model: "claude-haiku-4-5",
  provider: "anthropic",
  durationMs: 900,
  tokensUsed: 1500,
  tokensIn: 1000,
  tokensOut: 500,
  cacheReadTokensIn: 900,
  cacheCreationTokensIn: 0,
  estimatedCost: 0.01,
  iteration: 2,
};

describe("toTokenUsageStreamEvent", () => {
  test("matching taskId projects the call usage", () => {
    expect(toTokenUsageStreamEvent(bus, "t1")).toEqual({
      _tag: "TokenUsage",
      callId: "req-1",
      tokensTotal: 1500,
      tokensIn: 1000,
      tokensOut: 500,
      estimated: false,
      cacheReadTokensIn: 900,
      cacheCreationTokensIn: 0,
      model: "claude-haiku-4-5",
      provider: "anthropic",
      durationMs: 900,
      costUsd: 0.01,
      iteration: 2,
    });
  });

  test("billedTokens and reasoningTokens ride the projection when reported", () => {
    const out = toTokenUsageStreamEvent(
      { ...bus, billedTokens: 700, reasoningTokens: 120 },
      "t1",
    );
    expect(out).toMatchObject({ billedTokens: 700, reasoningTokens: 120 });
  });

  test("firstTokenMs rides the projection when numeric", () => {
    const out = toTokenUsageStreamEvent({ ...bus, firstTokenMs: 240 }, "t1");
    expect(out).toMatchObject({ firstTokenMs: 240, durationMs: 900 });
  });

  test("absent or non-numeric firstTokenMs stays absent", () => {
    expect("firstTokenMs" in (toTokenUsageStreamEvent(bus, "t1") ?? {})).toBe(false);
    const bad = toTokenUsageStreamEvent({ ...bus, firstTokenMs: "240" }, "t1");
    expect("firstTokenMs" in (bad ?? {})).toBe(false);
  });

  test("absent billed/reasoning fields stay absent, never fabricated as zero", () => {
    const out = toTokenUsageStreamEvent(bus, "t1");
    expect("billedTokens" in (out ?? {})).toBe(false);
    expect("reasoningTokens" in (out ?? {})).toBe(false);
  });

  test("missing cache creation stays absent, never fabricated as zero", () => {
    const { cacheCreationTokensIn: _omit, ...rest } = bus;
    const out = toTokenUsageStreamEvent(rest, "t1");
    expect(out).toBeDefined();
    expect("cacheCreationTokensIn" in (out ?? {})).toBe(false);
  });

  test("missing input half marks the event estimated and keeps the half absent", () => {
    const { tokensIn: _omit, ...rest } = bus;
    const out = toTokenUsageStreamEvent(rest, "t1");
    expect(out).toMatchObject({ estimated: true, tokensTotal: 1500 });
    expect("tokensIn" in (out ?? {})).toBe(false);
  });

  test("missing output half marks the event estimated", () => {
    const { tokensOut: _omit, ...rest } = bus;
    expect(toTokenUsageStreamEvent(rest, "t1")).toMatchObject({
      estimated: true,
      tokensIn: 1000,
    });
  });

  test("other taskId or malformed payload yields nothing", () => {
    expect(toTokenUsageStreamEvent(bus, "t2")).toBeUndefined();
    expect(toTokenUsageStreamEvent({ ...bus, tokensUsed: "1500" }, "t1")).toBeUndefined();
    expect(toTokenUsageStreamEvent({ ...bus, requestId: 42 }, "t1")).toBeUndefined();
    expect(toTokenUsageStreamEvent({ ...bus, requestId: "" }, "t1")).toBeUndefined();
  });

  test("execute-stream subscribes only under density full", () => {
    const src = readFileSync(new URL("../src/engine/execute-stream.ts", import.meta.url), "utf8");
    const at = src.indexOf('yield* subscribe("LLMRequestCompleted", "TokenUsage"');
    expect(at).toBeGreaterThan(-1);
    const before = src.slice(0, at);
    expect(before.lastIndexOf('if (eb && density === "full") {')).toBeGreaterThan(
      before.lastIndexOf("\n      }\n"),
    );
  });
});
