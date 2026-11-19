// Run: bun test packages/reasoning/tests/strategies/environment-update-once-per-run.test.ts --timeout 20000
//
// `rails.environmentUpdate` reaches the model at most ONCE per run (audit G10).
// The envelope merges the notice into every kernel pass's input, and each pass
// starts with an empty signal ledger, so a multi-pass strategy (reflexion's
// improve pass, plan-execute's composite steps) re-showed the same stale
// "what changed since your last turn" notice once per pass. Consumption is now
// run-scoped (the `reasoning.environmentUpdateShown` run slot).
//
// Every cell goes through ReasoningService.execute (the user path) with the
// notice on the envelope, and counts the provider requests whose messages carry
// the notice text.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBusLive } from "@reactive-agents/core";
import { LLMService, TestLLMService, type TestTurn } from "@reactive-agents/llm-provider";
import { createToolsLayer } from "@reactive-agents/tools";
import { ReasoningService, ReasoningServiceLive } from "../../src/services/reasoning-service.js";
import { StrategyRegistryLive } from "../../src/services/strategy-registry.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { buildRunEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import type { ReasoningStrategy } from "../../src/types/index.js";

const MARKER = "todo list was edited by the user";
const NOTICE = `Environment update since your last turn:\n- The ${MARKER}.`;

const config = {
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reflexion: { ...defaultReasoningConfig.strategies.reflexion, maxRetries: 1 },
  },
};

/** Run one strategy with the notice on the envelope; return how many requests carried it and how many kernel-style requests ran. */
const runWithNotice = (strategy: ReasoningStrategy, turns: TestTurn[]): Promise<{ withNotice: number; requests: number; error?: string }> => {
  const seen: string[] = [];
  const inner = TestLLMService(turns);
  const recording: typeof LLMService.Service = {
    ...inner,
    complete: (req) => {
      seen.push(JSON.stringify(req.messages));
      return inner.complete(req);
    },
    stream: (req) => {
      seen.push(JSON.stringify(req.messages));
      return inner.stream(req);
    },
  };
  const program = Effect.gen(function* () {
    const reasoning = yield* ReasoningService;
    return yield* reasoning
      .execute({
        taskDescription: "Report the sum of 2 and 3.",
        taskType: "computation",
        memoryContext: "",
        availableTools: [],
        strategy,
        taskId: `env-once-${strategy}`,
        envelope: buildRunEnvelope({ environmentUpdate: NOTICE }),
      })
      .pipe(
        Effect.map(() => undefined),
        Effect.catchAll((e) => Effect.succeed(`${e._tag}: ${String((e as { message?: unknown }).message)}`)),
      );
  });
  const base = Layer.mergeAll(Layer.succeed(LLMService, LLMService.of(recording)), createToolsLayer(), StrategyRegistryLive, EventBusLive);
  return Effect.runPromise(program.pipe(Effect.provide(Layer.provideMerge(ReasoningServiceLive(config), base)))).then(
    (error) => ({
      withNotice: seen.filter((m) => m.includes(MARKER)).length,
      requests: seen.length,
      ...(error !== undefined ? { error } : {}),
    }),
  );
};

/** reflexion: generate pass, an unsatisfied critique, an improve pass, a satisfied critique. */
const REFLEXION_TURNS: TestTurn[] = [
  { text: "FINAL ANSWER: 4" },
  { text: "UNSATISFIED: 2 + 3 is 5, not 4. Fix the sum." },
  { text: "FINAL ANSWER: 5" },
  { text: "SATISFIED: the sum is right." },
  { text: "FINAL ANSWER: 5" },
];

/** plan-execute: two composite steps, each its own kernel pass. */
const TWO_PASS_PLAN = {
  steps: [
    { title: "First", instruction: "Compute 2 + 3", type: "composite" },
    { title: "Second", instruction: "State the result", type: "composite", dependsOn: ["s1"] },
  ],
};
const PLAN_TURNS: TestTurn[] = [
  { json: TWO_PASS_PLAN },
  { text: "FINAL ANSWER: 5" },
  { text: "FINAL ANSWER: the sum is 5" },
  { text: "FINAL ANSWER: 5" },
];

const CELLS: readonly { readonly name: string; readonly strategy: ReasoningStrategy; readonly turns: TestTurn[] }[] = [
  { name: "reflexion (generate + improve passes)", strategy: "reflexion", turns: REFLEXION_TURNS },
  { name: "plan-execute (two composite kernel passes)", strategy: "plan-execute-reflect", turns: PLAN_TURNS },
];

describe("rails.environmentUpdate is shown once per run", () => {
  for (const c of CELLS) {
    it(`${c.name}: exactly one model request carries the notice`, async () => {
      const r = await runWithNotice(c.strategy, c.turns);
      expect(r.error).toBeUndefined();
      // The run really made several model calls (the notice had chances to repeat).
      expect(r.requests).toBeGreaterThanOrEqual(3);
      expect(r.withNotice).toBe(1);
    }, 30_000);
  }
});
