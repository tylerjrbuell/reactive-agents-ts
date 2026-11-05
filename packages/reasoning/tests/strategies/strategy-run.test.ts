// File: tests/strategies/strategy-run.test.ts
//
// The strategy run substrate (strategies/substrate/strategy-run.ts): one
// trajectory per strategy run. Pins the behavior every migrated strategy now
// gets by construction instead of by per-file wiring: spend accounting across
// direct calls and kernel passes, the pause short-circuit, the one
// kernel-terminal relay, and the drift contract that keeps migrated strategies
// off the old plumbing.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Effect, Layer } from "effect";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { ToolService, createToolsLayer } from "@reactive-agents/tools";
import { runStrategy } from "../../src/strategies/substrate/strategy-run.js";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { provideTestEnvelope, buildRunEnvelope } from "../../src/kernel/envelope/run-envelope.js";

const PRIOR_LAZY = process.env.RA_LAZY_TOOLS;
beforeAll(() => { process.env.RA_LAZY_TOOLS = "0"; });
afterAll(() => {
  if (PRIOR_LAZY === undefined) delete process.env.RA_LAZY_TOOLS;
  else process.env.RA_LAZY_TOOLS = PRIOR_LAZY;
});

const addToolDef = {
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

const passOptions = {
  maxIterations: 3,
  strategy: "tree-of-thought",
  kernelType: "react",
  taskId: "substrate-test",
  kernelPass: "substrate:test",
} as const;

describe("runStrategy — one trajectory per run", () => {
  it("accounts direct calls and kernel passes into one spend, and relays the pass as the terminal", async () => {
    const layer = TestLLMServiceLayer([
      { match: "Expand", text: "1. try addition" },
      { match: "Sum", text: "FINAL ANSWER: 5" },
    ]);

    const program = runStrategy(
      { strategy: "tree-of-thought", taskId: "substrate-test", logSite: "test" },
      (run) =>
        Effect.gen(function* () {
          yield* run.call({ purpose: "plan" }, { messages: [{ role: "user", content: "Expand the task" }] }, { message: "expand failed" });
          run.record(makeStep("observation", "[TEST] control note"));
          const pass = yield* run.pass(reactKernel, { task: "Sum 2 and 3", availableToolSchemas: [] }, passOptions);
          expect(run.spend().llmCalls).toBe(1 + (pass.state.llmCalls ?? 0));
          return { _tag: "KernelTerminal" as const, pass };
        }),
    );

    const result = await Effect.runPromise(provideTestEnvelope(
      program.pipe(Effect.provide(layer)),
      buildRunEnvelope({}),
    ));

    const meta = result.metadata as { llmCalls?: number; terminatedBy?: string; runLedger?: unknown };
    expect(meta.llmCalls).toBeGreaterThanOrEqual(2);
    expect(meta.terminatedBy).toBeDefined();
    expect(Array.isArray(meta.runLedger)).toBe(true);
    expect(result.output).toContain("5");
    expect(result.status).toBe("completed");
    // Strategy notes and the pass's steps share one ordered trajectory.
    expect(result.steps[0]?.content).toBe("[TEST] control note");
  });

  it("a paused pass ends the run with the paused result; the body never continues past it", async () => {
    const layer = TestLLMServiceLayer([
      { match: "step by step", toolCall: { name: "add", args: { a: 2, b: 3 } } },
      { match: "Observation", text: "FINAL ANSWER: 5." },
    ]);
    let continuedAfterPause = false;

    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(addToolDef, (args) => Effect.succeed((args.a as number) + (args.b as number)));
      const schemas = [{ name: "add", description: addToolDef.description, parameters: addToolDef.parameters }];
      return yield* runStrategy(
        { strategy: "tree-of-thought", taskId: "substrate-test", requiredTools: ["add"], logSite: "test" },
        (run) =>
          Effect.gen(function* () {
            const pass = yield* run.pass(reactKernel, {
              task: "Add the numbers 2 and 3",
              availableToolSchemas: schemas,
              requiredTools: ["add"],
            }, { ...passOptions, maxIterations: 5 });
            continuedAfterPause = true;
            return { _tag: "KernelTerminal" as const, pass };
          }),
      );
    });

    const result = await Effect.runPromise(provideTestEnvelope(
      program.pipe(Effect.provide(Layer.merge(layer, createToolsLayer()))),
      buildRunEnvelope({ approvalPolicy: { mode: "detach", tools: new Set(["add"]) } }),
    ));

    const meta = result.metadata as { rawTerminatedBy?: string; awaitingApprovalFor?: { toolName: string } };
    expect(continuedAfterPause).toBe(false);
    expect(meta.rawTerminatedBy).toBe("awaiting-approval");
    expect(meta.awaitingApprovalFor?.toolName).toBe("add");
  });

  it("a strategy-computed Result with no kernel pass forwards an honest empty ledger", async () => {
    const program = runStrategy(
      { strategy: "tree-of-thought", logSite: "test" },
      () => Effect.succeed({ _tag: "Result" as const, output: null, status: "partial" as const }),
    );
    const result = await Effect.runPromise(provideTestEnvelope(
      program.pipe(Effect.provide(TestLLMServiceLayer([]))),
      buildRunEnvelope({}),
    ));
    expect((result.metadata as { runLedger?: unknown[] }).runLedger).toEqual([]);
    // No output is never a success (M7 coherence guard).
    expect(result.status).toBe("failed");
  });

  it("a strategy-decided abstention becomes the abstained claim with its descriptor, capped at partial", async () => {
    const program = runStrategy({ strategy: "plan-execute-reflect", logSite: "test" }, () =>
      Effect.succeed({
        _tag: "Result" as const,
        output: "Unable to verify this answer.",
        status: "completed" as const,
        outcome: { _tag: "Abstained" as const, reason: "required tools never ran", missing: ["web-search"] },
      }),
    );
    const result = await Effect.runPromise(provideTestEnvelope(program.pipe(Effect.provide(TestLLMServiceLayer([]))), buildRunEnvelope({})));
    const meta = result.metadata as { terminatedBy?: string; rawTerminatedBy?: string; abstention?: { missing: string[] } };
    expect(result.status).toBe("partial");
    expect(meta.terminatedBy).toBe("abstained");
    expect(meta.rawTerminatedBy).toBe("abstained");
    expect(meta.abstention?.missing).toEqual(["web-search"]);
  });

  it("a strategy budget stop marks the output harness-authored with the raw reason and warning", async () => {
    const program = runStrategy({ strategy: "plan-execute-reflect", logSite: "test" }, () =>
      Effect.succeed({
        _tag: "Result" as const,
        output: "joined step results",
        status: "completed" as const,
        outcome: { _tag: "BudgetStopped" as const, rawReason: "budget-limit:tokens:1200/1000", warning: "Token budget exhausted" },
      }),
    );
    const result = await Effect.runPromise(provideTestEnvelope(program.pipe(Effect.provide(TestLLMServiceLayer([]))), buildRunEnvelope({})));
    const meta = result.metadata as Record<string, unknown>;
    expect(result.status).toBe("partial");
    expect(meta.terminatedBy).toBe("end_turn");
    expect(meta.rawTerminatedBy).toBe("budget-limit:tokens:1200/1000");
    expect(meta.budgetTerminalPartial).toBe(true);
    expect(meta.harnessAuthoredOutput).toBe(true);
    expect(meta.verificationWarning).toBe("Token budget exhausted");
  });
});

