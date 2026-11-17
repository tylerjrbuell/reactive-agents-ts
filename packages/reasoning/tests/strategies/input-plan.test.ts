// File: tests/strategies/input-plan.test.ts
//
// A caller-supplied core Plan (with dependsOn) runs in blueprint, in dependency
// order, with ZERO planner calls; invalid plans fail typed before any call.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";
import type { Plan as CorePlan } from "@reactive-agents/core";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { executeBlueprint } from "../../src/strategies/blueprint.js";
import { adoptInputPlan } from "../../src/strategies/planning/input-plan.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";

const tool = (name: string) => ({
  name,
  description: `${name} tool`,
  parameters: [{ name: "query", type: "string", description: "input", required: false }],
});

const corePlan = (steps: CorePlan["steps"]): CorePlan => ({
  id: "user-plan", goal: "Find AI news then summarize it", createdAt: 1, source: "user-edited", steps,
});

const input = (plan: CorePlan) => ({
  taskDescription: "Find AI news then summarize it",
  taskType: "research",
  memoryContext: "",
  availableTools: ["web-search", "web-fetch"],
  availableToolSchemas: [tool("web-search"), tool("web-fetch")],
  config: defaultReasoningConfig,
  plan,
});

describe("input plan", () => {
  it("runs a user-edited core plan in dependency order with no planner call", async () => {
    const order: string[] = [];
    const toolLayer = mockToolServiceLayer({
      execute: (req: { toolName: string }) => Effect.sync(() => { order.push(req.toolName); return { success: true, result: `r-${req.toolName}` }; }),
      getTool: (name: string) => Effect.succeed(tool(name)),
      register: () => Effect.void,
      listTools: () => Effect.succeed([]),
      deregister: () => Effect.void,
    });
    const counts = { structured: 0 };
    const inner = TestLLMService([{ text: "Final summary." }]);
    const llm = Layer.succeed(LLMService, LLMService.of({
      ...inner,
      completeStructured: (req) => { counts.structured += 1; return inner.completeStructured(req); },
    }));
    // Listed out of order: the fetch step depends on the search step.
    const plan = corePlan([
      { id: "fetch", title: "fetch", tool: "web-fetch", dependsOn: ["search"], status: "pending" },
      { id: "search", title: "search", tool: "web-search", args: { query: "ai news" }, status: "pending" },
    ]);
    const result = await Effect.runPromise(provideTestEnvelope(
      executeBlueprint(input(plan)).pipe(Effect.provide(Layer.mergeAll(toolLayer, llm))),
    ));
    expect(result.status).toBe("completed");
    expect(order).toEqual(["web-search", "web-fetch"]);
    expect(counts.structured).toBe(0);
  });

  it("rejects invalid plans with a typed error", async () => {
    const ctx = { taskId: "t", agentId: "a", goal: "g", planMode: "dag" as const };
    const cyc = corePlan([
      { id: "a", title: "a", dependsOn: ["b"], status: "pending" },
      { id: "b", title: "b", dependsOn: ["a"], status: "pending" },
    ]);
    const unknown = corePlan([{ id: "a", title: "a", dependsOn: ["zzz"], status: "pending" }]);
    for (const bad of [cyc, unknown, corePlan([])]) {
      const exit = await Effect.runPromise(Effect.either(adoptInputPlan(bad, ctx, "blueprint")));
      expect(exit._tag).toBe("Left");
      if (exit._tag === "Left") expect(exit.left._tag).toBe("ExecutionError");
    }
  });
});
