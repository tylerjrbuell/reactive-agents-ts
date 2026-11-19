// Run: bun test packages/reasoning/tests/strategies/reflexion-pass-cap-batch.test.ts --timeout 20000
//
// Trace 01M7T84BKRW64TD0HQA6E8GHSP (gpt-4o, reflexion, maxIterations 10): the
// improve pass had 2 iterations; turn 1 ran one call, turn 2 proposed 4
// web-search calls, and the pass cap ended the loop before any act ran them
// (`pending_batch` "dropped"). The iteration cap counts think calls, so a pass
// could never run the batch of its last think, even with most of the RUN's
// budget left. The run shipped a report on research it never did.
//
// The pending-batch rule (`kernel/loop/pending-batch.ts`) now drains a batch
// left at a PASS cap while the run still has iterations
// (`meta.runIterationsLeft`, set per pass by `withRunBudget`): one act, no new
// think. At the RUN cap the batch is still dropped, and the record names the
// cause (`run-budget-exhausted`).
//
// RED-ON-CUT (shown during the mission, then restored): make
// `passCapWithRunBudget` return false: the first test fails (the 4 searches
// never execute, the guard reports "dropped").
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import { TestLLMServiceLayer, type TestTurn } from "@reactive-agents/llm-provider";
import { createToolsLayer, ToolService } from "@reactive-agents/tools";
import { ReasoningService, ReasoningServiceLive } from "../../src/services/reasoning-service.js";
import { StrategyRegistryLive } from "../../src/services/strategy-registry.js";
import { defaultReasoningConfig } from "../../src/types/config.js";

const searchTool = {
  name: "web-search",
  description: "Search the web for one query",
  parameters: [{ name: "query", type: "string" as const, description: "Search query", required: true }],
  riskLevel: "low" as const,
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function" as const,
};
const searchSchema = { name: searchTool.name, description: searchTool.description, parameters: searchTool.parameters };

/** Run budget `run`; every reflexion pass gets 2 iterations; one improve pass. */
const configFor = (run: number) => ({
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations: run, maxIterationsExplicit: true },
    reflexion: { ...defaultReasoningConfig.strategies.reflexion, maxRetries: 1, kernelMaxIterations: 2 },
  },
});

const search = (id: string, query: string) => ({ id, name: searchTool.name, args: { query } });

/**
 * Generate: one search, then a thin draft. Critique: UNSATISFIED (no market
 * trends). Improve: one search, then four searches on the pass's last think.
 */
const TURNS: TestTurn[] = [
  { toolCall: search("g1", "EV market size 2026") },
  { text: "FINAL ANSWER: The EV market is large." },
  { text: "UNSATISFIED: the report never researched market trends." },
  { toolCall: search("i1", "EV market overview") },
  {
    toolCalls: [
      search("t1", "EV market trends 2026"),
      search("t2", "EV battery cost trend"),
      search("t3", "EV adoption by region"),
      search("t4", "EV charging infrastructure growth"),
    ],
  },
  { text: "SATISFIED: the report covers the trends." },
];

type GuardEvent = { readonly guard: string; readonly outcome: string; readonly reason: string; readonly metadata?: Record<string, unknown> };

async function runReflexion(run: number) {
  const queries: string[] = [];
  const guards: GuardEvent[] = [];
  const program = Effect.gen(function* () {
    const bus = yield* EventBus;
    yield* bus.subscribe((e) =>
      Effect.sync(() => {
        if (e._tag === "GuardFiredEmitted") guards.push(e);
      }),
    );
    const tools = yield* ToolService;
    yield* tools.register(searchTool, (args) =>
      Effect.sync(() => {
        queries.push(String(args.query));
        return `Findings for "${String(args.query)}": ${String(args.query).length * 37} sources agree on a distinct figure.`;
      }),
    );
    const reasoning = yield* ReasoningService;
    return yield* reasoning.execute({
      taskDescription: "Research the EV market and write a short report covering its size and market trends.",
      taskType: "research",
      memoryContext: "",
      availableTools: [searchTool.name],
      availableToolSchemas: [searchSchema],
      strategy: "reflexion",
      taskId: "reflexion-pass-cap-batch",
    });
  });
  const base = Layer.mergeAll(TestLLMServiceLayer(TURNS), createToolsLayer(), StrategyRegistryLive, EventBusLive);
  const result = await Effect.runPromise(
    program.pipe(Effect.provide(Layer.provideMerge(ReasoningServiceLive(configFor(run)), base))),
  );
  return { result, queries, pendingGuards: guards.filter((g) => g.guard === "pending_batch") };
}

const TREND_QUERIES = [
  "EV market trends 2026",
  "EV battery cost trend",
  "EV adoption by region",
  "EV charging infrastructure growth",
];

describe("reflexion: the batch of a pass's last think runs while the run has budget (01M7T84BKRW64TD0HQA6E8GHSP)", () => {
  it("a 2-iteration improve pass with run budget left runs its last 4-call batch, no extra think", async () => {
    const { result, queries, pendingGuards } = await runReflexion(10);
    expect(queries).toEqual(["EV market size 2026", "EV market overview", ...TREND_QUERIES]);
    expect(pendingGuards.map((g) => [g.outcome, g.reason])).toEqual([["pass", "drained"]]);
    expect(pendingGuards[0]?.metadata).toEqual(
      expect.objectContaining({ calls: TREND_QUERIES.map(() => "web-search"), cause: "pass-cap" }),
    );
    // The searches' results are in the run's evidence.
    const observed = result.steps.filter(
      (s) => s.type === "observation" && s.metadata?.observationResult?.toolName === "web-search",
    );
    expect(observed.length).toBe(6);
    // Drained by one act: no think call was added for it (generate 2 + critique 1 + improve 2).
    expect(result.metadata.llmCalls).toBe(5);
  }, 20000);

  it("at the RUN cap the batch is still dropped, and the record names run-budget-exhausted", async () => {
    // Run budget 4 = generate 2 + improve 2: nothing is left when the improve pass caps.
    const { queries, pendingGuards } = await runReflexion(4);
    expect(queries).toEqual(["EV market size 2026", "EV market overview"]);
    expect(pendingGuards.map((g) => [g.outcome, g.reason])).toEqual([["warn", "dropped"]]);
    expect(pendingGuards[0]?.metadata).toEqual(expect.objectContaining({ cause: "run-budget-exhausted" }));
  }, 20000);
});
