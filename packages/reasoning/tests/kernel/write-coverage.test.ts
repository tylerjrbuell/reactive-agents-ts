// Run: bun test packages/reasoning/tests/kernel/write-coverage.test.ts --timeout 15000
//
// Write coverage (DEBT #39, write side; harness switch `writeCoverage`, default OFF).
//
// Feedback-loop spike 2026-11-07: in current-code failures 58% of lh-debug-green
// modules and 32% of rw-7 bugs were never written. One `file-write` credited
// `tool:file-write` for every target, so runs ended at iteration ~4-5 of 24-25.
// With the switch on, every in-place edit target is its own requirement
// (`TargetWritten`), met only by a successful write of THAT path.
import { afterEach, describe, expect, it } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import {
  LLMService,
  type CompletionRequest,
  type CompletionResponse,
  type StreamEvent,
  type StructuredCompletionRequest,
} from "@reactive-agents/llm-provider";
import { EventBusLive, modelSynthesisDeliverable } from "@reactive-agents/core";
import { deriveWriteTargets } from "../../src/kernel/capabilities/verify/derive-inputs.js";
import { compileRunContract } from "../../src/kernel/contract/run-contract.js";
import { deliveryRails } from "../../src/kernel/contract/delivery-scope.js";
import { isTargetWritten, targetWritten } from "../../src/kernel/capabilities/verify/post-conditions.js";
import { outstandingToolWork } from "../../src/kernel/capabilities/reason/act-or-answer.js";
import { outstandingItems } from "../../src/kernel/loop/exit-gate.js";
import { appendEntry, type RunLedger } from "../../src/kernel/ledger/run-ledger.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import { GUARD_OBSERVATION_TAG } from "../../src/kernel/state/kernel-constants.js";
import { makeKernelInput, makeKernelState } from "../../src/testing/kernel-fixtures.js";
import { resolveHarnessConfig } from "../../src/harness-config.js";
import { runKernel } from "../../src/kernel/loop/runner.js";
import { transitionState, type KernelInput, type KernelState, type ThoughtKernel } from "../../src/kernel/state/kernel-state.js";
import type { ReasoningStep } from "../../src/types/index.js";

afterEach(() => {
  delete process.env.RA_WRITE_COVERAGE;
});

// ── Real task prompts (packages/benchmarks cannot be imported: it depends on reasoning) ──

const MODULES = ["clamp", "slugify", "chunk", "median", "duration", "dedupe"] as const;
const DEBUG_GREEN = `The TypeScript package in your working directory has six modules, each with one bug, and one failing test file per module:
${MODULES.map((m) => `- src/${m}.ts (tested by tests/${m}.test.ts)`).join("\n")}
Fix the bug in each module in place. Do not edit the tests and keep every exported function name and signature unchanged. Work through all six modules; you are done only when every test file passes.`;

const RW7 =
  "The TypeScript package in your working directory has bugs in src/validator.ts, src/processor.ts, and src/pipeline.ts. No test suite is provided. Write tests to find the bugs, fix all of the bugs in place, and verify your tests pass. Keep the exported function names and signatures unchanged. Do not stop until `bun test` exits 0.";

const RW2 = `Analyze the attached sales data in sales-data.csv. Identify what caused the revenue drop on day 2 (2025-03-11) compared to day 1 (2025-03-10). Name the specific primary cause, quantify the dollar impact, and recommend one concrete fix.

Write your final analysis to analysis.md in your working directory with exactly these three section headings: "## Primary Cause", "## Dollar Impact", "## Recommendation".`;

const INVOICES = Array.from({ length: 12 }, (_, i) => `invoices/inv-${String(i + 1).padStart(2, "0")}.json`);
const ENUMERATE_AUDIT = `Twelve invoice files are in your working directory:
${INVOICES.map((p) => `- ${p}`).join("\n")}
Read every one. An invoice is VALID only if all three rules hold:
1. "amount" equals the sum of qty * unit over its "lines" (within 0.01).
2. "due" is a later date than "issued".
3. "currency" is one of USD, EUR, GBP.
Write two files in your working directory:
- audit.json: a JSON array with one object per invoice, {"id": "<invoice id>", "valid": true|false}.
- invalid.txt: the ids of the invalid invoices, one per line, sorted alphabetically.
Check all twelve invoices; do not guess any of them.`;

