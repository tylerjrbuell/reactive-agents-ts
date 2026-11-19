// Run: bun run repo test packages/reasoning/tests/strategies/structured-strategy-payloads.test.ts
//
// `structured` payloads on ReasoningStepCompleted for adaptive (strategy-choice)
// and plan-execute / blueprint (plan-step). Zero-token scripted runs; payloads
// collected from the bus. Text and kernelPass labels are asserted unchanged.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBus, EventBusLive, type ReasoningStepData } from "@reactive-agents/core";
import { LLMError, LLMService, TestLLMService, TestLLMServiceLayer, type TestTurn } from "@reactive-agents/llm-provider";
import { ToolService } from "@reactive-agents/tools";
import { executeAdaptive } from "../../src/strategies/adaptive.js";
import { executePlanExecute } from "../../src/strategies/plan-execute.js";
import { executeBlueprint } from "../../src/strategies/blueprint.js";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import type { ToolSchema } from "../../src/kernel/capabilities/attend/tool-formatting.js";

interface BusEvent {
  readonly _tag?: string;
  readonly kernelPass?: string;
  readonly thought?: string;
  readonly observation?: string;
  readonly structured?: ReasoningStepData;
}

const collect = <A, E, R>(body: Effect.Effect<A, E, R>) => {
  const events: BusEvent[] = [];
  return Effect.runPromise(provideTestEnvelope(
    Effect.gen(function* () {
      const bus = yield* EventBus;
      const unsub = yield* bus.subscribe((e) => {
        if ((e as BusEvent)._tag === "ReasoningStepCompleted") events.push(e as BusEvent);
        return Effect.void;
      });
      const result = yield* body;
      unsub();
      return result;
    }).pipe(Effect.provide(EventBusLive)) as Effect.Effect<A, E, never>,
  )).then((result) => ({ result, events }));
};

const choices = (events: readonly BusEvent[]) =>
  events.flatMap((e) => (e.structured?.kind === "strategy-choice" ? [{ pass: e.kernelPass, ...e.structured }] : []));
const planSteps = (events: readonly BusEvent[]) =>
  events.flatMap((e) => (e.structured?.kind === "plan-step" ? [{ pass: e.kernelPass, ...e.structured }] : []));

// ── adaptive ────────────────────────────────────────────────────────────────

const AMBIGUOUS_TASK =
  "write a detailed comprehensive analysis of the subject matter covering all relevant aspects thoroughly and completely";
const COMPLEX_CLASSIFICATION = {
  complexity: { complexity: "complex", reason: "test", confidence: 0.9 },
  intent: { format: null, cues: [], expectedContent: [], expectedEntities: [] },
  shape: {
    complexity: "complex", needsTools: false, needsMultiStep: false, needsCitation: false,
    needsStructuredOutput: false, expectedOutputForm: "explanation", highConfidence: true, reason: "test",
  },
  horizon: { horizon: "short", reason: "test", confidence: 0.9 },
};

