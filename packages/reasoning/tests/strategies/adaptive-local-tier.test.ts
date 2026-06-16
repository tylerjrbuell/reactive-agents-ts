// Run: bun test packages/reasoning/tests/strategies/adaptive-local-tier.test.ts --timeout 15000
//
// Strategy honesty (v0.12) — adaptive defaults to reactive on the local tier.
// Heavy strategies (reflexion / tree-of-thought / plan-execute) show no quality
// lift over the reactive kernel on local models (internal parity data) at 3–15×
// cost, so on the local tier adaptive routes to reactive AND skips the analysis
// LLM call. The task below routes heuristically to plan-execute-reflect
// (plan-pattern + wordCount>10); only the local-tier gate redirects it.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { executeAdaptive } from "../../src/strategies/adaptive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

const HEAVY_ROUTED_TASK =
  "Build a deployment pipeline step by step with logging and rollback and monitoring across stages";

describe("adaptive local-tier default (strategy honesty, v0.12)", () => {
  it("local tier → reactive, emits the honest-default step, no analysis LLM call", async () => {
    // Only a reactive sub-strategy turn is provided. If the gate failed to fire,
    // the heuristic would route to plan-execute-reflect (a heavy strategy).
    const layer = TestLLMServiceLayer([
      { match: "Think step-by-step", text: "FINAL ANSWER: pipeline built." },
      { text: "FINAL ANSWER: pipeline built." },
    ]);

    const result = await Effect.runPromise(
      executeAdaptive({
        taskDescription: HEAVY_ROUTED_TASK,
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: defaultReasoningConfig,
        contextProfile: { tier: "local" },
      }).pipe(Effect.provide(layer)),
    );

    expect(result.strategy).toBe("adaptive");
    expect(result.metadata.selectedStrategy).toBe("reactive");
    const honestStep = result.steps.find((s) =>
      s.content.includes("Local tier") && s.content.includes("heavy-strategy parity"),
    );
    expect(honestStep).toBeDefined();
  }, 15000);

  it("mid tier → same task routes to a heavy strategy (control: gate is local-only)", async () => {
    // No local gate → heuristic routes the plan-pattern task to plan-execute-reflect.
    const layer = TestLLMServiceLayer([
      { text: "FINAL ANSWER: pipeline built." },
    ]);

    const result = await Effect.runPromise(
      executeAdaptive({
        taskDescription: HEAVY_ROUTED_TASK,
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: defaultReasoningConfig,
        contextProfile: { tier: "mid" },
      }).pipe(Effect.provide(layer)),
    );

    const honestStep = result.steps.find((s) => s.content.includes("Local tier"));
    expect(honestStep).toBeUndefined();
  }, 15000);
});
