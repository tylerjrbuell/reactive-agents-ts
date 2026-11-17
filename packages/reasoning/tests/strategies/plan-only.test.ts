// File: tests/strategies/plan-only.test.ts
//
// planOnly: blueprint and plan-execute-reflect (and adaptive, which routes to
// one of them) stop after the plan. Zero tokens: no tool runs, no solve /
// synthesize call, no reactive degrade or fallback; the plan returns pending in
// metadata.extensions.plan (core shape) and survives toCorePlan / fromCorePlan.
//
// RED-ON-CUT: drop the `input.planOnly` early return in blueprint.ts /
// plan-execute.ts, the `planOnly` guards in adaptive.ts, or the plan-only guard
// in reasoning-service.ts, and the matching cell fails.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, TestLLMService, TestLLMServiceLayer, type TestTurn } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import type { Plan as CorePlan } from "@reactive-agents/core";
import { createToolsLayer } from "@reactive-agents/tools";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { executeBlueprint } from "../../src/strategies/blueprint.js";
import { executePlanExecute } from "../../src/strategies/plan-execute.js";
import { executeAdaptive } from "../../src/strategies/adaptive.js";
import { ReasoningService, ReasoningServiceLive } from "../../src/services/reasoning-service.js";
import { StrategyRegistryLive } from "../../src/services/strategy-registry.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import { toCorePlan, fromCorePlan } from "../../src/types/plan-adapters.js";
import { canPlanOnly } from "../../src/strategies/planning/plan-only.js";
import type { ToolSchema } from "../../src/kernel/capabilities/attend/tool-formatting.js";

const search: ToolSchema = { name: "web-search", description: "Search", parameters: [{ name: "query", type: "string", description: "q", required: false }] };
const fetchTool: ToolSchema = { name: "web-fetch", description: "Fetch", parameters: [{ name: "query", type: "string", description: "u", required: false }] };
const goal = "Find AI news then summarize it";

const supplied: CorePlan = {
  id: "user-plan", goal, createdAt: 1, source: "user-edited",
  steps: [
    { id: "search", title: "search", tool: "web-search", args: { query: "ai news" }, status: "pending" },
    { id: "fetch", title: "fetch", tool: "web-fetch", dependsOn: ["search"], status: "pending" },
  ],
};

/** A run with every effectful door counted: tool execution and every LLM entry point. */
const harness = (turns: TestTurn[]) => {
  const counts = { tools: 0, complete: 0, stream: 0, structured: 0 };
  const toolLayer = mockToolServiceLayer({
    execute: () => Effect.sync(() => { counts.tools += 1; return { success: true, result: "r" }; }),
    getTool: (name: string) => Effect.succeed({ name, description: "t", parameters: [] }),
    register: () => Effect.void,
    listTools: () => Effect.succeed([]),
    deregister: () => Effect.void,
  });
  const inner = TestLLMService(turns);
  const llm = Layer.succeed(LLMService, LLMService.of({
    ...inner,
    complete: (req) => { counts.complete += 1; return inner.complete(req); },
    stream: (req) => { counts.stream += 1; return inner.stream(req); },
    completeStructured: (req) => { counts.structured += 1; return inner.completeStructured(req); },
  }));
  return { counts, layer: Layer.mergeAll(toolLayer, llm, EventBusLive) };
};

const base = {
  taskDescription: goal, taskType: "research", memoryContext: "",
  availableTools: ["web-search", "web-fetch"], availableToolSchemas: [search, fetchTool],
  config: defaultReasoningConfig,
};

const generated = { json: { steps: [
  { title: "Search", instruction: "search the web", type: "tool_call", toolName: "web-search", toolArgs: { query: "ai news" } },
  { title: "Fetch", instruction: "fetch the top hit", type: "tool_call", toolName: "web-fetch", toolArgs: { query: "top" }, dependsOn: ["s1"] },
] } } satisfies TestTurn;

