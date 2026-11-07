// File: tests/strategies/strategy-overhead.test.ts
//
// Strategy overhead ratchet (Plan 9 S4a). Every registered strategy runs the
// SAME scripted trivial task (the conformance task: add 2 and 3 with the `add`
// tool, then report). Its reported llmCalls and tokensUsed are pinned as
// ceilings, shrink-only like scripts/check-file-size.sh:
//   - above its ceiling   -> fails (a strategy got more expensive);
//   - below its ceiling   -> fails until the ceiling is lowered here, with a
//                            dated comment (the win becomes the new floor).
// The scripted model makes every run deterministic, so the numbers are exact.
// The table is the input for S4b's call cuts.
import { describe, it, expect, beforeAll, afterAll, setSystemTime } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { ToolService, createToolsLayer } from "@reactive-agents/tools";
import { StrategyRegistry, StrategyRegistryLive } from "../../src/services/strategy-registry.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope, buildRunEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import type { ReasoningStrategy } from "../../src/types/index.js";

const PRIOR_LAZY = process.env.RA_LAZY_TOOLS;
// The prompt carries the current date, so token counts moved with the
// calendar (ceilings "shrank" on one day and "grew" on another with no code
// change). Pin the clock to the day the ceilings were measured.
beforeAll(() => {
  process.env.RA_LAZY_TOOLS = "0";
  setSystemTime(new Date("2026-11-06T12:00:00Z"));
});
afterAll(() => {
  setSystemTime();
  if (PRIOR_LAZY === undefined) delete process.env.RA_LAZY_TOOLS;
  else process.env.RA_LAZY_TOOLS = PRIOR_LAZY;
});

/**
 * Ceilings per strategy on the trivial task. Shrink-only: lower a value (with
 * a dated note) when a strategy gets cheaper; never raise one without an
 * explicit owner decision recorded here.
 *
 * 2026-11-05 baseline (S4a): captured after every strategy moved onto the
 * strategy run substrate. Tokens are the scripted model's deterministic
 * estimates, comparable across strategies, not provider numbers. code-action's
 * scripted reply is not code, so its run is plan + repairs to the iteration cap.
 */
const CEILINGS: Readonly<Record<string, { readonly llmCalls: number; readonly tokensUsed: number }>> = {
  direct: { llmCalls: 1, tokensUsed: 278 },
  reactive: { llmCalls: 2, tokensUsed: 607 },
  adaptive: { llmCalls: 2, tokensUsed: 607 },
  blueprint: { llmCalls: 1, tokensUsed: 1001 },
  // 2026-11-05 tokens 1105 -> 1102 (and tree-of-thought 1571 -> 1569, reflexion
  // 1830 -> 1829): shrink already present at HEAD 6a6a7f4d5 before the 2b
  // follow-ups; lowered by the follow-up mission, cause not attributed.
  "code-action": { llmCalls: 4, tokensUsed: 1102 },
  // 2026-11-05 S4b 4/1601 -> 2/1260: reflect skipped when every step completed
  // and the deterministic delivery judgment verified the contract (the
  // scripted reflect said UNSATISFIED, so the old run also paid an augment).
  "plan-execute-reflect": { llmCalls: 2, tokensUsed: 1260 },
  "tree-of-thought": { llmCalls: 8, tokensUsed: 1569 },
  // 2026-11-05 6/2305 -> 5/1830: one run-wide tool evidence (Plan 9 Phase 1
  // close) — the second pass no longer forgets pass 1's file-write and pays a
  // grounding-redirect turn.
  reflexion: { llmCalls: 5, tokensUsed: 1829 },
};

/** Aliases resolve to the same implementation; measure each implementation once. */
const ALIASES: ReadonlySet<string> = new Set(["react", "rewoo"]);