const PIPELINE_STAGES = `Run a three-stage data pipeline in your working directory. pipeline.json says which order batches to use, the minimum amount, and the duplicate policy. The batches are:
- batches/a.csv
- batches/b.csv
Each batch is a CSV with columns order_id,region,amount.
Stage 1: write clean.csv with header order_id,region,amount: every row from the batches pipeline.json lists, in that order, keeping only the FIRST row for each order_id, then dropping rows whose amount is below the minimum.
Stage 2: write by-region.json from clean.csv: {"<region>": {"orders": <row count>, "total": <sum of amount>}}.
Stage 3: write report.md containing a line "Total revenue: <sum of all amounts in clean.csv, 2 decimals>" and a line "Top region: <region with the largest total>".
Each stage reads the previous stage's output; finish all three.`;

const RW3 = "Analyze employees.csv and write a report to report.md surfacing whatever you think is most actionable for leadership. Show your reasoning.";
const RW4 =
  "Using the JSONPlaceholder API at https://jsonplaceholder.typicode.com, fetch all posts by user ID 3, enrich each post with its comment count, and write a TypeScript module to output.ts that exports a typed EnrichedPost[] array as a const. The module must compile without errors.";
const RW6 = "Profile and optimize the attached sorting implementation in sort.ts for maximum performance. Provide specific improvements with before/after benchmarks.\n\nWrite your final analysis to optimization-report.md in your working directory.";
const RW8 =
  "Complete the following phases using these constraints:\nPhase 2: Write a TypeScript type definition file (types.ts) for User, Order, Product\nPhase 3: Write a data generator (generate.ts) that creates 5 sample records of each type\nPhase 4: Write a validator (validate.ts) that checks all constraints are met";
const RW10 = "Our user onboarding is underperforming. Improve it.\n\nHere is everything we have: users sign up, confirm email, and are shown a dashboard. Drop-off is 40% between signup and dashboard. Fix this.";
const AB_TRAP_5 = 'Read the file ./ledger.json and report the exact total of the "amount" fields as a number. Do not guess: if you cannot read the file, say you cannot determine the total.';
const PLAN_ONLY = "inventory.csv in your working directory lists SKUs and on-hand quantities. Produce these three files in your working directory:\n1. low-stock.txt: every SKU\n2. totals.json: a JSON object\n3. summary.md: a short note.\nCreate the files; a plan alone is not the deliverable.";

let callSeq = 0;
/** One tool call + its observation, linked by toolCallId (the act phase's shape). */
function call(name: string, args: Record<string, unknown>, success = true): ReasoningStep[] {
  const id = `w${++callSeq}`;
  return [
    makeStep("action", `${name}(${JSON.stringify(args)})`, { toolCall: { id, name, arguments: args } }),
    makeStep("observation", success ? "ok" : "EACCES", { toolCallId: id, observationResult: makeObservationResult(name, success, success ? "ok" : "EACCES") }),
  ];
}

describe("deriveWriteTargets — in-place edit targets only", () => {
  const entities = (task: string, exists?: (p: string) => boolean) => deriveWriteTargets(task, exists).map((t) => t.entity);

  it("rw-7: the three listed source files", () => {
    expect(entities(RW7)).toEqual(["src/validator.ts", "src/processor.ts", "src/pipeline.ts"]);
  });

  it("lh-debug-green: the six src modules, never the test files", () => {
    expect(entities(DEBUG_GREEN)).toEqual(MODULES.map((m) => `src/${m}.ts`));
  });

  it("every other LH / H3 / real-world task derives no target", () => {
    for (const task of [RW2, ENUMERATE_AUDIT, PIPELINE_STAGES, RW3, RW4, RW6, RW8, RW10, AB_TRAP_5, PLAN_ONLY, "What is 2 + 2?"]) {
      expect(entities(task)).toEqual([]);
    }
  });

  it("the noun 'fix' is not an edit instruction (rw-2)", () => {
    expect(entities("Analyze sales-data.csv and recommend one concrete fix.")).toEqual([]);
    expect(entities("Fix the bug in src/a.ts.")).toEqual(["src/a.ts"]);
  });

  it("test files and URLs are never targets", () => {
    expect(entities("Fix the bugs in src/a.ts, tests/a.test.ts, lib/b.spec.ts and https://x.io/api in place.")).toEqual(["src/a.ts"]);
  });

  it("only files that exist at run start are targets", () => {
    expect(entities(RW7, (p) => p !== "src/processor.ts")).toEqual(["src/validator.ts", "src/pipeline.ts"]);
    expect(entities(RW7, () => false)).toEqual([]);
  });

  it("start offsets point at the entity in the task text", () => {
    for (const { entity, start } of deriveWriteTargets(DEBUG_GREEN)) expect(DEBUG_GREEN.slice(start, start + entity.length)).toBe(entity);
  });
});

