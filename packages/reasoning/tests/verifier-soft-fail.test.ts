import { describe, it, expect } from "bun:test";
import { defaultVerifier } from "../src/kernel/capabilities/verify/verifier.js";

describe("verifier soft-fail", () => {
  const baseCtx = {
    action: "final-answer",
    content: "BTC is trading at $77,027 today.",
    actionSuccess: true,
    task: { input: "What is the BTC price?" },
    priorSteps: [
      {
        type: "observation" as const,
        content: "prices: [{symbol:'BTC',price:77027}]",
        timestamp: new Date(),
      },
    ],
    toolsUsed: new Set(["crypto-price"]),
    terminal: true,
  };

  it("sets softFail=true when only evidence-grounded fails (grounding enabled, warn mode)", () => {
    const ctx = {
      ...baseCtx,
      grounding: { mode: "warn" as const },
      priorSteps: [
        {
          type: "observation" as const,
          content: "prices: [{symbol:'BTC',price:62578}] fetched successfully",
          timestamp: new Date(),
        },
      ],
    };
    const result = defaultVerifier.verify(ctx);
    expect(result.verified).toBe(false);
    expect(result.softFail).toBe(true);
  });

  it("sets softFail=false when output-not-harness-parrot fails", () => {
    const ctx = {
      ...baseCtx,
      content: "⚠️ Recovery nudge: try again",
    };
    const result = defaultVerifier.verify(ctx);
    expect(result.verified).toBe(false);
    expect(result.softFail).toBe(false);
  });

  it("softFail=false (irrelevant) when all checks pass", () => {
    const result = defaultVerifier.verify(baseCtx);
    expect(result.verified).toBe(true);
    expect(result.softFail).toBe(false);
  });
});
