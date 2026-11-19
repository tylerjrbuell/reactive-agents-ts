// Run: bun run repo test packages/reasoning/tests/strategies/iteration-cap-registry.test.ts
//
// One iteration-cap law for every strategy: the user's configured
// `maxIterations` wins over any tier/strategy default
// (strategies/budget/iteration-cap.ts). Registry-driven: a strategy added to
// `StrategyRegistryLive` fails here until it has a driver below (and so honors
// the cap) or an explicit, reasoned exemption.
//
// RED-ON-CUT: restore `TOT_TIER_LIMITS[tier].maxPhase2Iterations` directly as
// the tree-of-thought pass cap -> the tree-of-thought case runs ~7 turns, not 3.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, TestLLMService, type TestTurn } from "@reactive-agents/llm-provider";
import { StrategyRegistry, StrategyRegistryLive } from "../../src/services/strategy-registry.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { succeedingToolLayer } from "../../src/testing/tool-service-mock.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";

const GATHER = {
  name: "gather",
  description: "gather",
  parameters: [{ name: "q", type: "string", description: "q", required: true }],
};
/** A model that never answers: a distinct tool call every turn (no loop-detector stop). */
const loopTurns = (): TestTurn[] =>
  Array.from({ length: 40 }, (_, i) => ({ toolCall: { name: "gather", args: { q: `item-${i}` } } }));

const ONE_STEP_PLAN = JSON.stringify({
  steps: [{ title: "Gather", instruction: "Gather facts with the gather tool, one per item.", type: "composite", toolHints: ["gather"] }],
});

const SCRIPTS: Record<string, readonly TestTurn[]> = {
  "tree-of-thought": [
    { match: "Generate exactly", text: "1. approach a\n2. approach b" },
    { match: "Rate each", text: "0.8" },
    ...loopTurns(),
  ],
  "plan-execute-reflect": [{ text: ONE_STEP_PLAN }, ...loopTurns()],
};

/** Strategies with a kernel/iteration loop: measured against a user cap. */
const DRIVEN = [
  "reactive",
  "react",
  "reflexion",
  "plan-execute-reflect",
  "tree-of-thought",
  "adaptive",
  "direct",
  "code-action",
] as const;

/** Registered strategies with NO iteration loop, so no cap to honor. */
const EXEMPT: Record<string, string> = {
  blueprint: "fixed plan -> verify -> 0-LLM execute -> solve; no kernel pass loop",
  rewoo: "alias of blueprint",
};

const cfg = (cap: number | undefined) => ({
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: {
      ...defaultReasoningConfig.strategies.reactive,
      ...(cap === undefined ? {} : { maxIterations: cap, maxIterationsExplicit: true }),
    },
    // One plan, no step retries: the turns counted are one step's single pass.
    planExecute: { maxRefinements: 1, reflectionDepth: "shallow" as const, stepRetries: 0 },
    treeOfThought: { breadth: 2, depth: 1, pruningThreshold: 0.3, skipBfsForTrivial: false },
  },
});

/** Run one registered strategy against the never-answering model; return the turns it used. */
const turnsUsed = async (name: string, cap: number | undefined): Promise<number> => {
  let calls = 0;
  const base = TestLLMService([...(SCRIPTS[name] ?? loopTurns())]);
  const rec = {
    ...base,
    complete: (r: Parameters<typeof base.complete>[0]) => { calls++; return base.complete(r); },
    stream: (r: Parameters<typeof base.stream>[0]) => { calls++; return base.stream(r); },
  };
  const layer = Layer.merge(
    Layer.succeed(LLMService, LLMService.of(rec)),
    succeedingToolLayer({ finding: "fact" }, GATHER.parameters),
  );
  const result = await Effect.runPromise(
    provideTestEnvelope(
      Effect.gen(function* () {
        const registry = yield* StrategyRegistry;
        const strategy = yield* registry.get(name as never);
        return yield* strategy({
          taskDescription: "Gather many facts about the topic, one per item.",
          taskType: "research",
          memoryContext: "",
          availableTools: ["gather"],
          availableToolSchemas: [GATHER],
          config: cfg(cap),
        } as never);
      }).pipe(Effect.provide(StrategyRegistryLive), Effect.provide(layer)) as never,
    ) as never,
  ) as { metadata: { kernelIterations?: number; planSteps?: readonly unknown[] } };
  // Strategies without kernel turns (direct, code-action) report their LLM calls.
  const kernelTurns = result.metadata.kernelIterations ?? 0;
  // plan-execute hands each plan step its own kernel pass: its cap is per pass.
  const passes = result.metadata.planSteps?.length ?? 1;
  return kernelTurns > 0 ? kernelTurns / passes : calls;
};

describe("every registered strategy honors the user's maxIterations", () => {
  it("each registered strategy has a driver or a reasoned exemption", async () => {
    const names = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* StrategyRegistry).list();
      }).pipe(Effect.provide(StrategyRegistryLive)),
    );
    const known = new Set<string>([...DRIVEN, ...Object.keys(EXEMPT)]);
    expect(names.filter((n) => !known.has(n))).toEqual([]);
  });

  for (const name of DRIVEN) {
    it(`${name}: a user cap of 3 bounds the run (tier default is larger)`, async () => {
      const used = await turnsUsed(name, 3);
      expect(used).toBeGreaterThan(0);
      expect(used).toBeLessThanOrEqual(3);
    }, 30000);
  }

  it("direct: an explicit user cap of 1 bounds a tools-enabled run to one turn", async () => {
    expect(await turnsUsed("direct", 1)).toBe(1);
  }, 30000);

  it("direct: with tools and NO user cap the resolver default (3) applies, never more", async () => {
    const used = await turnsUsed("direct", undefined);
    expect(used).toBeGreaterThan(1);
    expect(used).toBeLessThanOrEqual(3);
  }, 30000);

  it("tree-of-thought: with NO user cap the tier default still applies (more than 3 turns)", async () => {
    expect(await turnsUsed("tree-of-thought", undefined)).toBeGreaterThan(3);
  }, 30000);
});