describe("compileRunContract — one write-coverage requirement per target (switch on only)", () => {
  it("switch on: one requirement per target with a TargetWritten condition", () => {
    const c = compileRunContract(RW7, { writeCoverage: true });
    const writes = c.requirements.filter((r) => r.kind === "write-coverage");
    expect(writes.map((r) => r.id)).toEqual(["write:src/validator.ts", "write:src/processor.ts", "write:src/pipeline.ts"]);
    expect(writes[0]!.spec.condition).toEqual(targetWritten("src/validator.ts"));
    expect(writes[0]!.spec.source).toBe("task-explicit");
    expect(c.postConditions).toContainEqual(targetWritten("src/pipeline.ts"));
  });

  it("switch off: the contract has zero write-coverage requirements and is the pre-switch contract", () => {
    expect(compileRunContract(RW7, { writeCoverage: false })).toEqual(compileRunContract(RW7));
    expect(compileRunContract(RW7).requirements.some((r) => r.kind === "write-coverage")).toBe(false);
    expect(compileRunContract(RW7).postConditions.some((p) => p.kind === "TargetWritten")).toBe(false);
  });

  it("pin (b)/(c): noun-fix + csv prompt and create-only / read-only prompts compile nothing", () => {
    for (const task of [RW2, ENUMERATE_AUDIT, PIPELINE_STAGES, PLAN_ONLY]) {
      expect(compileRunContract(task, { writeCoverage: true })).toEqual(compileRunContract(task));
    }
  });

  it("plan posture and a step kernel compile no write requirements", () => {
    expect(compileRunContract(RW7, { writeCoverage: true, posture: "plan" }).requirements.some((r) => r.kind === "write-coverage")).toBe(false);
    expect(compileRunContract(RW7, { writeCoverage: true, deliveryScope: "step" }).requirements.some((r) => r.kind === "write-coverage")).toBe(false);
  });

  it("writeTargetExists filters to files on disk at run start", () => {
    const c = compileRunContract(RW7, { writeCoverage: true, writeTargetExists: (p) => p === "src/pipeline.ts" });
    expect(c.requirements.filter((r) => r.kind === "write-coverage").map((r) => r.id)).toEqual(["write:src/pipeline.ts"]);
  });

  it("deliveryRails carries the switch from the harness (config or env), absent when off", () => {
    const on = deliveryRails({ harness: resolveHarnessConfig({ writeCoverage: true }) });
    expect(on.writeCoverage).toBe(true);
    expect(typeof on.writeTargetExists).toBe("function");
    expect(deliveryRails({ harness: resolveHarnessConfig() })).toEqual({});
    process.env.RA_WRITE_COVERAGE = "1";
    expect(deliveryRails({}).writeCoverage).toBe(true);
    expect(resolveHarnessConfig().writeCoverage).toBe(true);
    delete process.env.RA_WRITE_COVERAGE;
    expect("writeCoverage" in resolveHarnessConfig()).toBe(false);
  });

  it("a surface that cannot write (no substantive tool) gets no write requirements", () => {
    const harness = resolveHarnessConfig({ writeCoverage: true });
    expect(deliveryRails({ harness, availableToolSchemas: [{ name: "final-answer" }] })).toEqual({});
    expect(deliveryRails({ harness, availableToolSchemas: [{ name: "file-write" }] }).writeCoverage).toBe(true);
  });
});

