import { describe, it, expect } from "bun:test";
import { Effect, Option } from "effect";
import {
  scoreReflectionAndDispatch,
  type ReflectionEntropyDeps,
  type RiBudget,
} from "../src/strategies/plan-execute/reflection-entropy.js";
import type { Plan } from "../src/types/plan.js";
import type { StrategyServices } from "../src/kernel/utils/service-utils.js";

const plan = { steps: [] } as unknown as Plan;
const trajectory = { shape: "flat", derivative: 0, momentum: 0 };

const depsWith = (services: Partial<Record<keyof StrategyServices, unknown>>, riBudget: RiBudget): ReflectionEntropyDeps => ({
  services: {
    entropySensor: Option.none(),
    reactiveController: Option.none(),
    dispatcher: Option.none(),
    eventBus: Option.none(),
    ...services,
  } as unknown as StrategyServices,
  input: { taskId: "t", taskDescription: "d", modelId: "m", temperature: 0, availableTools: [], harnessPipeline: undefined },
  steps: [],
  plan,
  refinement: 1,
  maxRefinements: 3,
  totalTokens: 10,
  reflectionContent: "reflection",
  entropyHistory: [],
  riBudget,
});

describe("scoreReflectionAndDispatch", () => {
  it("is a no-op without an entropy sensor", async () => {
    const budget: RiBudget = { interventionsFiredThisRun: 0, tokensSpentOnInterventions: 0 };
    const r = await Effect.runPromise(scoreReflectionAndDispatch(depsWith({}, budget)));
    expect(r.earlyStop).toBe(false);
    expect(r.entropyHistory).toEqual([]);
  });

  it("appends the score to history and fires early-stop through the dispatcher, accumulating budget", async () => {
    const budget: RiBudget = { interventionsFiredThisRun: 0, tokensSpentOnInterventions: 0 };
    const published: string[] = [];
    const services = {
      entropySensor: Option.some({ score: () => Effect.succeed({ composite: 0.9, trajectory, sources: {} }) }),
      reactiveController: Option.some({ evaluate: () => Effect.succeed([{ decision: "early-stop", reason: "r" }]) }),
      dispatcher: Option.some({
        dispatch: () =>
          Effect.succeed({
            appliedPatches: [{ decisionType: "early-stop", patch: { kind: "early-stop" } }],
            skipped: [{ decisionType: "compress", reason: "over-budget" }],
            totalCost: { tokens: 5, latencyMs: 1 },
          }),
      }),
      eventBus: Option.some({ publish: (e: { _tag: string }) => Effect.sync(() => void published.push(e._tag)) }),
    };
    const r = await Effect.runPromise(scoreReflectionAndDispatch(depsWith(services, budget)));
    expect(r.earlyStop).toBe(true);
    expect(r.entropyHistory).toHaveLength(1);
    expect(budget).toEqual({ interventionsFiredThisRun: 1, tokensSpentOnInterventions: 5 });
    expect(published).toEqual(["EntropyScored", "InterventionDispatched", "InterventionSuppressed"]);
  });

  it("degrades to a no-op when the sensor fails", async () => {
    const budget: RiBudget = { interventionsFiredThisRun: 0, tokensSpentOnInterventions: 0 };
    const services = { entropySensor: Option.some({ score: () => Effect.fail("boom") }) };
    const r = await Effect.runPromise(scoreReflectionAndDispatch(depsWith(services, budget)));
    expect(r.earlyStop).toBe(false);
    expect(r.entropyHistory).toEqual([]);
  });
});
