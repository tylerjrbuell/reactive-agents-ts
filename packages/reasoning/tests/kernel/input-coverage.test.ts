// Run: bun test packages/reasoning/tests/kernel/input-coverage.test.ts --timeout 15000
//
// Input coverage (DEBT #39, harness switch `inputCoverage`, default OFF).
//
// act-or-answer ablation 2026-11-07: on lh-debug-green ("six modules, one bug
// each: src/clamp.ts ... src/dedupe.ts"), 9 runs ended `success` after reading
// 1-5 of the 6 modules. One `file-read` satisfied `tool:file-read`, so neither
// the exit gate nor act-or-answer's outstandingToolWork saw work left. With the
// switch on, every listed input is its own requirement (`InputRead`).
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
import { deriveListedInputs } from "../../src/kernel/capabilities/verify/derive-inputs.js";
import { compileRunContract } from "../../src/kernel/contract/run-contract.js";
import { deliveryRails } from "../../src/kernel/contract/delivery-scope.js";
import { inputRead, isInputRead, verify } from "../../src/kernel/capabilities/verify/post-conditions.js";
import { outstandingToolWork } from "../../src/kernel/capabilities/reason/act-or-answer.js";
import { outstandingItems } from "../../src/kernel/loop/exit-gate.js";
import { assess } from "../../src/kernel/assessment/assess.js";
import { appendEntry, type RunLedger } from "../../src/kernel/ledger/run-ledger.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import { GUARD_OBSERVATION_TAG } from "../../src/kernel/state/kernel-constants.js";
import { makeKernelInput, makeKernelState } from "../../src/testing/kernel-fixtures.js";
import { resolveHarnessConfig } from "../../src/harness-config.js";
import { runKernel } from "../../src/kernel/loop/runner.js";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { transitionState, type KernelInput, type KernelState, type ThoughtKernel } from "../../src/kernel/state/kernel-state.js";
import type { ReasoningStep } from "../../src/types/index.js";

afterEach(() => {
  delete process.env.RA_INPUT_COVERAGE;
});

const MODULES = ["clamp", "slugify", "chunk", "median", "duration", "dedupe"] as const;
/** lh-debug-green's prompt, verbatim shape (packages/benchmarks/src/h3/long-horizon-tasks.ts). */
const DEBUG_GREEN = `The TypeScript package in your working directory has six modules, each with one bug, and one failing test file per module:
${MODULES.map((m) => `- src/${m}.ts (tested by tests/${m}.test.ts)`).join("\n")}
Fix the bug in each module in place. Do not edit the tests and keep every exported function name and signature unchanged. Work through all six modules; you are done only when every test file passes.`;

/** h3-plan-only's prompt: one input, three deliverables. */
const PLAN_ONLY = `inventory.csv in your working directory lists SKUs and on-hand quantities. Produce these three files in your working directory:
1. low-stock.txt: every SKU whose qty is below 10, one SKU per line, sorted alphabetically.
2. totals.json: a JSON object {"totalUnits": <sum of all qty>, "skuCount": <number of SKUs>}.
3. summary.md: a short note that contains a section headed "## Reorder".
Create the files; a plan alone is not the deliverable.`;

const RW7 = "The TypeScript package in your working directory has bugs in src/validator.ts, src/processor.ts, and src/pipeline.ts. Fix all of the bugs in place.";

const NO_INPUTS = "Explain in two sentences why unit tests catch regressions early.";

let callSeq = 0;
/** One tool call + its observation, linked by toolCallId (the act phase's shape). */
function call(name: string, args: Record<string, unknown>, success = true): ReasoningStep[] {
  const id = `c${++callSeq}`;
  return [
    makeStep("action", `${name}(${JSON.stringify(args)})`, { toolCall: { id, name, arguments: args } }),
    makeStep("observation", success ? "ok" : "ENOENT", { toolCallId: id, observationResult: makeObservationResult(name, success, success ? "ok" : "ENOENT") }),
  ];
}