describe("adaptive: strategy-choice payloads", () => {
  it("heuristic path", async () => {
    const layer = TestLLMServiceLayer([{ match: "capital of France", text: "Paris." }]);
    const { events } = await collect(
      executeAdaptive({
        taskDescription: "What is the capital of France?",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(layer)),
    );
    const c = choices(events).filter((x) => x.pass === "adaptive:heuristic");
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ selected: "reactive", reason: "heuristic" });
    expect(events.find((e) => e.kernelPass === "adaptive:heuristic")?.thought).toBe("[ADAPTIVE] Heuristic: reactive");
  }, 20000);

  it("classifier (select) path", async () => {
    const layer = TestLLMServiceLayer([
      { match: "Classify the task", text: "REACTIVE" },
      { match: "Think step-by-step", text: "FINAL ANSWER: done." },
    ]);
    const { events } = await collect(
      executeAdaptive({
        taskDescription: AMBIGUOUS_TASK,
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: defaultReasoningConfig,
        taskClassification: COMPLEX_CLASSIFICATION,
      } as never).pipe(Effect.provide(layer)),
    );
    const c = choices(events).filter((x) => x.pass === "adaptive:select");
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ selected: "reactive", reason: "classifier" });
    expect(events.find((e) => e.kernelPass === "adaptive:select")?.thought).toBe("[ADAPTIVE] Selected strategy: reactive");
  }, 20000);

  it("classifier-skip path", async () => {
    const layer = TestLLMServiceLayer([{ match: "Think step-by-step", text: "FINAL ANSWER: done." }]);
    const { events } = await collect(
      executeAdaptive({
        taskDescription: AMBIGUOUS_TASK,
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: defaultReasoningConfig,
        taskClassification: COMPLEX_CLASSIFICATION,
        calibration: {
          modelId: "skip-test", calibratedAt: new Date(0).toISOString(), probeVersion: 1, runsAveraged: 1,
          steeringCompliance: "hybrid", parallelCallCapability: "sequential-only", observationHandling: "uses-recall",
          systemPromptAttention: "moderate", optimalToolResultChars: 800, classifierReliability: "low",
        },
      } as never).pipe(Effect.provide(layer)),
    );
    const c = choices(events).filter((x) => x.pass === "adaptive:classifier-skip");
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ selected: "reactive", reason: "classifier-skip", note: "classifierReliability=low" });
  }, 20000);

  it("cost-downgrade path", async () => {
    const o = (strategy: string, tokensUsed: number) =>
      ({ strategy, success: true, durationMs: 1000, tokensUsed, taskDescription: "x" });
    const layer = TestLLMServiceLayer([
      { match: "Compare", text: "Reactive answer." },
      { match: "compare", text: "Reactive answer." },
    ]);
    const { events } = await collect(
      executeAdaptive({
        taskDescription:
          "Compare the trade-offs between hash indexes and B-trees in terms of insertion speed, lookup performance, and storage overhead across modern databases.",
        taskType: "analysis",
        memoryContext: "",
        availableTools: [],
        config: defaultReasoningConfig,
        pastExperience: [
          o("reactive", 500), o("reactive", 600), o("reactive", 550),
          o("tree-of-thought", 3500), o("tree-of-thought", 4000), o("tree-of-thought", 3800),
        ],
      } as never).pipe(Effect.provide(layer)),
    );
    const c = choices(events).filter((x) => x.pass === "adaptive:cost-downgrade");
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ selected: "reactive", reason: "cost-downgrade" });
    expect(c[0]!.note).toContain("tree-of-thought");
  }, 20000);

  it("fallback path", async () => {
    const route = (text: string): TestTurn => {
      if (text.includes("Classify the task")) return { text: "REFLEXION" };
      if (text.includes("Evaluate whether")) return { text: "This response lacks detail and accuracy." };
      if (text.includes("Initial attempt at an answer.")) return { text: "" };
      if (text.includes("task execution agent")) return { text: "Initial attempt at an answer." };
      return { text: "FINAL ANSWER: Recovered with reactive fallback." };
    };
    const pick = (req: { readonly messages: readonly unknown[]; readonly systemPrompt?: unknown }) =>
      TestLLMService([route(`${JSON.stringify(req.messages)} ${typeof req.systemPrompt === "string" ? req.systemPrompt : ""}`)]);
    const base = TestLLMService([{ text: "" }]);
    const layer = Layer.succeed(LLMService, LLMService.of({
      ...base,
      complete: (req) => pick(req).complete(req),
      stream: (req) => pick(req).stream(req),
    }));
    const { events } = await collect(
      executeAdaptive({
        taskDescription: "Analyze the following complex dataset and produce a comprehensive report that covers all key findings and anomalies detected",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: {
          ...defaultReasoningConfig,
          strategies: { ...defaultReasoningConfig.strategies, reflexion: { maxRetries: 1, selfCritiqueDepth: "shallow" } },
        },
      }).pipe(Effect.provide(layer)),
    );
    const c = choices(events).filter((x) => x.pass === "adaptive:fallback");
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ selected: "reactive", reason: "fallback" });
    expect(c[0]!.note).toContain("reflexion");
  }, 30000);
});