describe("runStrategy — one ledger, one status cap, pause-safe concurrency", () => {
  it("accumulates every pass's ledger facts into one densely indexed run ledger", async () => {
    const layer = TestLLMServiceLayer([{ match: "Sum", text: "FINAL ANSWER: 5" }]);
    let perPass: number[] = [];
    const program = runStrategy({ strategy: "reflexion", logSite: "test" }, (run) =>
      Effect.gen(function* () {
        const a = yield* run.pass(reactKernel, { task: "Sum 2 and 3", availableToolSchemas: [] }, passOptions);
        const b = yield* run.pass(reactKernel, { task: "Sum 2 and 3 again", availableToolSchemas: [] }, passOptions);
        perPass = [a.state.ledger?.length ?? 0, b.state.ledger?.length ?? 0];
        return { _tag: "Result" as const, output: b.output, status: "completed" as const, basedOn: b };
      }),
    );
    const result = await Effect.runPromise(provideTestEnvelope(program.pipe(Effect.provide(layer)), buildRunEnvelope({})));
    const runLedger = (result.metadata as { runLedger?: { seq: number }[] }).runLedger ?? [];
    expect(perPass[0]).toBeGreaterThan(0);
    expect(runLedger.length).toBe(perPass[0]! + perPass[1]!);
    expect(runLedger.map((e) => e.seq)).toEqual(runLedger.map((_, i) => i));
  });

  it("a continuing pass adopts the run contract and ledger; the run ledger absorbs only its new facts", async () => {
    const layer = TestLLMServiceLayer([{ match: "Sum", text: "FINAL ANSWER: 5" }]);
    let firstLen = 0;
    let secondLen = 0;
    let sameContract = false;
    const program = runStrategy({ strategy: "reflexion", logSite: "test" }, (run) =>
      Effect.gen(function* () {
        const a = yield* run.pass(reactKernel, { task: "Sum 2 and 3", availableToolSchemas: [] }, passOptions);
        const b = yield* run.pass(reactKernel, { task: "Sum 2 and 3, improved", availableToolSchemas: [] }, passOptions,
          { continues: true });
        firstLen = a.state.ledger?.length ?? 0;
        secondLen = b.state.ledger?.length ?? 0;
        sameContract = a.state.meta.runContract !== undefined && b.state.meta.runContract === a.state.meta.runContract;
        return { _tag: "Result" as const, output: b.output, status: "completed" as const, basedOn: b };
      }),
    );
    const result = await Effect.runPromise(provideTestEnvelope(program.pipe(Effect.provide(layer)), buildRunEnvelope({})));
    const runLedger = (result.metadata as { runLedger?: { seq: number }[] }).runLedger ?? [];
    expect(firstLen).toBeGreaterThan(0);
    // The continuing pass started from the first pass's ledger and its contract.
    expect(sameContract).toBe(true);
    expect(secondLen).toBeGreaterThan(firstLen);
    // Seeded entries are not absorbed twice: the run ledger IS the second pass's ledger length.
    expect(runLedger.length).toBe(secondLen);
    expect(runLedger.map((e) => e.seq)).toEqual(runLedger.map((_, i) => i));
  });

  it("a contributing budget-terminal pass caps a strategy's own 'completed' claim; a non-contributing one does not", async () => {
    const layer = TestLLMServiceLayer([{ match: "Sum", text: "Let me think about this carefully." }]);
    const runWith = (contributes: boolean) =>
      Effect.runPromise(provideTestEnvelope(
        runStrategy({ strategy: "reflexion", logSite: "test" }, (run) =>
          Effect.gen(function* () {
            yield* run.pass(
              reactKernel,
              { task: "Sum 2 and 3", availableToolSchemas: [], budgetLimits: { tokenLimit: 1 } },
              passOptions,
              { contributes },
            );
            return { _tag: "Result" as const, output: "5", status: "completed" as const };
          }),
        ).pipe(Effect.provide(layer)),
        buildRunEnvelope({}),
      ));
    const capped = await runWith(true);
    const free = await runWith(false);
    expect(capped.status).toBe("partial");
    expect(free.status).toBe("completed");
  });

  it("concurrent passes with deferPause: every sibling is recorded, then the run ends paused", async () => {
    const layer = TestLLMServiceLayer([
      { match: "Add the numbers", toolCall: { name: "add", args: { a: 2, b: 3 } } },
      { match: "Say hello", text: "FINAL ANSWER: hello" },
      { match: "Observation", text: "FINAL ANSWER: 5." },
    ]);
    let continued = false;
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(addToolDef, (args) => Effect.succeed((args.a as number) + (args.b as number)));
      const schemas = [{ name: "add", description: addToolDef.description, parameters: addToolDef.parameters }];
      return yield* runStrategy({ strategy: "plan-execute-reflect", logSite: "test" }, (run) =>
        Effect.gen(function* () {
          const results = yield* Effect.all([
            run.pass(reactKernel, { task: "Add the numbers 2 and 3", availableToolSchemas: schemas, requiredTools: ["add"] }, { ...passOptions, maxIterations: 4 }, { deferPause: true }),
            run.pass(reactKernel, { task: "Say hello", availableToolSchemas: [] }, passOptions, { deferPause: true }),
          ], { concurrency: 2 });
          expect(results.length).toBe(2);
          yield* run.checkpoint();
          continued = true;
          return { _tag: "Result" as const, output: "done", status: "completed" as const };
        }),
      );
    });
    const result = await Effect.runPromise(provideTestEnvelope(
      program.pipe(Effect.provide(Layer.merge(layer, createToolsLayer()))),
      buildRunEnvelope({ approvalPolicy: { mode: "detach", tools: new Set(["add"]) } }),
    ));
    expect(continued).toBe(false);
    expect((result.metadata as { rawTerminatedBy?: string }).rawTerminatedBy).toBe("awaiting-approval");
    // Both siblings' calls are accounted, not only the paused one.
    expect((result.metadata as { llmCalls?: number }).llmCalls).toBeGreaterThanOrEqual(2);
  });

  it("relay keys are reserved: strategy extras cannot set them (type-level)", () => {
    const end = {
      _tag: "KernelTerminal" as const,
      // @ts-expect-error terminatedBy is derived by the substrate, never set by a strategy
      extraMetadata: { terminatedBy: "final_answer" },
    };
    expect(end._tag).toBe("KernelTerminal");
    const extras: import("../../src/strategies/substrate/strategy-run.js").StrategyExtras = { bfsSkipped: true };
    expect(extras.bfsSkipped).toBe(true);
  });
});