const corePlanOf = (meta: Readonly<Record<string, unknown>>): CorePlan => {
  const ext = meta["extensions"] as { plan: CorePlan };
  return ext.plan;
};

const expectPlanOnly = (result: { status: string; output: unknown; metadata: Readonly<Record<string, unknown>> }) => {
  const meta = result.metadata;
  expect(result.status).toBe("partial");
  expect(result.output).toBeNull();
  expect(meta["planOnly"]).toBe(true);
  expect(meta["rawTerminatedBy"]).toBe("plan-only");
  // Not the plan-incomplete rule: no unrun-step cap, no per-step endings.
  expect(meta["planIncomplete"]).toBeUndefined();
  expect(meta["planSteps"]).toBeUndefined();
  expect(meta["harnessAuthoredOutput"]).toBeUndefined();
  const plan = corePlanOf(meta);
  expect(plan.steps.length).toBeGreaterThan(0);
  expect(plan.steps.every((s) => s.status === "pending")).toBe(true);
  return plan;
};

describe("planOnly: blueprint", () => {
  it("a generated plan returns pending: one planner call, no tool, no solve", async () => {
    const h = harness([generated, { text: "SHOULD NOT BE CALLED" }]);
    const result = await Effect.runPromise(provideTestEnvelope(
      executeBlueprint({ ...base, planOnly: true, taskId: "po-bp" }).pipe(Effect.provide(h.layer)),
    ));
    const plan = expectPlanOnly(result);
    expect(plan.source).toBe("model");
    expect(plan.steps.map((s) => [s.id, s.tool])).toEqual([["s1", "web-search"], ["s2", "web-fetch"]]);
    expect(plan.steps[1]!.dependsOn).toEqual(["s1"]);
    expect(h.counts).toEqual({ tools: 0, complete: 0, stream: 0, structured: 1 });
  });

  it("a supplied plan round-trips with zero LLM calls of any kind", async () => {
    const h = harness([{ text: "SHOULD NOT BE CALLED" }]);
    const result = await Effect.runPromise(provideTestEnvelope(
      executeBlueprint({ ...base, plan: supplied, planOnly: true, taskId: "po-bp-supplied" }).pipe(Effect.provide(h.layer)),
    ));
    const plan = expectPlanOnly(result);
    expect(plan.source).toBe("user-edited");
    expect(plan.steps.map((s) => ({ id: s.id, tool: s.tool, dependsOn: s.dependsOn }))).toEqual([
      { id: "search", tool: "web-search", dependsOn: undefined },
      { id: "fetch", tool: "web-fetch", dependsOn: ["search"] },
    ]);
    // The shared adapters accept it back unchanged.
    const ctx = { taskId: "t", agentId: "a", goal, planMode: "dag" as const };
    expect(toCorePlan(fromCorePlan(plan, ctx)).steps.map((s) => s.id)).toEqual(["search", "fetch"]);
    expect(h.counts).toEqual({ tools: 0, complete: 0, stream: 0, structured: 0 });
  });

  it("an invalid plan is returned with the reasons, never degraded to reactive (which would run tools)", async () => {
    const ghost: CorePlan = { ...supplied, steps: [{ id: "g", title: "ghost", tool: "no-such-tool", status: "pending" }] };
    const h = harness([{ text: "SHOULD NOT BE CALLED" }]);
    const result = await Effect.runPromise(provideTestEnvelope(
      executeBlueprint({ ...base, plan: ghost, planOnly: true, taskId: "po-bp-invalid" }).pipe(Effect.provide(h.layer)),
    ));
    expectPlanOnly(result);
    expect(String(result.metadata["verificationWarning"])).toContain("Plan invalid");
    expect(h.counts).toEqual({ tools: 0, complete: 0, stream: 0, structured: 0 });
  });
});