describe("TargetWritten — met by a successful write of THAT path only", () => {
  const A = "src/clamp.ts";
  const B = "src/slugify.ts";

  it("a write of A does not satisfy B; file-edit counts", () => {
    const steps = call("file-write", { path: `/work/${A}`, content: "x" });
    expect(isTargetWritten(A, steps)).toBe(true);
    expect(isTargetWritten(B, steps)).toBe(false);
    expect(isTargetWritten(B, call("file-edit", { path: B, old: "a", new: "b" }))).toBe(true);
  });

  it("a read, a failed write, and a guard-answered write do not count", () => {
    expect(isTargetWritten(A, call("file-read", { path: A }))).toBe(false);
    expect(isTargetWritten(A, call("file-write", { path: A, content: "x" }, false))).toBe(false);
    const guarded = call("file-write", { path: A, content: "x" }).map((s) =>
      s.type === "observation" ? { ...s, metadata: { ...s.metadata, frameworkInstrumentation: GUARD_OBSERVATION_TAG } } : s,
    );
    expect(isTargetWritten(A, guarded)).toBe(false);
  });

  it("a path named only in the content body does not count; no basename collision", () => {
    expect(isTargetWritten(A, call("file-write", { path: "notes.md", content: `see ${A}` }))).toBe(false);
    expect(isTargetWritten("src/amp.ts", call("file-write", { path: A, content: "x" }))).toBe(false);
  });

  it("ledger evidence counts (a sub-agent's merged write); a refused one does not", () => {
    let ledger: RunLedger = [];
    ledger = appendEntry(ledger, { kind: "tool-invocation", iteration: 1, toolName: "file-write", toolCallId: "s1", args: { path: B, content: "x" } });
    ledger = appendEntry(ledger, { kind: "tool-result", iteration: 1, toolName: "file-write", toolCallId: "s1", success: true, preview: "ok" });
    expect(isTargetWritten(B, [], ledger)).toBe(true);
    expect(isTargetWritten(A, [], ledger)).toBe(false);
    let refused: RunLedger = [];
    refused = appendEntry(refused, { kind: "tool-invocation", iteration: 1, toolName: "file-write", toolCallId: "s2", args: { path: B, content: "x" } });
    refused = appendEntry(refused, { kind: "tool-result", iteration: 1, toolName: "file-write", toolCallId: "s2", success: true, preview: "no", refused: true });
    expect(isTargetWritten(B, [], refused)).toBe(false);
  });
});

describe("pin (a): the exit gate and act-or-answer name each unwritten target", () => {
  const contract = compileRunContract(RW7, { writeCoverage: true });
  const stateWith = (steps: readonly ReasoningStep[], c = contract): KernelState =>
    makeKernelState({ iteration: 4, llmCalls: 4, steps: [...steps, makeStep("thought", "All bugs are fixed.")], meta: { runContract: c } });
  const input = makeKernelInput({ task: RW7 });
  const answer = modelSynthesisDeliverable({ type: "thought", content: "All bugs are fixed.", iteration: 4 });
  const wroteOne = call("file-write", { path: "src/validator.ts", content: "x" });
  const wroteAll = [...wroteOne, ...call("file-edit", { path: "src/processor.ts" }), ...call("file-write", { path: "src/pipeline.ts", content: "y" })];

  it("exit gate: 1 of 3 written -> denies naming the other two; all written -> finishes", () => {
    expect(outstandingItems(stateWith(wroteOne), input, answer)).toEqual([
      "write your fix to the listed target src/processor.ts",
      "write your fix to the listed target src/pipeline.ts",
    ]);
    expect(outstandingItems(stateWith(wroteAll), input, answer)).toEqual([]);
  });

  it("act-or-answer: outstandingToolWork names the unwritten targets", () => {
    expect(outstandingToolWork(stateWith(wroteOne), input)).toEqual(["write:src/processor.ts", "write:src/pipeline.ts"]);
    expect(outstandingToolWork(stateWith(wroteAll), input)).toEqual([]);
  });

  it("a write requirement is not displaced by unmet input requirements (rw-7 cogito)", () => {
    const both = compileRunContract(RW7, { writeCoverage: true, inputCoverage: true });
    const reads = [...call("file-read", { path: "src/validator.ts" })];
    const work = outstandingToolWork(stateWith([...reads, ...wroteOne], both), input);
    expect(work).toEqual(expect.arrayContaining(["input:src/processor.ts", "input:src/pipeline.ts", "write:src/processor.ts", "write:src/pipeline.ts"]));
    expect(work).not.toContain("write:src/validator.ts");
  });

  it("pin (d): switch off -> the same state has nothing outstanding", () => {
    const off = compileRunContract(RW7);
    expect(outstandingItems(stateWith(wroteOne, off), input, answer)).toEqual([]);
    expect(outstandingToolWork(stateWith(wroteOne, off), input)).toEqual([]);
  });
});