describe("deriveListedInputs — the inputs a task lists", () => {
  it("lh-debug-green: all twelve listed files, in task order", () => {
    expect(deriveListedInputs(DEBUG_GREEN).map((i) => i.entity)).toEqual(
      MODULES.flatMap((m) => [`src/${m}.ts`, `tests/${m}.test.ts`]),
    );
  });

  it("deliverables the task asks to write are never inputs (h3-plan-only)", () => {
    expect(deriveListedInputs(PLAN_ONLY).map((i) => i.entity)).toEqual(["inventory.csv"]);
  });

  it("a file to fix in place is an input (rw-7)", () => {
    expect(deriveListedInputs(RW7).map((i) => i.entity)).toEqual(["src/validator.ts", "src/processor.ts", "src/pipeline.ts"]);
  });

  it("an API URL is an input; a JSON-Schema identifier and a code member are not", () => {
    expect(deriveListedInputs("Using the API at https://jsonplaceholder.typicode.com, fetch the posts.").map((i) => i.entity)).toEqual([
      "https://jsonplaceholder.typicode.com",
    ]);
    expect(deriveListedInputs('Answer as JSON: {"$schema": "http://json-schema.org/draft-07/schema#", "type": "object"}')).toEqual([]);
    expect(deriveListedInputs('Run code that logs "hi" with console.log and report the output.')).toEqual([]);
  });

  it("a placeholder is not an input; a task with no paths lists none", () => {
    expect(deriveListedInputs("For each notes-N.txt, summarize it.")).toEqual([]);
    expect(deriveListedInputs(NO_INPUTS)).toEqual([]);
  });

  it("more than fifty listed paths is not a per-item checklist", () => {
    const many = `Read ${Array.from({ length: 51 }, (_, i) => `data/f${i}.json`).join(", ")}.`;
    expect(deriveListedInputs(many)).toEqual([]);
  });

  it("start offsets point at the entity in the task text", () => {
    for (const { entity, start } of deriveListedInputs(DEBUG_GREEN)) expect(DEBUG_GREEN.slice(start, start + entity.length)).toBe(entity);
  });
});

describe("compileRunContract — one input-coverage requirement per listed input (switch on only)", () => {
  it("switch on: one requirement per input, a task-explicit InputRead condition, a task-text span", () => {
    const c = compileRunContract(RW7, { inputCoverage: true });
    const inputs = c.requirements.filter((r) => r.kind === "input-coverage");
    expect(inputs.map((r) => r.id)).toEqual(["input:src/validator.ts", "input:src/processor.ts", "input:src/pipeline.ts"]);
    expect(inputs[0]!.spec.condition).toEqual(inputRead("src/validator.ts"));
    expect(inputs[0]!.spec.source).toBe("task-explicit");
    const span = inputs[0]!.provenance?.span;
    expect(span !== undefined && RW7.slice(span.start, span.end)).toBe("src/validator.ts");
    expect(c.postConditions).toContainEqual(inputRead("src/pipeline.ts"));
  });

  it("switch off: the contract is exactly the pre-switch contract", () => {
    expect(compileRunContract(RW7, { inputCoverage: false })).toEqual(compileRunContract(RW7));
    expect(compileRunContract(RW7).requirements.some((r) => r.kind === "input-coverage")).toBe(false);
  });

  it("no inputs listed: switch on compiles the identical contract", () => {
    for (const task of [NO_INPUTS, "Write a haiku about rain to haiku.md.", "What is 2 + 2?"]) {
      expect(compileRunContract(task, { inputCoverage: true })).toEqual(compileRunContract(task));
    }
  });

  it("plan posture and a step kernel compile no input requirements", () => {
    expect(compileRunContract(RW7, { inputCoverage: true, posture: "plan" }).requirements.some((r) => r.kind === "input-coverage")).toBe(false);
    expect(compileRunContract(RW7, { inputCoverage: true, deliveryScope: "step" }).requirements.some((r) => r.kind === "input-coverage")).toBe(false);
  });

  it("deliveryRails carries the switch from the harness (config or env), absent when off", () => {
    expect(deliveryRails({ harness: resolveHarnessConfig({ inputCoverage: true }) })).toEqual({ inputCoverage: true });
    expect(deliveryRails({ harness: resolveHarnessConfig() })).toEqual({});
    process.env.RA_INPUT_COVERAGE = "1";
    expect(deliveryRails({})).toEqual({ inputCoverage: true });
    expect(resolveHarnessConfig().inputCoverage).toBe(true);
    delete process.env.RA_INPUT_COVERAGE;
    expect("inputCoverage" in resolveHarnessConfig()).toBe(false);
  });

  it("a surface that cannot read (no substantive tool) gets no input requirements", () => {
    const harness = resolveHarnessConfig({ inputCoverage: true });
    expect(deliveryRails({ harness, availableToolSchemas: [{ name: "final-answer" }] })).toEqual({});
    expect(deliveryRails({ harness, availableToolSchemas: [] })).toEqual({});
    expect(deliveryRails({ harness, availableToolSchemas: [{ name: "file-read" }] })).toEqual({ inputCoverage: true });
  });
});

