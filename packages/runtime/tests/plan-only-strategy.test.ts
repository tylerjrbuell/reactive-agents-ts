/**
 * `agent.plan({ strategy })` plans with a strategy's own planner. Zero token.
 *
 *  - the facade names the strategy (no posture loop, no classify call) and reads
 *    the plan off `metadata.extensions.plan`;
 *  - the engine sends `{ strategy, planOnly: true }` to the reasoning boundary
 *    and does NOT judge the strategy's `partial` / empty-output result as a
 *    failed run: `metadata.planOnly` ships as a success with the plan intact.
 */
import { describe, it, expect } from "bun:test";
import { Context, Effect, Layer } from "effect";
import type { AgentId, Plan, TaskId } from "@reactive-agents/core";
import { ExecutionEngine, ExecutionEngineLive, LifecycleHookRegistryLive } from "../src/index.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";
import { planFacade } from "../src/agent/plan-facade.js";
import { PlanNoStepsError } from "../src/errors/plan-no-steps-error.js";
import { planFromExtensions, readPlanOnly, planExecContext } from "../src/agent/plan-executor.js";

const PLAN: Plan = {
  id: "plan-1",
  goal: "Ship the release",
  createdAt: 1,
  source: "model",
  steps: [
    { id: "1", title: "Build the package", status: "pending" },
    { id: "2", title: "Publish it", status: "pending" },
  ],
};

describe("agent.plan({ strategy }) facade", () => {
  const runtime = { runPromise: () => Promise.resolve(undefined) } as never;

  it("names the strategy as plan-only (no posture) and returns the strategy's plan", async () => {
    const seen: Record<string, unknown>[] = [];
    const host = {
      runtime,
      agentId: "a",
      run: (_input: unknown, options: Record<string, unknown>) => {
        seen.push(options);
        return Promise.resolve({ output: "", metadata: { extensions: { plan: PLAN } } });
      },
    };
    const plan = await planFacade(host as never, "Ship the release", { strategy: "blueprint" });
    expect(plan).toEqual(PLAN);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ planOnly: "blueprint" });
    expect(seen[0]).not.toHaveProperty("posture");
    expect(seen[0]).not.toHaveProperty("strategy");
  });

  it("rejects with PlanNoStepsError when the strategy left no plan", async () => {
    const host = { runtime, agentId: "a", run: () => Promise.resolve({ output: "no plan", metadata: { extensions: {} } }) };
    const error = await planFacade(host as never, "x", { strategy: "plan-execute-reflect" }).then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(PlanNoStepsError);
  });

  it("the plan-only strategy rides the task context and reads back", () => {
    const task = { metadata: { tags: [], context: planExecContext({ planOnly: "blueprint" }) } };
    expect(readPlanOnly(task as never)).toBe("blueprint");
    expect(readPlanOnly({ metadata: { tags: [] } } as never)).toBeUndefined();
    expect(planFromExtensions({ metadata: { extensions: { plan: PLAN } } })).toEqual(PLAN);
  });
});

type Captured = { readonly strategy?: string; readonly planOnly?: boolean };

const ReasoningServiceTag = Context.GenericTag<{
  execute: (params: Captured) => Effect.Effect<unknown>;
}>("ReasoningService");

describe("engine with a plan-only strategy run", () => {
  it("sends strategy + planOnly to reasoning and ships the empty partial as a success carrying the plan", async () => {
    const captured: Captured[] = [];
    const stub = {
      execute: (params: Captured) => {
        captured.push(params);
        return Effect.succeed({
          output: "",
          status: "partial",
          steps: [],
          metadata: {
            cost: 0,
            tokensUsed: 0,
            stepsCount: 0,
            planOnly: true,
            rawTerminatedBy: "plan-only",
            extensions: { plan: PLAN },
          },
        });
      },
    };
    const config = defaultReactiveAgentsConfig("agent-plan-only", {});
    const hooks = LifecycleHookRegistryLive;
    const layer = Layer.mergeAll(hooks, ExecutionEngineLive(config).pipe(Layer.provide(hooks)), Layer.succeed(ReasoningServiceTag, stub));
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute({
          id: "task-plan-only-001" as TaskId,
          agentId: "agent-plan-only" as AgentId,
          type: "query" as const,
          input: { question: "Ship the release" },
          priority: "medium" as const,
          status: "pending" as const,
          metadata: { tags: [], context: planExecContext({ planOnly: "plan-execute-reflect" }) },
          createdAt: new Date(),
        });
      }).pipe(Effect.provide(layer)),
    );
    expect(captured).toHaveLength(1);
    expect(Reflect.get(result.metadata, "planOnly")).toBe(true);
    expect(captured[0]).toMatchObject({ strategy: "plan-execute-reflect", planOnly: true });
    expect(result.success).toBe(true);
    expect(planFromExtensions(result as never)).toEqual(PLAN);
  });
});
