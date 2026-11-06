// Run: bun test packages/reasoning/tests/strategies/max-calls-per-tool-run-count.test.ts --timeout 20000
//
// `maxCallsPerTool` is counted ONCE per run. The kernel gate and the
// direct-dispatch budget (`StrategyRun.toolCallBudget`) read and reserve
// against one run-wide count (the `reasoning.toolCallCounts` run slot), so a
// run with several kernel passes, or a mix of direct dispatch and kernel
// passes, cannot exceed the cap. Before, each kernel pass counted from its own
// state, so a 1-call cap allowed one call per unseeded pass: (b) and (c) were
// red at 94f0c9ea5. (a) was already green there (reflexion's improve pass is a
// continuing pass seeded with the run ledger); it stays as a guard.
//
// Every cell goes through ReasoningService.execute (the user path) with
// {add: 1}; the script asks for `add` twice. The cap holds iff `add` runs once
// and the second call is refused with a tool-gate guard-fired event.
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import { TestLLMServiceLayer, type TestTurn } from "@reactive-agents/llm-provider";
import { createToolsLayer, ToolService } from "@reactive-agents/tools";
import { ReasoningService, ReasoningServiceLive } from "../../src/services/reasoning-service.js";
import { StrategyRegistryLive } from "../../src/services/strategy-registry.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import type { ReasoningStrategy } from "../../src/types/index.js";

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
    reflexion: { ...defaultReasoningConfig.strategies.reflexion, maxRetries: 1 },
  },
};

interface CapRun {
  readonly executions: number;
  readonly refusals: number;
  readonly error?: string;
}

const runCapped = (strategy: ReasoningStrategy, turns: TestTurn[], cap: Readonly<Record<string, number>> | undefined): Promise<CapRun> => {
  let executions = 0;
  const program = Effect.gen(function* () {
    const refusals = yield* Ref.make(0);
    const bus = yield* EventBus;
    yield* bus.subscribe((ev) =>
      ev._tag === "GuardFiredEmitted" && ev.guard === "tool-gate" ? Ref.update(refusals, (n) => n + 1) : Effect.void,
    );
    const tools = yield* ToolService;
    yield* tools.register(addTool, (args) =>
      Effect.sync(() => {
        executions += 1;
        return (args.a as number) + (args.b as number);
      }),
    );
    const reasoning = yield* ReasoningService;
    const error = yield* reasoning
      .execute({
        taskDescription: "Use the add tool to add 2 and 3, and 4 and 5, then report both sums.",
        taskType: "computation",
        memoryContext: "",
        availableTools: ["add"],
        availableToolSchemas: [addSchema],
        strategy,
        taskId: `run-count-${strategy}`,
        ...(cap !== undefined ? { maxCallsPerTool: cap } : {}),
      })
      .pipe(
        Effect.map(() => undefined),
        Effect.catchAll((e) => Effect.succeed(`${e._tag}: ${String((e as { message?: unknown }).message)}`)),
      );
    return { refusals: yield* Ref.get(refusals), error };
  });
  const base = Layer.mergeAll(TestLLMServiceLayer(turns), createToolsLayer(),StrategyRegistryLive, EventBusLive);
  return Effect.runPromise(
    program.pipe(
      Effect.provide(Layer.provideMerge(ReasoningServiceLive(config), base)),
      Effect.map(({ refusals, error }): CapRun => ({ executions, refusals, ...(error !== undefined ? { error } : {}) })),
    ),
  );
};

const ADD_1 = { name: "add", args: { a: 2, b: 3 } };
const ADD_2 = { name: "add", args: { a: 4, b: 5 } };

/** reflexion: the generate pass calls add, the critique asks for more, the improve pass calls add again. */
const REFLEXION_TURNS: TestTurn[] = [
  { toolCall: ADD_1 },
  { text: "FINAL ANSWER: 5" },
  { text: "UNSATISFIED: the second sum (4 + 5) is missing. Call add for it." },
  { toolCall: ADD_2 },
  { text: "FINAL ANSWER: 5 and 9" },
  { text: "SATISFIED: both sums are reported." },
  { text: "FINAL ANSWER: 5 and 9" },
];

/** plan-execute: two composite steps, each one kernel pass that calls add. */
const TWO_PASS_PLAN = {
  steps: [
    { title: "First sum", instruction: "Add 2 and 3 with the add tool", type: "composite", toolHints: ["add"] },
    { title: "Second sum", instruction: "Add 4 and 5 with the add tool", type: "composite", toolHints: ["add"], dependsOn: ["s1"] },
  ],
};
const TWO_PASS_TURNS: TestTurn[] = [
  { json: TWO_PASS_PLAN },
  { toolCall: ADD_1 },
  { text: "FINAL ANSWER: 5" },
  { toolCall: ADD_2 },
  { text: "FINAL ANSWER: 9" },
  { text: "FINAL ANSWER: 5 and 9" },
];

/** plan-execute: a direct-dispatch tool_call step, then a composite (kernel) step that calls add. */
const MIXED_PLAN = {
  steps: [
    { title: "First sum", instruction: "Add 2 and 3", type: "tool_call", toolName: "add", toolArgs: ADD_1.args },
    { title: "Second sum", instruction: "Add 4 and 5 with the add tool", type: "composite", toolHints: ["add"], dependsOn: ["s1"] },
  ],
};
const MIXED_TURNS: TestTurn[] = [
  { json: MIXED_PLAN },
  { toolCall: ADD_2 },
  { text: "FINAL ANSWER: 9" },
  { text: "FINAL ANSWER: 5 and 9" },
];

const CELLS: readonly { readonly name: string; readonly strategy: ReasoningStrategy; readonly turns: TestTurn[] }[] = [
  { name: "(a) reflexion generate + improve passes", strategy: "reflexion", turns: REFLEXION_TURNS },
  { name: "(b) plan-execute, two kernel-composite steps", strategy: "plan-execute-reflect", turns: TWO_PASS_TURNS },
  { name: "(c) plan-execute, a direct tool_call step then a kernel pass", strategy: "plan-execute-reflect", turns: MIXED_TURNS },
];

describe("maxCallsPerTool is one run-wide count", () => {
  for (const c of CELLS) {
    it(`${c.name}: the uncapped control really calls add twice`, async () => {
      const r = await runCapped(c.strategy, c.turns, undefined);
      expect(r.error).toBeUndefined();
      expect(r.executions).toBe(2);
      expect(r.refusals).toBe(0);
    }, 30_000);

    it(`${c.name}: with {add: 1}, the second pass's call is refused`, async () => {
      const r = await runCapped(c.strategy, c.turns, { add: 1 });
      expect(r.error).toBeUndefined();
      expect(r.executions).toBe(1);
      expect(r.refusals).toBeGreaterThanOrEqual(1);
    }, 30_000);
  }
});