describe("InputRead — met by a read of THAT entity only", () => {
  const A = "src/clamp.ts";
  const B = "src/slugify.ts";

  it("a read of A does not satisfy B", () => {
    const steps = call("file-read", { path: `/work/${A}` });
    expect(isInputRead(A, steps)).toBe(true);
    expect(isInputRead(B, steps)).toBe(false);
  });

  it("a write of the file is not a read of it", () => {
    expect(isInputRead(A, call("file-write", { path: A, content: "x" }))).toBe(false);
  });

  it("a failed read settles the item (a listed file may be absent)", () => {
    expect(isInputRead("./ledger.json", call("file-read", { path: "ledger.json" }, false))).toBe(true);
  });

  it("a guard-answered call never ran and does not count", () => {
    const steps = call("file-read", { path: A });
    const guarded = steps.map((s) => (s.type === "observation" ? { ...s, metadata: { ...s.metadata, frameworkInstrumentation: GUARD_OBSERVATION_TAG } } : s));
    expect(isInputRead(A, guarded)).toBe(false);
  });

  it("matches across absolute / relative forms, and inside a shell command", () => {
    expect(isInputRead(`/work/${A}`, call("file-read", { path: A }))).toBe(true);
    expect(isInputRead(A, call("shell-execute", { command: `cat ./${A} | head` }))).toBe(true);
    expect(isInputRead("src/amp.ts", call("file-read", { path: A }))).toBe(false); // no basename collision
  });

  it("a URL is read by a fetch of a path under it", () => {
    expect(isInputRead("https://api.example.com", call("http-get", { url: "https://api.example.com/posts?userId=3" }))).toBe(true);
    expect(isInputRead("https://api.example.com", call("http-get", { url: "https://api.example.community/x" }))).toBe(false);
  });

  it("ledger evidence counts (a sub-agent's merged read)", () => {
    let ledger: RunLedger = [];
    ledger = appendEntry(ledger, { kind: "tool-invocation", iteration: 1, toolName: "file-read", toolCallId: "s1", args: { path: B } });
    ledger = appendEntry(ledger, { kind: "tool-result", iteration: 1, toolName: "file-read", toolCallId: "s1", success: true, preview: "ok" });
    expect(isInputRead(B, [], ledger)).toBe(true);
    expect(isInputRead(A, [], ledger)).toBe(false);
  });

  it("verify() partitions per entity", () => {
    const { met, unmet } = verify([inputRead(A), inputRead(B)], call("file-read", { path: A }));
    expect(met).toEqual([inputRead(A)]);
    expect(unmet).toEqual([inputRead(B)]);
  });
});

describe("the exit gate, act-or-answer and assess() see each unread input", () => {
  const contract = compileRunContract(RW7, { inputCoverage: true });
  const stateWith = (steps: readonly ReasoningStep[]): KernelState =>
    makeKernelState({ iteration: 4, llmCalls: 4, steps: [...steps, makeStep("thought", "All bugs are fixed.")], meta: { runContract: contract } });
  const input = makeKernelInput({ task: RW7 });
  const answer = modelSynthesisDeliverable({ type: "thought", content: "All bugs are fixed.", iteration: 4 });
  const readOne = call("file-read", { path: "src/validator.ts" });
  const readAll = [...readOne, ...call("file-read", { path: "src/processor.ts" }), ...call("file-read", { path: "src/pipeline.ts" })];

  it("exit gate: denies the answer while inputs are unread, naming each one", () => {
    expect(outstandingItems(stateWith(readOne), input, answer)).toEqual([
      "read the listed input src/processor.ts",
      "read the listed input src/pipeline.ts",
    ]);
    expect(outstandingItems(stateWith(readAll), input, answer)).toEqual([]);
  });

  it("act-or-answer: outstandingToolWork names the unread inputs", () => {
    expect(outstandingToolWork(stateWith(readOne), input)).toEqual(["input:src/processor.ts", "input:src/pipeline.ts"]);
    expect(outstandingToolWork(stateWith(readAll), input)).toEqual([]);
  });

  it("assess(): the read input is satisfied, the others outstanding", () => {
    let ledger: RunLedger = [];
    ledger = appendEntry(ledger, { kind: "tool-invocation", iteration: 1, toolName: "file-read", toolCallId: "r1", args: { path: "src/validator.ts" } });
    ledger = appendEntry(ledger, { kind: "tool-result", iteration: 1, toolName: "file-read", toolCallId: "r1", success: true, preview: "ok" });
    const { requirements } = assess(contract, ledger, { iteration: 2, maxIterations: 20, tokensUsed: 0, costUsd: 0 });
    expect(requirements.satisfied).toContain("input:src/validator.ts");
    expect(requirements.outstanding).toEqual(expect.arrayContaining(["input:src/processor.ts", "input:src/pipeline.ts"]));
  });
});

