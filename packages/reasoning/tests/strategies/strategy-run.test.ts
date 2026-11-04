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
});

describe("substrate drift contract", () => {
  // Strategies migrated onto runStrategy. This list only GROWS until every
  // strategy is on the substrate (spec: 2026-11-04-strategy-run-substrate.md).
  const MIGRATED = ["direct.ts", "reactive.ts", "tree-of-thought.ts"];
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
    }
    expect(violations).toEqual([]);
  });
});