// ── plan-execute ────────────────────────────────────────────────────────────

const analysisPlan = JSON.stringify({
  steps: [
    { title: "Gather", instruction: "gather notes", type: "analysis" },
    { title: "Summarize", instruction: "zebra-summary", type: "analysis" },
  ],
});

describe("plan-execute: plan-step payloads", () => {
  it("started / retry (attempt) / done per step, labels unchanged", async () => {
    const base = TestLLMService([
      { match: "planning agent", text: analysisPlan },
      { match: "GOAL:", text: "SATISFIED: done." },
      { match: "gather notes", text: "Notes." },
      { match: "zebra-summary", text: "Summary." },
      { match: "Synthesize", text: "Final answer." },
    ]);
    let n = 0;
    const llm = Layer.succeed(LLMService, LLMService.of({
      ...base,
      complete: (req: Parameters<typeof base.complete>[0]) =>
        JSON.stringify(req).includes("zebra-summary") && n++ < 1
          ? Effect.fail(new LLMError({ message: "transient", provider: "test" }))
          : base.complete(req),
    }));
    const { events } = await collect(
      executePlanExecute({
        taskDescription: "Fetch and summarize",
        taskType: "research",
        memoryContext: "",
        availableTools: [],
        config: {
          ...defaultReasoningConfig,
          strategies: {
            ...defaultReasoningConfig.strategies,
            planExecute: { ...defaultReasoningConfig.strategies.planExecute, stepRetries: 1 },
          },
        },
      }).pipe(Effect.provide(llm)),
    );
    const ps = planSteps(events);
    expect(ps.filter((p) => p.status === "started").map((p) => [p.pass, p.stepIndex])).toEqual([
      ["plan-execute:step-1:start", 0],
      ["plan-execute:step-2:start", 1],
    ]);
    const retry = ps.filter((p) => p.status === "retry");
    expect(retry).toHaveLength(1);
    expect(retry[0]).toMatchObject({ pass: "plan-execute:step-2:retry-1", stepIndex: 1, attempt: 2 });
    expect(retry[0]!.note).toBe("Analysis step 2 failed"); // lastError, as in the text label
    expect(ps.filter((p) => p.status === "done").map((p) => p.stepIndex)).toEqual([0, 1]);
    // Text unchanged.
    expect(events.find((e) => e.kernelPass === "plan-execute:step-2:retry-1")?.thought).toContain("[RETRY s2 attempt 2/2]");
  }, 30000);

  it("failed + patched carry the step index; the failed step is not also reported done", async () => {
    const toolLayer = Layer.succeed(
      ToolService,
      ToolService.of({
        execute: (input: { toolName: string; arguments: Record<string, unknown> }) =>
          Effect.succeed(
            input.toolName === "bad-search"
              ? { result: "[Tool error: upstream 500]", success: false }
              : { result: `Results for ${String(input.arguments.query)}`, success: true },
          ),
        getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: [] }),
        register: () => Effect.void,
        listTools: () => Effect.succeed([]),
        deregister: () => Effect.void,
      } as never),
    );
    const plan = (first: string) => JSON.stringify({
      steps: [
        { title: "Search", instruction: "search", type: "tool_call", toolName: first, toolArgs: { query: "x" }, rationale: { why: "fixture", confidence: 0.9 } },
        { title: "Summarize", instruction: "summarize", type: "analysis", dependsOn: ["s1"] },
      ],
    });
    const llm = TestLLMServiceLayer([
      { match: "planning agent", text: plan("bad-search") },
      { match: "plan encountered a failure", text: plan("web-search") },
      { match: "OVERALL GOAL", text: "FINAL ANSWER: Summary." },
      { match: "GOAL:", text: "SATISFIED: All steps completed." },
      { match: "Synthesize", text: "Synthesized." },
    ]);
    const schema = (name: string) => ({
      name, description: "Search",
      parameters: [{ name: "query", type: "string" as const, description: "Query", required: true }],
    });
    const { events } = await collect(
      executePlanExecute({
        taskDescription: "Search and summarize test data",
        taskType: "research",
        memoryContext: "",
        availableTools: ["bad-search", "web-search"],
        availableToolSchemas: [schema("bad-search"), schema("web-search")],
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(Layer.merge(llm, toolLayer))),
    );
    const ps = planSteps(events);
    const failed = ps.filter((p) => p.status === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ pass: "plan-execute:step-1:failed", stepIndex: 0 });
    expect(failed[0]!.note).toContain("upstream 500");
    const patched = ps.filter((p) => p.status === "patched");
    expect(patched).toHaveLength(1);
    expect(patched[0]).toMatchObject({ pass: "plan-execute:step-1:patch", stepIndex: 0 });
    expect(patched[0]!.note).toBe("s2: Search, s3: Summarize");
    expect(ps.some((p) => p.pass === "plan-execute:step-1:done")).toBe(false);
    expect(events.find((e) => e.kernelPass === "plan-execute:step-1:patch")?.thought).toContain("[PATCH] Replaced remaining steps");
  }, 30000);
});

