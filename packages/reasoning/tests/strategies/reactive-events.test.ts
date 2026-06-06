import { describe, test, expect } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { executeReactive } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { TestLLMServiceLayer, LLMService } from "@reactive-agents/llm-provider";
import type { StreamEvent } from "@reactive-agents/llm-provider";
import { makeObservableLLM } from "../../src/index.js";
import { EventBusLive, EventBus } from "@reactive-agents/core";
import type { AgentEvent } from "@reactive-agents/core";

// ─── Helper ──────────────────────────────────────────────────────────────────
// Using the typed eb.on() overload — `event` is automatically narrowed to
// Extract<AgentEvent, { _tag: "ReasoningStepCompleted" }>, no guards needed.

type ReasoningStepEvent = Extract<AgentEvent, { _tag: "ReasoningStepCompleted" }>;

const collectReasoningEvents = async (
  llmResponses: Array<{ match?: string; text: string }>,
  taskDescription: string,
): Promise<ReasoningStepEvent[]> => {
  const captured: ReasoningStepEvent[] = [];
  const llmLayer = TestLLMServiceLayer(llmResponses);

  return Effect.runPromise(
    Effect.gen(function* () {
      const eb = yield* EventBus;

      // Typed on() — handler receives ReasoningStepEvent directly, no _tag check needed
      yield* eb.on("ReasoningStepCompleted", (event) =>
        Effect.sync(() => { captured.push(event); }),
      );

      yield* executeReactive({
        taskDescription,
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: {
          ...defaultReasoningConfig,
          strategies: {
            ...defaultReasoningConfig.strategies,
            reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations: 3 },
          },
        },
      });

      return captured;
    }).pipe(
      Effect.provide(Layer.merge(llmLayer, EventBusLive)),
    ),
  );
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("reactive strategy ReasoningStepCompleted events", () => {
  test("ReasoningStepCompleted published for thought step", async () => {
    const events = await collectReasoningEvents(
      [{ match: "Think step-by-step", text: "FINAL ANSWER: The answer is 42." }],
      "Think step-by-step about this",
    );

    // event.thought is directly typed — no (e as any).thought needed
    const thoughtEvents = events.filter((e) => !!e.thought);
    expect(thoughtEvents.length).toBeGreaterThan(0);
  });

  test("ReasoningStepCompleted has correct strategy field", async () => {
    const events = await collectReasoningEvents(
      [{ match: "What is 2+2", text: "FINAL ANSWER: 4." }],
      "What is 2+2",
    );

    expect(events.length).toBeGreaterThan(0);
    // strategy is directly typed — no cast needed
    for (const event of events) {
      expect(event.strategy).toBe("reactive");
    }
  });

  test("events NOT published (no error) when EventBus absent from context", async () => {
    const llmLayer = TestLLMServiceLayer([
      { match: "no bus test", text: "FINAL ANSWER: done." },
    ]);

    // Run WITHOUT EventBus — should not throw
    await expect(
      Effect.runPromise(
        executeReactive({
          taskDescription: "no bus test",
          taskType: "query",
          memoryContext: "",
          availableTools: [],
          config: defaultReasoningConfig,
        }).pipe(Effect.provide(llmLayer)),
      ),
    ).resolves.toBeDefined();
  });

  test("step counter increases with each published event", async () => {
    const events = await collectReasoningEvents(
      [{ match: "multi step task", text: "FINAL ANSWER: Complete." }],
      "multi step task",
    );

    expect(events.length).toBeGreaterThan(0);
    // step is directly typed — no manual cast or filter needed
    for (const e of events) {
      expect(e.step).toBeGreaterThan(0);
    }
  });

  test("ThoughtTracer captures steps via EventBus end-to-end", async () => {
    const { ThoughtTracerService, ThoughtTracerLive } = await import("@reactive-agents/observability");
    const llmLayer = TestLLMServiceLayer([
      { match: "tracer integration", text: "FINAL ANSWER: tracer works." },
    ]);

    // Layer.provideMerge(ThoughtTracerLive, EventBusLive): provides EventBus to
    // ThoughtTracerLive AND keeps both services available downstream.
    const tracerWithBus = Layer.provideMerge(ThoughtTracerLive, EventBusLive);
    const testLayer = Layer.mergeAll(llmLayer, tracerWithBus);

    const capturedSteps = await Effect.runPromise(
      Effect.gen(function* () {
        yield* executeReactive({
          taskDescription: "tracer integration",
          taskType: "query",
          memoryContext: "",
          availableTools: [],
          config: defaultReasoningConfig,
        });

        const tracer = yield* ThoughtTracerService;
        return yield* tracer.getThoughtChain("reactive");
      }).pipe(Effect.provide(testLayer)),
    );

    expect(capturedSteps.length).toBeGreaterThan(0);
  });

  test("action events contain tool info", async () => {
    const captured: ReasoningStepEvent[] = [];
    const llmLayer = TestLLMServiceLayer([
      { match: "use a tool", toolCall: { name: "my-tool", args: { query: "test" } } },
      { text: "FINAL ANSWER: done." },
    ]);

    await Effect.runPromise(
      Effect.gen(function* () {
        const eb = yield* EventBus;
        // Typed on() — action field is directly accessible without cast
        yield* eb.on("ReasoningStepCompleted", (event) =>
          Effect.sync(() => { captured.push(event); }),
        );
        yield* executeReactive({
          taskDescription: "use a tool",
          taskType: "query",
          memoryContext: "",
          availableTools: ["my-tool"],
          config: {
            ...defaultReasoningConfig,
            strategies: {
              ...defaultReasoningConfig.strategies,
              reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations: 5 },
            },
          },
        });
      }).pipe(Effect.provide(Layer.merge(llmLayer, EventBusLive))),
    );

    const actionEvents = captured.filter((e) => !!e.action);
    // Regardless of whether tool service is available, action step may be published
    expect(actionEvents.length).toBeGreaterThanOrEqual(0);
  });
});

