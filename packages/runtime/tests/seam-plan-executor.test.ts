// Run: bun test packages/runtime/tests/seam-plan-executor.test.ts --timeout 30000
//
// Planning unification phase 3 — one Plan artifact, pluggable executors
// (wiki/Architecture/Design-Specs/2026-11-16-planning-unification.md).
//
// Pins (zero-token: scripted test provider, real runtime):
//  - pure: executor choice by plan richness + strategy setting, boundary
//    validation, the extensions.plan merge, the carrier round trip;
//  - agent.execute(plan) with deps runs in blueprint and returns per-step statuses;
//  - a free-step plan keeps today's loop path (seeded checklist, no strategy swap);
//  - an invalid plan is a typed PlanInvalidError before any run starts;
//  - a non-durable loop-stopped run surfaces loopStop from extensions.loopStop.
//
// RED-ON-CUT:
//  - drop the executorStrategy override in engine/phases/strategy-select.ts -> the blueprint cell goes red (loop runs).
//  - drop `plan:` in engine/phases/agent-loop/reasoning-think.ts -> the blueprint cell goes red (the strategy replans).
//  - drop the invalidPlan call in agent/plan-facade.ts -> the invalid-plan cells go red.
//  - drop `?? loopStopOfResult(result)` in engine/loop-stop-resume.ts -> the extensions cell goes red.
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import type { Plan } from "@reactive-agents/core";
import { ReactiveAgents } from "../src/builder.js";
import { PlanInvalidError } from "../src/errors/plan-invalid-error.js";
import {
  adoptedPlan,
  executorStrategy,
  invalidPlan,
  isRichPlan,
  mergeFinalPlan,
  planExecContext,
  planFromExtensions,
  readPlanExec,
} from "../src/agent/plan-executor.js";
import { surfaceLoopStop } from "../src/engine/loop-stop-resume.js";
import type { AgentResult } from "../src/builder/agent-result.js";

const plan = (steps: Plan["steps"], source: Plan["source"] = "user-edited"): Plan => ({ id: "p1", goal: "Look up two things and summarise", steps, createdAt: 1_700_000_000_000, source });

const free = plan([
  { id: "1", title: "Gather the first fact", status: "pending" },
  { id: "2", title: "Summarise", status: "pending", tool: "gather" },
]);
const rich = plan([
  { id: "s1", title: "Gather alpha", status: "pending", tool: "gather", args: { q: "alpha" } },
  { id: "s2", title: "Gather beta", status: "pending", tool: "gather", args: { q: "beta" }, dependsOn: ["s1"] },
]);

