// Run: bun test packages/reasoning/tests/strategies/repetition-backstop-run-budget.test.ts --timeout 20000
//
// QA N1 (wiki/Research/Harness-Reports/2026-11-19-v0.19-qa-strategy-matrix.md):
// the repetition backstop was sized from ONE kernel pass's iteration cap. Direct
// runs a 3-iteration pass and a reflexion pass gets a share of the run budget,
// so `ceil(3 * 0.75) = 3` refused the 4th..6th distinct, informative calls of a
// non-parallel-safe tool (`city-population` for six cities) on 6/6 direct and
// reflexion runs, while reactive (one pass at the run's 14) ran all six.
//
// The backstop is now sized from the RUN's budget (`meta.runMaxIterations`, set
// by the strategy substrate for every pass). With an explicit run budget of 8
// the backstop is ceil(8 * 0.75) = 6, so all six distinct calls run in both
// strategies. Before the fix: direct ran 3 (pass cap 3), reflexion's generate
// pass (lead share 4 of 8) ran 3.
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import { TestLLMServiceLayer, type TestTurn } from "@reactive-agents/llm-provider";
import { createToolsLayer, ToolService } from "@reactive-agents/tools";
import { ReasoningService, ReasoningServiceLive } from "../../src/services/reasoning-service.js";
import { StrategyRegistryLive } from "../../src/services/strategy-registry.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import type { ReasoningStrategy } from "../../src/types/index.js";

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

const CITIES = ["Tokyo", "Paris", "Lagos", "Lima", "Oslo", "Cairo"] as const;
const POPS: Readonly<Record<string, number>> = { Tokyo: 13960000, Paris: 2161000, Lagos: 15388000, Lima: 10719000, Oslo: 709000, Cairo: 10230000 };
const ANSWER = `FINAL ANSWER: ${CITIES.map((c) => `${c} ${POPS[c]}`).join(", ")}`;

const config = {
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations: 8, maxIterationsExplicit: true },
    reflexion: { ...defaultReasoningConfig.strategies.reflexion, maxRetries: 1 },
  },
};

/** One turn asks for all six cities (distinct arguments), then the model answers. */
const TURNS: TestTurn[] = [
  { toolCalls: CITIES.map((city, i) => ({ id: `pop-${i}`, name: popTool.name, args: { city } })) },
  { text: ANSWER },
  { text: "SATISFIED: all six populations are reported." },
  { text: ANSWER },
];

interface Run {
  readonly executed: readonly string[];
  readonly repetitionBlocks: number;
}

const runSix = (strategy: ReasoningStrategy): Promise<Run> => {
  const executed: string[] = [];
  const program = Effect.gen(function* () {
    const blocks = yield* Ref.make(0);
    const bus = yield* EventBus;
    yield* bus.subscribe((ev) =>
      ev._tag === "GuardFiredEmitted" && /repetition/i.test(ev.guard) ? Ref.update(blocks, (n) => n + 1) : Effect.void,
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
        taskDescription: `Look up the population of each city with city-population: ${CITIES.join(", ")}. Report all six.`,
        taskType: "research",
        memoryContext: "",
        availableTools: [popTool.name],
        availableToolSchemas: [popSchema],
        strategy,
        taskId: `backstop-${strategy}`,
      })
      .pipe(Effect.catchAll(() => Effect.void));
    return yield* Ref.get(blocks);
  });
  const base = Layer.mergeAll(TestLLMServiceLayer(TURNS), createToolsLayer(), StrategyRegistryLive, EventBusLive);
  return Effect.runPromise(
    program.pipe(
      Effect.provide(Layer.provideMerge(ReasoningServiceLive(config), base)),
      Effect.map((repetitionBlocks): Run => ({ executed, repetitionBlocks })),
    ),
  );
};

describe("repetition backstop is sized from the run budget, not a pass share (QA N1)", () => {
  for (const strategy of ["direct", "reflexion"] as const) {
    it(`${strategy}: six distinct, informative calls of one sequential tool all run`, async () => {
      const run = await runSix(strategy);
      expect(run.repetitionBlocks).toBe(0);
      expect([...new Set(run.executed)].sort()).toEqual([...CITIES].sort());
    }, 20000);
  }
});