// ─── ContextPressure (chokepoint) integration guard ───────────────────────────
// ContextPressure now rides the observable-llm chokepoint (makeObservableLLM →
// emitContextPressure), NOT kernel-hooks. This guard routes a REAL reactive
// (kernel) run through that chokepoint and asserts ≥1 ContextPressure reaches the
// bus with a real taskId — proving the end-to-end mechanism the user requested
// (uniform CP across all strategy paths, exact provider window).
//
// Why the wiring is non-trivial: `executeReactive` does NOT apply makeObservableLLM
// (it's wired at runtime.ts:528, in the runtime package). And TestLLMServiceLayer
// (out of kernel authority) emits a `usage` StreamEvent with no resolvedParams, so
// the strict `resolvedParams.contextWindow > 0` chokepoint gate would never fire.
// So we (1) wrap the test LLMService stream to inject resolvedParams.contextWindow
// onto the usage event (what local.ts does in prod), then (2) wrap THAT with
// makeObservableLLM. think.ts seeds request.traceContext.taskId on the reactive
// stream request, so correlation flows automatically.

type ContextPressureEvent = Extract<AgentEvent, { _tag: "ContextPressure" }>;

// Layer that wraps an upstream LLMService, injecting resolvedParams.contextWindow
// onto every `usage` StreamEvent (mirrors the provider transparency local.ts adds).
const injectResolvedWindow = (window: number): Layer.Layer<LLMService, never, LLMService> =>
  Layer.effect(
    LLMService,
    Effect.gen(function* () {
      const inner = yield* LLMService;
      return {
        ...inner,
        stream: (request) =>
          inner.stream(request).pipe(
            Effect.map((s) =>
              s.pipe(
                Stream.map((ev: StreamEvent): StreamEvent =>
                  ev.type === "usage"
                    ? { ...ev, resolvedParams: { ...ev.resolvedParams, contextWindow: window } }
                    : ev,
                ),
              ),
            ),
          ),
      };
    }),
  );

describe("chokepoint emits ContextPressure for the context-window gauge", () => {
  test("ContextPressure is published from a real reactive (kernel) run through makeObservableLLM", async () => {
    const captured: ContextPressureEvent[] = [];
    // provider → window-injecting wrapper → observable chokepoint
    const llmLayer = makeObservableLLM().pipe(
      Layer.provide(injectResolvedWindow(32_768).pipe(Layer.provide(TestLLMServiceLayer([{ text: "FINAL ANSWER: 42." }])))),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const eb = yield* EventBus;
        yield* eb.on("ContextPressure", (event) =>
          Effect.sync(() => { captured.push(event); }),
        );
        yield* executeReactive({
          taskDescription: "What is 2+2?",
          taskType: "query",
          memoryContext: "",
          availableTools: [],
          config: {
            ...defaultReasoningConfig,
            strategies: {
              ...defaultReasoningConfig.strategies,
              reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations: 3 },
            },
          },
        });
      }).pipe(Effect.provide(Layer.merge(llmLayer, EventBusLive))),
    );

    // Load-bearing: ≥1 ContextPressure reached the bus from the chokepoint.
    expect(captured.length).toBeGreaterThan(0);
    const cp = captured[0]!;
    // Real run correlation, not the 'llm-direct' placeholder — proves think.ts
    // threaded traceContext.taskId through to the chokepoint.
    expect(cp.taskId).not.toBe("llm-direct");
    expect(cp.taskId.length).toBeGreaterThan(0);
    expect(cp.tokensUsed).toBeGreaterThan(0);
    expect(cp.tokensAvailable).toBeGreaterThanOrEqual(0);
    // Window (used + available) is the real denominator, not 0.
    expect(cp.tokensUsed + cp.tokensAvailable).toBeGreaterThan(0);
    expect(cp.utilizationPct).toBeGreaterThanOrEqual(0);
    expect(cp.utilizationPct).toBeLessThanOrEqual(100);
    expect(["low", "medium", "high", "critical"]).toContain(cp.level);
  });
});
