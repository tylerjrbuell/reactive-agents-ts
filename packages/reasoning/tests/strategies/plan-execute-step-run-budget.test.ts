// Run: bun test packages/reasoning/tests/strategies/plan-execute-step-run-budget.test.ts --timeout 20000
//
// ed3c9be2d sized the repetition backstop from the RUN's iteration budget
// (`meta.runMaxIterations`) and af93dc066 let a pass that stops on its own cap
// run the tool batch of its last think while the run has budget left
// (`meta.runIterationsLeft`). Both read the budget `withRunBudget` stamps on a
// pass from `StrategyRunSpec.iterationBudget`. Direct and reflexion set it;
// plan-execute did not, so its step kernels still sized the backstop from the
// step's small cap (blocking the 4th distinct call of one tool under a 3-turn
// step) and dropped the batch proposed on a step's last allowed turn.
//
// plan-execute now hands the substrate the run's budget, so every step pass
// carries it.
//
// RED-ON-CUT (shown during the mission, then restored): drop `iterationBudget`
// from plan-execute's runStrategy spec: both tests fail (the 4th and 5th calls
// hit the repetition guard; Paris and Lagos never run).
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import { TestLLMServiceLayer, type TestTurn } from "@reactive-agents/llm-provider";
import { createToolsLayer, ToolService } from "@reactive-agents/tools";
import { ReasoningService, ReasoningServiceLive } from "../../src/services/reasoning-service.js";
import { StrategyRegistryLive } from "../../src/services/strategy-registry.js";
import { defaultReasoningConfig } from "../../src/types/config.js";

const popTool = {
  name: "city-population",
  description: "Look up the population of one city",
  parameters: [{ name: "city", type: "string" as const, description: "City name", required: true }],
  riskLevel: "low" as const,
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function" as const,
};
const popSchema = { name: popTool.name, description: popTool.description, parameters: popTool.parameters };

const POPS: Readonly<Record<string, number>> = { Tokyo: 13960000, Paris: 2161000, Lagos: 15388000, Lima: 10719000, Oslo: 709000 };
const CITIES = Object.keys(POPS);
const ANSWER = `FINAL ANSWER: ${CITIES.map((c) => `${c} ${POPS[c]}`).join(", ")}`;

/** One composite step scoped to the population tool. */
const PLAN = {
  steps: [
    {
      title: "Look up populations",
      instruction: "Look up the population of each city with city-population.",
      type: "composite",
      toolHints: [popTool.name],
    },
  ],
};

/** Run budget 10; each step kernel capped at `stepCap`. */
const configFor = (stepCap: number) => ({
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations: 10, maxIterationsExplicit: true },
    planExecute: { ...defaultReasoningConfig.strategies.planExecute, stepKernelMaxIterations: stepCap, stepRetries: 0 },
  },
});

const pop = (id: string, city: string) => ({ id, name: popTool.name, args: { city } });

type GuardEvent = { readonly guard: string; readonly outcome: string; readonly reason: string };

async function runPlan(stepCap: number, stepTurns: readonly TestTurn[]) {
  const executed: string[] = [];
  const guards: GuardEvent[] = [];
  const turns: TestTurn[] = [
    { match: "planning agent", json: PLAN },
    ...stepTurns,
    { match: "GOAL:", text: "SATISFIED: complete." },
    { text: ANSWER },
  ];
  const program = Effect.gen(function* () {
    const bus = yield* EventBus;
    yield* bus.subscribe((e) =>
      Effect.sync(() => {
        if (e._tag === "GuardFiredEmitted") guards.push(e);
      }),
    );
    const tools = yield* ToolService;
    yield* tools.register(popTool, (args) =>
      Effect.sync(() => {
        const city = String(args.city);
        executed.push(city);
        return { city, population: POPS[city] ?? 0 };
      }),
    );
    const reasoning = yield* ReasoningService;
    yield* reasoning
      .execute({
        taskDescription: `Look up the population of each city with city-population: ${CITIES.join(", ")}. Report all five.`,
        taskType: "research",
        memoryContext: "",
        availableTools: [popTool.name],
        availableToolSchemas: [popSchema],
        strategy: "plan-execute-reflect",
        taskId: `plan-step-run-budget-${stepCap}`,
      })
      .pipe(Effect.catchAll(() => Effect.void));
  });
  const base = Layer.mergeAll(TestLLMServiceLayer(turns), createToolsLayer(), StrategyRegistryLive, EventBusLive);
  await Effect.runPromise(program.pipe(Effect.provide(Layer.provideMerge(ReasoningServiceLive(configFor(stepCap)), base))));
  return { executed, guards };
}

describe("plan-execute step kernels carry the run's iteration budget", () => {
  it("a 3-turn step runs five distinct calls of one sequential tool (backstop sized from the run)", async () => {
    const { executed, guards } = await runPlan(3, [
      { match: "Look up the population", toolCalls: CITIES.map((city, i) => pop(`p${i}`, city)) },
      { match: "Look up the population", text: ANSWER },
    ]);
    expect(guards.filter((g) => /repetition/i.test(g.guard))).toEqual([]);
    expect([...new Set(executed)].sort()).toEqual([...CITIES].sort());
  }, 20000);

  it("a 2-turn step whose last turn proposes calls runs them while the run has budget", async () => {
    const { executed, guards } = await runPlan(2, [
      { match: "Look up the population", toolCall: pop("p0", "Tokyo") },
      { match: "Look up the population", toolCalls: [pop("p1", "Paris"), pop("p2", "Lagos")] },
      { match: "Look up the population", text: ANSWER },
    ]);
    expect(executed).toEqual(expect.arrayContaining(["Tokyo", "Paris", "Lagos"]));
    expect(guards.filter((g) => g.guard === "pending_batch").map((g) => [g.outcome, g.reason])).toEqual([["pass", "drained"]]);
  }, 20000);
});