// ── blueprint ───────────────────────────────────────────────────────────────

const bpSchema = (name: string): ToolSchema => ({
  name,
  description: `${name} tool`,
  parameters: [{ name: "query", type: "string", description: "input", required: false }],
});
const bpPlan = (query: string): TestTurn => ({
  json: { steps: [{ title: "search", type: "tool_call", toolName: "web-search", toolArgs: { query }, instruction: "do search" }] },
});
const argSensitiveTools = () =>
  mockToolServiceLayer({
    execute: (req: { toolName: string; arguments?: Record<string, unknown> }) =>
      Effect.succeed(
        Object.values(req.arguments ?? {}).some((v) => typeof v === "string" && v.includes("bad"))
          ? { success: false, result: `tool ${req.toolName} failed: invalid argument` }
          : { success: true, result: `result-of-${req.toolName}` },
      ),
    getTool: (name: string) =>
      Effect.succeed({ name, description: "t", parameters: [{ name: "query", type: "string", required: true }] }),
    register: () => Effect.void,
    listTools: () => Effect.succeed([]),
    deregister: () => Effect.void,
  });
const bpInput = {
  taskDescription: "Find AI news then summarize it",
  taskType: "research",
  memoryContext: "",
  availableTools: ["web-search"],
  availableToolSchemas: [bpSchema("web-search")],
  config: defaultReasoningConfig,
};

describe("blueprint: plan-step payloads", () => {
  it("started per step and patched on execution-error patch; labels unchanged", async () => {
    const llm = TestLLMServiceLayer([bpPlan("bad-args"), bpPlan("good-args")]);
    const { events } = await collect(
      executeBlueprint(bpInput).pipe(Effect.provide(Layer.merge(argSensitiveTools(), llm))),
    );
    const ps = planSteps(events);
    expect(ps.some((p) => p.status === "started" && p.stepIndex === 0 && p.pass === "blueprint:step-1:start")).toBe(true);
    const patched = ps.filter((p) => p.status === "patched");
    expect(patched).toHaveLength(1);
    expect(patched[0]).toMatchObject({ pass: "blueprint:patch", stepIndex: 0 });
    expect(events.find((e) => e.kernelPass === "blueprint:patch")?.thought).toBe(
      "[PATCH] Retrying 1 step(s) after execution error",
    );
  }, 30000);

  it("degrade after a still-failing patch reports a failed plan-step", async () => {
    const llm = TestLLMServiceLayer([bpPlan("bad-1"), bpPlan("bad-2"), { text: "FINAL ANSWER: reactive recovered." }]);
    const { events } = await collect(
      executeBlueprint(bpInput).pipe(Effect.provide(Layer.merge(argSensitiveTools(), llm))),
    );
    const failed = planSteps(events).filter((p) => p.status === "failed" && p.pass === "blueprint:degrade");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.note).toContain("no usable results after patch retry");
    expect(events.find((e) => e.kernelPass === "blueprint:degrade")?.thought).toContain("[DEGRADE]");
  }, 30000);
});