describe("substrate drift contract", () => {
  // Strategies migrated onto runStrategy. This list only GROWS until every
  // strategy is on the substrate (spec: 2026-11-04-strategy-run-substrate.md).
  const MIGRATED = ["direct.ts", "reactive.ts", "reflexion.ts", "tree-of-thought.ts", "plan-execute.ts", "blueprint.ts"];
  const BANNED = [
    "runKernel",
    "runPass",
    "finalizeStrategyResult",
    "finalizePausedStrategyResult",
    "kernelPause",
    "deriveTerminatedBy",
    "honestPartialMetadata",
    "gatewayComplete",
  ];

  it("migrated strategies import none of the trajectory plumbing the substrate owns", () => {
    const stratDir = join(__dirname, "../../src/strategies");
    const files = readdirSync(stratDir).filter((f) => MIGRATED.includes(f));
    expect(files.length).toBe(MIGRATED.length);
    const violations: string[] = [];
    for (const file of files) {
      const src = readFileSync(join(stratDir, file), "utf8");
      const imports = (src.match(/^import[\s\S]+?from\s+["'][^"']+["'];?$/gm) ?? []).join("\n");
      for (const sym of BANNED) {
        if (new RegExp(`[{,\\s]${sym}\\b`).test(imports)) violations.push(`${file}: ${sym}`);
      }
      if (/\btotalTokens\s*\+=|\bllmCalls\s*\+=/.test(src)) violations.push(`${file}: hand-rolled spend accumulator`);
      // An error-swallowing combinator can eat a StrategyPaused and keep the
      // run going past an approval gate. Each use must say why it is safe.
      src.split("\n").forEach((line, i) => {
        if (/Effect\.(catchAll|catchAllCause|retry|orElse|either|ignore)\b/.test(line) && !/substrate-ok:/.test(line)) {
          violations.push(`${file}:${i + 1}: unannotated error-swallowing combinator (add "// substrate-ok: <why no run.pass inside>")`);
        }
      });
    }
    expect(violations).toEqual([]);
  });
});