/** The probe kernel never calls the model; the runner only needs the services present. */
const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCost: 0 };
const stubLlm = Layer.merge(
  Layer.succeed(
    LLMService,
    LLMService.of({
      complete: (_r: CompletionRequest) => Effect.succeed<CompletionResponse>({ content: "ok", stopReason: "end_turn", usage, model: "test" }),
      stream: (_r: CompletionRequest) => Effect.succeed(Stream.empty as Stream.Stream<StreamEvent, never>),
      completeStructured: <A>(_r: StructuredCompletionRequest<A>) => Effect.die("unused"),
      embed: (t: readonly string[]) => Effect.succeed(t.map(() => [0])),
      countTokens: (m: readonly unknown[]) => Effect.succeed(m.length),
      getModelConfig: () => Effect.succeed({ provider: "anthropic", model: "test-model" }),
      getStructuredOutputCapabilities: () =>
        Effect.succeed({ nativeJsonMode: false, jsonSchemaEnforcement: false, prefillSupport: false, grammarConstraints: false }),
      capabilities: () =>
        Effect.succeed({ supportsToolCalling: true, supportsStreaming: true, supportsSystemPrompt: true, supportsLogprobs: false, supportsNativeStreaming: true, supportsPromptCaching: false }),
    }),
  ),
  EventBusLive,
);

describe("runKernel compiles write coverage from the run's harness", () => {
  async function contractOf(kernelInput: KernelInput) {
    let seen: KernelState["meta"]["runContract"];
    const probe: ThoughtKernel = (state) => {
      seen = state.meta.runContract;
      return Effect.succeed(transitionState(state, { status: "done", output: "ok", iteration: state.iteration + 1 }));
    };
    await Effect.runPromise(
      runKernel(probe, kernelInput, { maxIterations: 3, strategy: "test", kernelType: "test" }).pipe(Effect.provide(stubLlm)),
    );
    return seen;
  }
  const writes = (c: KernelState["meta"]["runContract"]) => (c?.requirements ?? []).filter((r) => r.kind === "write-coverage").map((r) => r.id);

  it("off by default: contract-compiled has zero write-coverage requirements", async () => {
    expect(writes(await contractOf({ task: RW7, harness: resolveHarnessConfig() }))).toEqual([]);
    expect(writes(await contractOf({ task: RW7 }))).toEqual([]);
  }, 15000);

  it("on via config or env: targets that do not exist at run start are dropped", async () => {
    // The fixture paths do not exist under the test's file root, so existence filters them all.
    expect(writes(await contractOf({ task: RW7, harness: resolveHarnessConfig({ writeCoverage: true }) }))).toEqual([]);
    process.env.RA_WRITE_COVERAGE = "1";
    expect(writes(await contractOf({ task: RW7 }))).toEqual([]);
  }, 15000);

  it("on, with the targets present in the file root: one requirement per target", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { withFileRoot } = await import("@reactive-agents/tools");
    const dir = mkdtempSync(join(tmpdir(), "wcov-"));
    try {
      mkdirSync(join(dir, "src"));
      for (const f of ["validator", "processor", "pipeline"]) writeFileSync(join(dir, "src", `${f}.ts`), "export {};\n");
      const c = await withFileRoot(dir, () => contractOf({ task: RW7, harness: resolveHarnessConfig({ writeCoverage: true }) }));
      expect(writes(c)).toHaveLength(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);
});
