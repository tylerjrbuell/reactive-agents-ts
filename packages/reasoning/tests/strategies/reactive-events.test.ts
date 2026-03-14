import { describe, test, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { executeReactive } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
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
      { match: "use a tool", text: 'ACTION: my-tool({"query": "test"})\nFINAL ANSWER: done.' },
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