describe("planOnly: plan-execute-reflect", () => {
  it("a generated plan returns pending: one planner call, no tool, no synthesis", async () => {
    const h = harness([generated, { text: "SHOULD NOT BE CALLED" }]);
    const result = await Effect.runPromise(provideTestEnvelope(
      executePlanExecute({ ...base, planOnly: true, taskId: "po-pe" }).pipe(Effect.provide(h.layer)),
    ));
    const plan = expectPlanOnly(result);
    expect(plan.steps.map((s) => s.tool)).toEqual(["web-search", "web-fetch"]);
    expect(h.counts).toEqual({ tools: 0, complete: 0, stream: 0, structured: 1 });
  });

  it("a supplied plan round-trips with zero LLM calls", async () => {
    const h = harness([{ text: "SHOULD NOT BE CALLED" }]);
    const result = await Effect.runPromise(provideTestEnvelope(
      executePlanExecute({ ...base, plan: supplied, planOnly: true, taskId: "po-pe-supplied" }).pipe(Effect.provide(h.layer)),
    ));
    const plan = expectPlanOnly(result);
    expect(plan.steps.map((s) => s.id)).toEqual(["search", "fetch"]);
    expect(h.counts).toEqual({ tools: 0, complete: 0, stream: 0, structured: 0 });
  });
});

describe("planOnly: adaptive", () => {
  it("routes a task it would run on reactive to a planner, and does not fall back after the partial plan-only result", async () => {
    const h = harness([generated, { text: "SHOULD NOT BE CALLED" }]);
    const result = await Effect.runPromise(provideTestEnvelope(
      executeAdaptive({ ...base, taskDescription: "Say hello.", planOnly: true, taskId: "po-ad", contextProfile: { tier: "local" } }).pipe(Effect.provide(h.layer)),
    ));
    expectPlanOnly(result);
    expect(result.metadata["selectedStrategy"]).toBe("plan-execute-reflect");
    expect(result.metadata["fallbackOccurred"]).toBe(false);
    expect(h.counts).toEqual({ tools: 0, complete: 0, stream: 0, structured: 1 });
  });
});

describe("planOnly: ReasoningService.execute", () => {
  const run = (strategy: "blueprint" | "plan-execute-reflect" | "adaptive" | "reactive", turns: TestTurn[], extra: Record<string, unknown> = {}) =>
    Effect.runPromise(Effect.gen(function* () {
      yield* EventBus;
      const reasoning = yield* ReasoningService;
      return yield* reasoning.execute({
        taskDescription: goal, taskType: "research", memoryContext: "",
        availableTools: ["web-search", "web-fetch"], availableToolSchemas: [{ ...search }, { ...fetchTool }].map((t) => ({ ...t, parameters: [...t.parameters].map((p) => ({ name: p.name, type: p.type, description: p.description ?? "", required: p.required ?? false })) })),
        strategy, taskId: `po-svc-${strategy}`, planOnly: true, ...extra,
      });
    }).pipe(
      Effect.either,
      Effect.provide(Layer.provideMerge(
        ReasoningServiceLive(defaultReasoningConfig),
        Layer.mergeAll(TestLLMServiceLayer(turns), createToolsLayer(), StrategyRegistryLive, EventBusLive),
      )),
    ));

  it("forwards the flag through the service for blueprint and plan-execute-reflect", async () => {
    for (const strategy of ["blueprint", "plan-execute-reflect"] as const) {
      const out = await run(strategy, [generated, { text: "SHOULD NOT BE CALLED" }]);
      expect(out._tag).toBe("Right");
      if (out._tag === "Right") {
        expect(out.right.metadata["planOnly"]).toBe(true);
        expect(corePlanOf(out.right.metadata).steps.every((s) => s.status === "pending")).toBe(true);
      }
    }
  });

  it("refuses a strategy with no planner rather than running the task", async () => {
    const out = await run("reactive", [{ text: "FINAL ANSWER: ran the task" }]);
    expect(out._tag).toBe("Left");
    if (out._tag === "Left") expect(out.left._tag).toBe("ExecutionError");
    expect(canPlanOnly("reactive")).toBe(false);
    expect(canPlanOnly("rewoo")).toBe(true);
  });
});