describe("plan-executor (pure)", () => {
  test("richness: dependsOn or args make a plan rich; a tool hint alone does not", () => {
    expect(isRichPlan(free)).toBe(false);
    expect(isRichPlan(rich)).toBe(true);
    expect(isRichPlan(plan([{ id: "1", title: "t", status: "pending", dependsOn: [] }]))).toBe(false);
    expect(isRichPlan(plan([{ id: "1", title: "t", status: "pending", args: {} }]))).toBe(true);
  });

  test("executorStrategy: explicit wins, then an adopting setting, then richness, else the loop", () => {
    expect(executorStrategy(undefined, "reactive")).toBeUndefined();
    expect(executorStrategy({ plan: free }, "reactive")).toBeUndefined();
    expect(executorStrategy({ plan: free }, "adaptive")).toBeUndefined();
    expect(executorStrategy({ plan: free }, "blueprint")).toBe("blueprint");
    expect(executorStrategy({ plan: free }, "plan-execute-reflect")).toBe("plan-execute-reflect");
    expect(executorStrategy({ plan: free, strategy: "plan-execute-reflect" }, "reactive")).toBe("plan-execute-reflect");
    expect(executorStrategy({ plan: rich }, "reactive")).toBe("blueprint");
    expect(executorStrategy({ plan: rich }, "plan-execute-reflect")).toBe("plan-execute-reflect");
    expect(executorStrategy({ plan: rich, strategy: "blueprint" }, "plan-execute-reflect")).toBe("blueprint");
  });

  test("adoptedPlan forwards the plan only to a strategy that adopts it", () => {
    expect(adoptedPlan({ plan: rich }, "blueprint")).toBe(rich);
    expect(adoptedPlan({ plan: free }, "reactive")).toBeUndefined();
    expect(adoptedPlan({ plan: rich }, "reactive")).toBeUndefined();
    expect(adoptedPlan(undefined, "blueprint")).toBeUndefined();
  });

  test("invalidPlan: friendly typed error for a bad decode and each dependency problem; ok for a sound or empty plan", () => {
    expect(invalidPlan(rich)).toBeUndefined();
    expect(invalidPlan(plan([]))).toBeUndefined();
    expect(invalidPlan({ goal: "no id" })).toBeInstanceOf(PlanInvalidError);
    expect(invalidPlan(plan([{ id: "a", title: "a", status: "pending", dependsOn: ["zzz"] }]))?.reason).toContain("unknown step");
    expect(invalidPlan(plan([{ id: "a", title: "a", status: "pending", dependsOn: ["a"] }]))?.reason).toContain("itself");
    const cycle = plan([
      { id: "a", title: "a", status: "pending", dependsOn: ["b"] },
      { id: "b", title: "b", status: "pending", dependsOn: ["a"] },
    ]);
    expect(invalidPlan(cycle)?.reason).toContain("cycle");
    expect(invalidPlan(cycle)?.message).toStartWith("The plan cannot run:");
  });

  test("carrier round trip: planExecContext -> readPlanExec keeps plan and explicit strategy; empty or absent carries nothing", () => {
    const ctx = planExecContext({ planExec: { plan: rich, strategy: "plan-execute-reflect" } });
    expect(readPlanExec({ metadata: { tags: [], context: ctx } } as never)).toEqual({ plan: rich, strategy: "plan-execute-reflect" });
    expect(planExecContext({ planExec: { plan: plan([]) } })).toEqual({});
    expect(planExecContext(undefined)).toEqual({});
    expect(readPlanExec({ metadata: { tags: [] } } as never)).toBeUndefined();
    expect(readPlanExec({ metadata: { context: { planExec: { plan: { nope: 1 } } } } } as never)).toBeUndefined();
  });

  test("mergeFinalPlan: the strategy's plan wins; the watch fills only steps it left pending; identity, source and findings come from the supplied plan; user-skipped stays skipped", () => {
    const supplied = { ...plan([
      { id: "s1", title: "one", status: "pending" },
      { id: "s2", title: "two", status: "skipped" },
      { id: "s3", title: "three", status: "pending" },
    ]), findings: [{ id: "f1", tool: "gather", summary: "fact" }] };
    const final: Plan = { id: "other", goal: "other", createdAt: 0, source: "model", steps: [
      { id: "s1", title: "one", status: "done" },
      { id: "s2", title: "two", status: "done" },
      { id: "s3", title: "three", status: "pending" },
    ] };
    const watched: Plan = { ...supplied, steps: [
      { id: "s1", title: "one", status: "pending" },
      { id: "s2", title: "two", status: "done" },
      { id: "s3", title: "three", status: "in-progress" },
    ] };
    const merged = mergeFinalPlan(final, watched, supplied);
    expect(merged.steps.map((s) => s.status)).toEqual(["done", "skipped", "in-progress"]);
    expect([merged.id, merged.goal, merged.createdAt, merged.source]).toEqual([supplied.id, supplied.goal, supplied.createdAt, "user-edited"]);
    expect(merged.findings).toEqual(supplied.findings);
  });

  test("planFromExtensions reads a well-formed extensions.plan only", () => {
    expect(planFromExtensions({ metadata: { extensions: { plan: rich } } })).toEqual(rich);
    expect(planFromExtensions({ metadata: { extensions: { plan: { bad: true } } } })).toBeUndefined();
    expect(planFromExtensions({ metadata: {} })).toBeUndefined();
  });
});

const gather = (calls: string[]) => ({
  definition: {
    name: "gather",
    description: "gather a fact",
    parameters: [{ name: "q", type: "string" as const, description: "query", required: true }],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  },
  handler: (args: Record<string, unknown>) => Effect.sync(() => { calls.push(String(args.q)); return `fact about ${String(args.q)}`; }),
});

const build = (calls: string[], scenario: unknown[], strategy: "reactive" | "blueprint" = "reactive") =>
  ReactiveAgents.create()
    .withName("plan-executor")
    .withProvider("test")
    .withModel("test-model")
    .withTestScenario(scenario as never)
    .withTools({ tools: [gather(calls)], adaptive: false } as never)
    .withReasoning({ defaultStrategy: strategy, enableStrategySwitching: false })
    .withMaxIterations(8)
    .build();

