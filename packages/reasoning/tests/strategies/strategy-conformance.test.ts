// File: tests/strategies/strategy-conformance.test.ts
//
// Strategy conformance over the registry (Plan 9 Phase 0b). Every registered
// strategy is run through the same invariants, so a new strategy is covered on
// registration instead of by a hand-written per-strategy test:
//
//   C1  HITL safety: an approval-gated tool never executes without a decision.
//       The run either ends with the paused result, or refuses with a typed
//       error (code-action cannot pause by design and refuses loudly).
//   C2  Spend: a normal run reports llmCalls > 0 and tokens > 0.
//   C3  Ledger: a normal run's result carries a runLedger array, and any tool
//       the run executed appears in it.
//   C4  Outcome: the result carries the minted terminalOutcome.
//
// KNOWN_GAPS lists cells that are red today. The list may only shrink: a
// fixed gap whose cell turns green fails here until it is removed, and a new
// red cell fails until it is fixed or deliberately listed.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { ToolService, createToolsLayer } from "@reactive-agents/tools";
import { StrategyRegistry, StrategyRegistryLive } from "../../src/services/strategy-registry.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope, buildRunEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import type { ReasoningStrategy } from "../../src/types/index.js";

const PRIOR_LAZY = process.env.RA_LAZY_TOOLS;
beforeAll(() => { process.env.RA_LAZY_TOOLS = "0"; });
afterAll(() => {
  if (PRIOR_LAZY === undefined) delete process.env.RA_LAZY_TOOLS;
  else process.env.RA_LAZY_TOOLS = PRIOR_LAZY;
});

/** Aliases resolve to the same implementation; test each implementation once. */
const ALIASES: ReadonlySet<string> = new Set(["react", "rewoo"]);

/**
 * Cells red today ("strategy:check"). May only shrink. Each names its fix.
 *  - direct:C1p      the 1-turn cap ends before the act step, so a gated call ends as a
 *                     budget failure, not a pending approval (safety holds: C1 is green).
 *  - *:C5             an unparseable plan fails the whole run with ExecutionError instead of
 *                     degrading to a planless run (Plan 9 S2).
 */
const KNOWN_GAPS: ReadonlySet<string> = new Set<string>([
  "direct:C1p",
  "plan-execute-reflect:C5",
  "blueprint:C5",
]);

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

/** A scripted model that plans (for planners, unless `badPlan`), calls `add` whenever asked, then answers. */
const script = (strategy: string, badPlan = false) =>
  TestLLMServiceLayer([
    ...(PLANNERS.has(strategy) && !badPlan ? [{ json: PLAN }] : []),
    { match: "Observation", text: "FINAL ANSWER: 5" },
    { match: "add", toolCall: { name: "add", args: { a: 2, b: 3 } } },
    { text: "FINAL ANSWER: 5" },
  ]);

interface CellRun {
  readonly result?: { readonly status: string; readonly metadata: Record<string, unknown> };
  readonly refused: boolean;
  readonly toolExecutions: number;
  readonly error?: string;
}

const runCell = (name: ReasoningStrategy, gated: boolean, badPlan = false): Promise<CellRun> => {
  let toolExecutions = 0;
  const program = Effect.gen(function* () {
    const tools = yield* ToolService;
    yield* tools.register(addTool, (args) =>
      Effect.sync(() => {
        toolExecutions += 1;
        return (args.a as number) + (args.b as number);
      }),
    );
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
      taskId: `conformance-${name}`,
    });
  });
  const envelope = buildRunEnvelope(gated ? { approvalPolicy: { mode: "detach", tools: new Set(["add"]) } } : {});
  return Effect.runPromise(
    provideTestEnvelope(
      program.pipe(
        Effect.provide(Layer.mergeAll(script(name, badPlan), createToolsLayer(), StrategyRegistryLive)),
        Effect.map((result): CellRun => ({ result, refused: false, toolExecutions })),
        Effect.catchAll((e) => Effect.succeed<CellRun>({ refused: true, toolExecutions, error: `${e._tag}: ${e.message}` })),
      ),
      envelope,
    ),
  );
};

const strategies = await Effect.runPromise(
  Effect.gen(function* () {
    const registry = yield* StrategyRegistry;
    return (yield* registry.list()).filter((s) => !ALIASES.has(s));
  }).pipe(Effect.provide(StrategyRegistryLive)),
);

/** Assert a cell, honoring the shrink-only KNOWN_GAPS list. */
const cell = (strategy: string, check: string, ok: boolean, detail: string): void => {
  const key = `${strategy}:${check}`;
  if (KNOWN_GAPS.has(key)) {
    expect(ok ? `${key} is green: remove it from KNOWN_GAPS` : "still red").toBe("still red");
    return;
  }
  expect(ok ? "ok" : `${key} RED: ${detail}`).toBe("ok");
};

describe("strategy conformance over the registry", () => {
  it("covers every registered implementation", () => {
    expect(strategies.length).toBeGreaterThanOrEqual(8);
  });

  for (const strategy of strategies) {
    it(`${strategy}: C1 an approval-gated tool never executes without a decision`, async () => {
      const r = await runCell(strategy, true);
      const raw = r.result?.metadata["rawTerminatedBy"];
      const paused = raw === "awaiting-approval";
      // C1 is safety: no execution without a decision, and no success claimed around it.
      cell(strategy, "C1", r.toolExecutions === 0 && (r.refused || r.result?.status !== "completed" || paused), `executions=${r.toolExecutions} status=${r.result?.status}`);
      // C1p: the pending approval is surfaced (paused result), or the strategy refuses loudly.
      cell(strategy, "C1p", r.toolExecutions === 0 && (paused || r.refused), `executions=${r.toolExecutions} paused=${paused} refused=${r.refused} status=${r.result?.status} terminatedBy=${String(r.result?.metadata["terminatedBy"])}/${String(raw)} output=${String((r.result as { output?: unknown } | undefined)?.output).slice(0, 80)}`);
    }, 30_000);

    it(`${strategy}: C2-C4 spend, ledger and outcome on a normal run`, async () => {
      const r = await runCell(strategy, false);
      const m = r.result?.metadata ?? {};
      const llmCalls = typeof m["llmCalls"] === "number" ? m["llmCalls"] : 0;
      const tokens = typeof m["tokensUsed"] === "number" ? m["tokensUsed"] : 0;
      cell(strategy, "C2", !r.refused && llmCalls > 0 && tokens > 0, `refused=${r.refused} error=${r.error ?? "-"} llmCalls=${llmCalls} tokens=${tokens}`);
      const ledger = Array.isArray(m["runLedger"]) ? (m["runLedger"] as { kind?: string; toolName?: string }[]) : undefined;
      const toolInLedger = ledger?.some((e) => e.kind === "tool-invocation" && e.toolName === "add") ?? false;
      cell(strategy, "C3", ledger !== undefined && (r.toolExecutions === 0 || toolInLedger), `ledger=${ledger?.length ?? "absent"} executions=${r.toolExecutions} toolInLedger=${toolInLedger}`);
      const ext = m["extensions"] as { terminalOutcome?: unknown } | undefined;
      cell(strategy, "C4", ext?.terminalOutcome !== undefined, `terminalOutcome=${ext?.terminalOutcome !== undefined}`);
    }, 30_000);

    if (PLANNERS.has(strategy)) {
      it(`${strategy}: C5 an unparseable plan never fails the whole run`, async () => {
        const r = await runCell(strategy, false, true);
        cell(strategy, "C5", !r.refused && r.result !== undefined, `refused=${r.refused} error=${r.error ?? "-"}`);
      }, 30_000);
    }
  }
});