describe("runKernel compiles input coverage from the run's harness", () => {
  async function contractOf(input: KernelInput) {
    let seen: KernelState["meta"]["runContract"];
    const probe: ThoughtKernel = (state) => {
      seen = state.meta.runContract;
      return Effect.succeed(transitionState(state, { status: "done", output: "ok", iteration: state.iteration + 1 }));
    };
    await Effect.runPromise(
      runKernel(probe, input, { maxIterations: 3, strategy: "test", kernelType: "test" }).pipe(Effect.provide(scripted([]))),
    );
    return seen;
  }
  const kinds = (c: KernelState["meta"]["runContract"]) => (c?.requirements ?? []).filter((r) => r.kind === "input-coverage").map((r) => r.id);

  it("on via config or env; off by default", async () => {
    expect(kinds(await contractOf({ task: RW7, harness: resolveHarnessConfig({ inputCoverage: true }) }))).toHaveLength(3);
    expect(kinds(await contractOf({ task: RW7, harness: resolveHarnessConfig() }))).toEqual([]);
    process.env.RA_INPUT_COVERAGE = "1";
    expect(kinds(await contractOf({ task: RW7 }))).toHaveLength(3);
  }, 15000);
});

// ── Golden: a task that lists no inputs sends byte-identical requests ──────────

const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 };
const ANSWER = "Unit tests run on every change, so a regression fails a test the moment it is introduced.";
const answerEvents: readonly StreamEvent[] = [
  { type: "text_delta", text: ANSWER },
  { type: "content_complete", content: ANSWER, stopReason: "end_turn" },
  { type: "usage", usage },
];

function scripted(captured: CompletionRequest[]) {
  return Layer.merge(
    Layer.succeed(
      LLMService,
      LLMService.of({
        complete: (_r: CompletionRequest) => Effect.succeed<CompletionResponse>({ content: ANSWER, stopReason: "end_turn", usage, model: "test" }),
        stream: (request: CompletionRequest) => {
          captured.push(request);
          return Effect.succeed(Stream.fromIterable(answerEvents));
        },
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
}

async function requestsFor(task: string, inputCoverage: boolean): Promise<string> {
  const captured: CompletionRequest[] = [];
  const input: KernelInput = {
    task,
    taskId: "golden-input-coverage",
    providerName: "anthropic",
    modelId: "test-model",
    harness: resolveHarnessConfig({ lazyDisclosure: false, inputCoverage }),
  };
  await Effect.runPromise(
    runKernel(reactKernel, input, { maxIterations: 4, strategy: "reactive", kernelType: "react", taskId: "golden-input-coverage" }).pipe(
      Effect.provide(scripted(captured)),
    ),
  );
  return JSON.stringify(captured.map((r) => ({ messages: r.messages, systemPrompt: r.systemPrompt, tools: r.tools, toolChoice: r.toolChoice })));
}

describe("golden — no listed inputs, switch on: byte-identical requests", () => {
  it("a task that lists no inputs sends the same requests with the switch on and off", async () => {
    const off = await requestsFor(NO_INPUTS, false);
    expect(off.length).toBeGreaterThan(2);
    expect(await requestsFor(NO_INPUTS, true)).toBe(off);
  }, 20000);

  it("control: with listed inputs the switch does change the requests (the instrument can see it)", async () => {
    expect(await requestsFor(RW7, true)).not.toBe(await requestsFor(RW7, false));
  }, 20000);
});
