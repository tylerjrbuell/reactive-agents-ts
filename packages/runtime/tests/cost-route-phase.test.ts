// Run: bun test packages/runtime/tests/cost-route-phase.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { costRoute } from "../src/engine/phases/cost-route.js";

const baseCtx = { selectedModel: undefined } as any;
const deps = (over: any) => ({
  config: { provider: "anthropic", defaultModel: "claude-sonnet-4-6", ...over },
  task: { input: "What is 2 + 2?" },
} as any);

describe("cost-route phase", () => {
  it("skips (passes through) when modelRouting is off", () => {
    expect(costRoute.skip!(baseCtx, deps({}))).toBe(true);
  });

  it("routes a simple task to a cheaper anthropic model when modelRouting on", async () => {
    const d = deps({ modelRouting: {} });
    expect(costRoute.skip!(baseCtx, d)).toBe(false);
    const out: any = await Effect.runPromise(costRoute.run(baseCtx, d) as any);
    expect(typeof out.selectedModel).toBe("string");
    // a trivial task routes to the cheap tier, not the configured sonnet
    expect(out.selectedModel).toContain("haiku");
  });

  it("is provider-agnostic — routes within openai tiers, not anthropic", async () => {
    const d = deps({ provider: "openai", defaultModel: "gpt-4o", modelRouting: {} });
    const out: any = await Effect.runPromise(costRoute.run(baseCtx, d) as any);
    expect(out.selectedModel).toContain("gpt");
  });
});