const addTool = {
  name: "add",
  description: "Add two numbers together",
  parameters: [
    { name: "a", type: "number" as const, description: "First number", required: true },
    { name: "b", type: "number" as const, description: "Second number", required: true },
  ],
  riskLevel: "low" as const,
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function" as const,
};
const addSchema = { name: "add", description: addTool.description, parameters: addTool.parameters };

const config = {
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations: 4 },
  },
};

/** Strategies whose first model call asks for a structured plan. */
const PLANNERS: ReadonlySet<string> = new Set(["plan-execute-reflect", "blueprint"]);
const PLAN = {
  steps: [{ title: "Add", instruction: "Add 2 and 3 with the add tool", type: "tool_call", toolName: "add", toolArgs: { a: 2, b: 3 } }],
};

/** The conformance script: plans (for planners), calls `add` whenever asked, then answers. */
const script = (strategy: string) =>
  TestLLMServiceLayer([
    ...(PLANNERS.has(strategy) ? [{ json: PLAN }] : []),
    { match: "Observation", text: "FINAL ANSWER: 5" },
    { match: "add", toolCall: { name: "add", args: { a: 2, b: 3 } } },
    { text: "FINAL ANSWER: 5" },
  ]);

interface Overhead {
  readonly llmCalls: number;
  readonly tokensUsed: number;
}

const measure = (name: ReasoningStrategy): Promise<Overhead> => {
  const program = Effect.gen(function* () {
    const tools = yield* ToolService;
    yield* tools.register(addTool, (args) => Effect.succeed((args.a as number) + (args.b as number)));
    const registry = yield* StrategyRegistry;
    const fn = yield* registry.get(name);
    return yield* fn({
      taskDescription: "Use the add tool to add 2 and 3, then report the sum.",
      taskType: "computation",
      memoryContext: "",
      availableTools: ["add"],
      availableToolSchemas: [addSchema],
      requiredTools: ["add"],
      config,
      taskId: `overhead-${name}`,
    });
  });
  return Effect.runPromise(
    provideTestEnvelope(
      program.pipe(
        Effect.provide(Layer.mergeAll(script(name), createToolsLayer(), StrategyRegistryLive)),
        Effect.map((result): Overhead => {
          const meta: Readonly<Record<string, unknown>> = result.metadata;
          return {
            llmCalls: typeof meta["llmCalls"] === "number" ? meta["llmCalls"] : 0,
            tokensUsed: result.metadata.tokensUsed,
          };
        }),
      ),
      buildRunEnvelope({}),
    ),
  );
};

const strategies = await Effect.runPromise(
  Effect.gen(function* () {
    const registry = yield* StrategyRegistry;
    return (yield* registry.list()).filter((s) => !ALIASES.has(s));
  }).pipe(Effect.provide(StrategyRegistryLive)),
);

describe("strategy overhead ratchet (shrink-only ceilings on one trivial task)", () => {
  it("every registered implementation has a ceiling", () => {
    expect(strategies.filter((s) => CEILINGS[s] === undefined)).toEqual([]);
  });

  for (const strategy of strategies) {
    it(`${strategy}: llmCalls and tokensUsed sit exactly at the ceiling`, async () => {
      const measured = await measure(strategy);
      const ceiling = CEILINGS[strategy];
      console.log(`[overhead] ${strategy} llmCalls=${measured.llmCalls} tokensUsed=${measured.tokensUsed}`);
      expect(ceiling).toBeDefined();
      if (ceiling === undefined) return;
      const verdict = (field: keyof Overhead): string =>
        measured[field] > ceiling[field]
          ? `${strategy}.${field} GREW to ${measured[field]} (ceiling ${ceiling[field]})`
          : measured[field] < ceiling[field]
            ? `${strategy}.${field} SHRANK to ${measured[field]} (ceiling ${ceiling[field]}): lower the ceiling with a dated note`
            : "at ceiling";
      expect(verdict("llmCalls")).toBe("at ceiling");
      expect(verdict("tokensUsed")).toBe("at ceiling");
    }, 30_000);
  }
});