describe("agent.execute(plan) picks the executor by plan richness", () => {
  test("a user-edited plan with deps runs in blueprint: the DAG worker calls the tools with the plan's args, per-step statuses come back", async () => {
    const calls: string[] = [];
    const agent = await build(calls, [{ text: "Alpha and beta are summarised." }]);
    const result = await agent.execute(rich);
    await agent.dispose();
    expect(result.metadata.strategyUsed).toBe("blueprint");
    expect(calls.slice().sort()).toEqual(["alpha", "beta"]);
    expect(result.plan.id).toBe("p1");
    expect(result.plan.source).toBe("user-edited");
    expect(result.plan.steps.map((s) => [s.id, s.status])).toEqual([["s1", "done"], ["s2", "done"]]);
    expect(result.plan.steps[1]?.dependsOn).toEqual(["s1"]);
    expect(result.plan.steps[1]?.args).toEqual({ q: "beta" });
  });

  test("run(input, { plan }) takes the same path", async () => {
    const calls: string[] = [];
    const agent = await build(calls, [{ text: "Done." }]);
    const result = await agent.run("Summarise alpha and beta", { plan: rich });
    await agent.dispose();
    expect(result.metadata.strategyUsed).toBe("blueprint");
    expect((result as AgentResult & { plan: Plan }).plan.steps.map((s) => s.status)).toEqual(["done", "done"]);
  });

  test("a free-step plan keeps today's loop path: reactive runs, the checklist is seeded, no strategy swap", async () => {
    const calls: string[] = [];
    const agent = await build(calls, [{ text: "FINAL ANSWER: nothing to do." }]);
    const result = await agent.execute(free);
    await agent.dispose();
    expect(result.metadata.strategyUsed).not.toBe("blueprint");
    expect(result.metadata.extensions?.["plan"]).toBeUndefined();
    expect(result.plan.steps.map((s) => s.id)).toEqual(["1", "2"]);
    expect(result.plan.steps[1]?.tool).toBe("gather");
  });

  test("an agent whose strategy setting is blueprint adopts even a free plan (no replanning)", async () => {
    const calls: string[] = [];
    const agent = await build(calls, [{ text: "Done." }], "blueprint");
    const result = await agent.execute(plan([
      { id: "1", title: "Gather gamma", status: "pending", tool: "gather", args: { q: "gamma" } },
    ]));
    await agent.dispose();
    expect(result.metadata.strategyUsed).toBe("blueprint");
    expect(calls).toEqual(["gamma"]);
    expect(result.plan.steps.map((s) => s.status)).toEqual(["done"]);
  });
});

describe("boundary validation", () => {
  const bad = plan([{ id: "a", title: "a", status: "pending", dependsOn: ["ghost"] }]);

  test("execute() rejects PlanInvalidError before any run starts", async () => {
    const calls: string[] = [];
    const agent = await build(calls, [{ text: "never" }]);
    await expect(agent.execute(bad)).rejects.toBeInstanceOf(PlanInvalidError);
    await expect(agent.execute(bad)).rejects.toThrow("unknown step");
    await agent.dispose();
    expect(calls).toEqual([]);
  });

  test("run(input, { plan }) rejects the same way; a malformed object too", async () => {
    const calls: string[] = [];
    const agent = await build(calls, [{ text: "never" }]);
    await expect(agent.run("go", { plan: bad })).rejects.toBeInstanceOf(PlanInvalidError);
    await expect(agent.execute({ goal: "g", steps: [{ title: "no id" }] } as never)).rejects.toBeInstanceOf(PlanInvalidError);
    await agent.dispose();
  });
});

describe("loop-stop from the strategy's extensions (no checkpoint rail)", () => {
  const record = { reason: "loop_graceful", repeatedTool: "gather", iteration: 4, toolsDone: [{ tool: "gather", calls: 3 }], unfinished: ["Summarise"] };
  const base: AgentResult = { metadata: { extensions: { loopStop: record } } } as never;

  test("surfaceLoopStop reads extensions.loopStop when no record came from a checkpoint; no resumable flag without a durable run", async () => {
    const out = await Effect.runPromise(surfaceLoopStop(base, { record: undefined }));
    expect(out.loopStop).toEqual({ reason: "loop_graceful", repeatedTool: "gather", toolsDone: [{ tool: "gather", calls: 3 }], unfinished: ["Summarise"], iteration: 4 });
    expect(out.resumable).toBeUndefined();
  });

  test("a malformed extensions.loopStop is ignored; a checkpoint record still wins", async () => {
    const junk: AgentResult = { metadata: { extensions: { loopStop: { reason: 5 } } } } as never;
    expect((await Effect.runPromise(surfaceLoopStop(junk, { record: undefined }))).loopStop).toBeUndefined();
    const out = await Effect.runPromise(surfaceLoopStop(base, { record: { ...record, reason: "dispatcher-early-stop" } }));
    expect(out.loopStop?.reason).toBe("dispatcher-early-stop");
  });
});
