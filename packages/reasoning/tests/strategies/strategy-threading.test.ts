import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref, Stream } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import type { StreamEvent } from "@reactive-agents/llm-provider";
import { EventBus, HarnessPipeline, RegistrationHarness } from "@reactive-agents/core";
import type { AgentEvent } from "@reactive-agents/core";
import { executeReflexion } from "../../src/strategies/reflexion.js";
import { executePlanExecute } from "../../src/strategies/plan-execute.js";
import { executeTreeOfThought } from "../../src/strategies/tree-of-thought.js";
import { executeReactive } from "../../src/strategies/reactive.js";
import { executeAdaptive } from "../../src/strategies/adaptive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";

/** Build a proper Stream stub from a response string */
function makeStreamResponse(content: string): Stream.Stream<StreamEvent, never> {
  return Stream.make(
    { type: "text_delta" as const, text: content },
    { type: "content_complete" as const, content },
    { type: "usage" as const, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 } },
  ) as Stream.Stream<StreamEvent, never>;
}

const mockLLM = Layer.succeed(LLMService, {
  complete: () =>
    Effect.succeed({
      content: "FINAL ANSWER: test result",
      usage: { totalTokens: 10, estimatedCost: 0 },
      model: "test",
    }),
  stream: () =>
    Effect.succeed(makeStreamResponse("FINAL ANSWER: test result")),
  embed: () => Effect.succeed([]),
  getModelInfo: () =>
    Effect.succeed({ contextWindow: 8000, id: "test", provider: "test" }),
} as any);

/**
 * Reflexion needs a mock that returns SATISFIED for critique prompts.
 * The critique prompt contains "Evaluate whether".
 */
const makeReflexionLLM = () => TestLLMServiceLayer([
  { match: "Evaluate whether", text: "SATISFIED: The response is accurate and complete." },
]);

const baseInput = {
  taskDescription: "Say hello",
  taskType: "simple",
  memoryContext: "",
  availableTools: [] as string[],
  config: defaultReasoningConfig,
};

/**
 * Plan-execute now requires structured JSON output from plan generation.
 * Build a TestLLMServiceLayer that returns valid JSON for extractStructuredOutput
 * and text for reflection/synthesis.
 */
const makePlanExecuteLLM = () => TestLLMServiceLayer([
  { match: "planning agent", text: JSON.stringify({
    // Two steps: a single analysis-step plan now takes the streamline
    // short-circuit (no per-step kernel execution), so threading/kernelPass
    // tests need a multi-step plan to exercise the step-execution path.
    steps: [
      { title: "Do the task", instruction: "Complete the task", type: "analysis" },
      { title: "Refine the result", instruction: "Refine the completed task", type: "analysis" },
    ],
  }) },
  { match: "OVERALL GOAL", text: "FINAL ANSWER: test result" },
  { match: "GOAL:", text: "SATISFIED: Done." },
  { match: "Synthesize", text: "Final synthesized answer." },
]);

/**
 * FM-I (#195) regression: a registered `before('think')` phase hook MUST fire
 * during the strategy's kernel pass — proving `harnessPipeline` threads from
 * the strategy input through to the kernel. Before the canonical-input fix,
 * heavy strategies dropped `harnessPipeline` and these hooks were silently dead
 * (Compose, killswitches, and calibration all no-op). `before('think')` fires
 * every kernel iteration with no tool call required, so the signal is
 * deterministic under the simple mock LLM.
 */
const makeFiresPipeline = () => {
  let fired = 0;
  const rh = new RegistrationHarness();
  rh.before("think", () => {
    fired += 1;
  });
  return { pipeline: new HarnessPipeline(rh._collected), fired: () => fired };
};

describe("FM-I (#195) — harnessPipeline threads to the kernel in every strategy", () => {
  it("reflexion fires before('think') hooks", async () => {
    const h = makeFiresPipeline();
    await Effect.runPromise(
      executeReflexion({ ...baseInput, harnessPipeline: h.pipeline }).pipe(
        Effect.provide(makeReflexionLLM()),
      ),
    );
    expect(h.fired()).toBeGreaterThan(0);
  });

  it("tree-of-thought fires before('think') hooks", async () => {
    const h = makeFiresPipeline();
    await Effect.runPromise(
      executeTreeOfThought({ ...baseInput, harnessPipeline: h.pipeline }).pipe(
        Effect.provide(mockLLM),
      ),
    );
    expect(h.fired()).toBeGreaterThan(0);
  });

  it("adaptive forwards harnessPipeline to the dispatched sub-strategy", async () => {
    const h = makeFiresPipeline();
    await Effect.runPromise(
      executeAdaptive({ ...baseInput, harnessPipeline: h.pipeline }).pipe(
        Effect.provide(makeReflexionLLM()),
      ),
    );
    expect(h.fired()).toBeGreaterThan(0);
  });
});

describe("Strategy threading", () => {
  it("reflexion accepts resultCompression", async () => {
    const result = await Effect.runPromise(
      executeReflexion({
        ...baseInput,
        resultCompression: { budget: 400, previewItems: 2 },
      }).pipe(Effect.provide(makeReflexionLLM())),
    );
    expect(result.status).toBe("completed");
  });

  it("plan-execute accepts resultCompression", async () => {
    const result = await Effect.runPromise(
      executePlanExecute({
        ...baseInput,
        resultCompression: { budget: 400, previewItems: 2 },
      }).pipe(Effect.provide(makePlanExecuteLLM())),
    );
    expect(result.status).toBe("completed");
  });

  it("tree-of-thought accepts resultCompression", async () => {
    const result = await Effect.runPromise(
      executeTreeOfThought({
        ...baseInput,
        resultCompression: { budget: 400, previewItems: 2 },
      }).pipe(Effect.provide(mockLLM)),
    );
    expect(result.status).toBe("completed");
  });

  it("reflexion respects kernelMaxIterations config", async () => {
    const config = {
      ...defaultReasoningConfig,
      strategies: {
        ...defaultReasoningConfig.strategies,
        reflexion: {
          ...defaultReasoningConfig.strategies.reflexion,
          kernelMaxIterations: 5,
        },
      },
    };
    const result = await Effect.runPromise(
      executeReflexion({ ...baseInput, config }).pipe(Effect.provide(makeReflexionLLM())),
    );
    expect(result.status).toBe("completed");
  });

  it("reflexion accepts agentId and sessionId", async () => {
    const result = await Effect.runPromise(
      executeReflexion({
        ...baseInput,
        agentId: "test-agent-123",
        sessionId: "test-session-456",
      }).pipe(Effect.provide(makeReflexionLLM())),
    );
    expect(result.status).toBe("completed");
  });

  it("plan-execute accepts agentId and sessionId", async () => {
    const result = await Effect.runPromise(
      executePlanExecute({
        ...baseInput,
        agentId: "test-agent-123",
        sessionId: "test-session-456",
      }).pipe(Effect.provide(makePlanExecuteLLM())),
    );
    expect(result.status).toBe("completed");
  });

  it("tree-of-thought accepts agentId and sessionId", async () => {
    const result = await Effect.runPromise(
      executeTreeOfThought({
        ...baseInput,
        agentId: "test-agent-123",
        sessionId: "test-session-456",
      }).pipe(Effect.provide(mockLLM)),
    );
    expect(result.status).toBe("completed");
  });

  it("reflexion seeds previousCritiques from priorCritiques input", async () => {
    const result = await Effect.runPromise(
      executeReflexion({
        ...baseInput,
        priorCritiques: ["Previous run found the answer lacked error handling"],
      }).pipe(Effect.provide(makeReflexionLLM())),
    );
    expect(result.status).toBe("completed");
    // Critiques should be stored in result metadata for downstream persistence
    expect(result.metadata.reflexionCritiques).toBeDefined();
    expect(Array.isArray(result.metadata.reflexionCritiques)).toBe(true);
  });

  it("reflexion without priorCritiques still works (backward compat)", async () => {
    const result = await Effect.runPromise(
      executeReflexion({
        ...baseInput,
      }).pipe(Effect.provide(makeReflexionLLM())),
    );
    expect(result.status).toBe("completed");
    expect(Array.isArray(result.metadata.reflexionCritiques)).toBe(true);
  });

  // ── GH #127 — harnessPipeline threading on outer-loop strategies ─────────
  // The kernel-path (reactive) wires harnessPipeline into the RI
  // dispatchContext via `reactive-observer.ts:306` (HS-112). plan-execute
  // and tree-of-thought build their OWN dispatchContexts in their outer
  // refinement / BFS loops; without the field threaded, applied RI
  // decisions inside these strategies cannot bridge to Compose tags. These
  // smoke tests pin the input acceptance + runtime no-throw. Behavioral
  // bridge coverage lives in `dispatcher-compose-bridge.test.ts` (HS-112).
  it("plan-execute accepts harnessPipeline input (GH #127)", async () => {
    const result = await Effect.runPromise(
      executePlanExecute({
        ...baseInput,
        // Real (empty) pipeline. A prior stub `{ transform }` only survived
        // because the strategy DROPPED harnessPipeline (FM-I #195) — once the
        // field reaches the kernel, runPhaseHooks calls collectPhaseHooks(),
        // which a stub lacks.
        harnessPipeline: new HarnessPipeline(),
      }).pipe(Effect.provide(makePlanExecuteLLM())),
    );
    expect(result.status).toBe("completed");
  });

  it("tree-of-thought accepts harnessPipeline input (GH #127)", async () => {
    const result = await Effect.runPromise(
      executeTreeOfThought({
        ...baseInput,
        harnessPipeline: new HarnessPipeline(),
      }).pipe(Effect.provide(mockLLM)),
    );
    expect(result.status).toBe("completed");
  });

  it("plan-execute respects stepKernelMaxIterations config", async () => {
    const config = {
      ...defaultReasoningConfig,
      strategies: {
        ...defaultReasoningConfig.strategies,
        planExecute: {
          ...defaultReasoningConfig.strategies.planExecute,
          stepKernelMaxIterations: 4,
        },
      },
    };
    const result = await Effect.runPromise(
      executePlanExecute({ ...baseInput, config }).pipe(Effect.provide(makePlanExecuteLLM())),
    );
    expect(result.status).toBe("completed");
  });
});

// ── Helper: create a capturing EventBus layer ──────────────────────────────

function makeCapturingEventBus() {
  const captured: AgentEvent[] = [];
  const layer = Layer.effect(
    EventBus,
    Effect.gen(function* () {
      const handlers = yield* Ref.make<((e: AgentEvent) => Effect.Effect<void, never>)[]>([]);
      return {
        publish: (event: AgentEvent) =>
          Effect.gen(function* () {
            captured.push(event);
            const hs = yield* Ref.get(handlers);
            yield* Effect.all(hs.map((h) => h(event)), { concurrency: "unbounded" });
          }),
        subscribe: (handler: (e: AgentEvent) => Effect.Effect<void, never>) =>
          Effect.gen(function* () {
            yield* Ref.update(handlers, (hs) => [...hs, handler]);
            return () => {
              Effect.runSync(Ref.update(handlers, (hs) => hs.filter((h) => h !== handler)));
            };
          }),
        on: (_tag: string, handler: (e: AgentEvent) => Effect.Effect<void, never>) =>
          Effect.gen(function* () {
            const filtered = (event: AgentEvent) =>
              event._tag === _tag ? handler(event as any) : Effect.void;
            yield* Ref.update(handlers, (hs) => [...hs, filtered]);
            return () => {
              Effect.runSync(Ref.update(handlers, (hs) => hs.filter((h) => h !== filtered)));
            };
          }),
      };
    }),
  );
  return { captured, layer };
}

describe("Kernel pass attribution", () => {
  it("reflexion events carry kernelPass labels", async () => {
    const { captured, layer: ebLayer } = makeCapturingEventBus();
    const result = await Effect.runPromise(
      executeReflexion({
        ...baseInput,
      }).pipe(Effect.provide(Layer.merge(makeReflexionLLM(), ebLayer))),
    );
    expect(result.status).toBe("completed");

    // Should have ReasoningStepCompleted events with kernelPass set
    const reasoningEvents = captured.filter(
      (e) => e._tag === "ReasoningStepCompleted",
    ) as Extract<AgentEvent, { _tag: "ReasoningStepCompleted" }>[];
    expect(reasoningEvents.length).toBeGreaterThan(0);

    // First generation event should carry "reflexion:generate"
    const genEvents = reasoningEvents.filter(
      (e) => (e as any).kernelPass === "reflexion:generate",
    );
    expect(genEvents.length).toBeGreaterThan(0);
  });

  it("plan-execute events carry kernelPass labels for each step", async () => {
    const { captured, layer: ebLayer } = makeCapturingEventBus();
    const result = await Effect.runPromise(
      executePlanExecute({
        ...baseInput,
      }).pipe(Effect.provide(Layer.merge(makePlanExecuteLLM(), ebLayer))),
    );
    expect(result.status).toBe("completed");

    const reasoningEvents = captured.filter(
      (e) => e._tag === "ReasoningStepCompleted",
    ) as Extract<AgentEvent, { _tag: "ReasoningStepCompleted" }>[];
    expect(reasoningEvents.length).toBeGreaterThan(0);

    // Should have plan-execute:plan-1 for the planning phase
    const planEvents = reasoningEvents.filter(
      (e) => (e as any).kernelPass === "plan-execute:plan-1",
    );
    expect(planEvents.length).toBeGreaterThan(0);

    // Should have plan-execute:step-1 for step execution
    const stepEvents = reasoningEvents.filter(
      (e) => (e as any).kernelPass?.startsWith("plan-execute:step-"),
    );
    expect(stepEvents.length).toBeGreaterThan(0);
  });

  it("tree-of-thought events carry kernelPass labels for explore and execute", async () => {
    const { captured, layer: ebLayer } = makeCapturingEventBus();
    const result = await Effect.runPromise(
      executeTreeOfThought({
        ...baseInput,
        // HS-110 gate would skip BFS for the "Say hello" trivial task; disable
        // so this test exercises explore + execute kernelPass labels.
        config: {
          ...baseInput.config,
          strategies: {
            ...baseInput.config.strategies,
            treeOfThought: { ...baseInput.config.strategies.treeOfThought, skipBfsForTrivial: false },
          },
        },
      }).pipe(Effect.provide(Layer.merge(mockLLM, ebLayer))),
    );
    expect(result.status).toBe("completed");

    const reasoningEvents = captured.filter(
      (e) => e._tag === "ReasoningStepCompleted",
    ) as Extract<AgentEvent, { _tag: "ReasoningStepCompleted" }>[];
    expect(reasoningEvents.length).toBeGreaterThan(0);

    // Should have explore-phase events
    const exploreEvents = reasoningEvents.filter(
      (e) => (e as any).kernelPass === "tree-of-thought:explore",
    );
    expect(exploreEvents.length).toBeGreaterThan(0);
  });

  it("reactive events carry kernelPass: reactive:main", async () => {
    const { captured, layer: ebLayer } = makeCapturingEventBus();

    // Use a mock LLM that returns a final answer on first call
    const reactiveLLM = Layer.succeed(LLMService, {
      complete: () =>
        Effect.succeed({
          content: "FINAL ANSWER: hello world",
          usage: { totalTokens: 10, estimatedCost: 0 },
          model: "test",
        }),
      stream: () =>
        Effect.succeed(makeStreamResponse("FINAL ANSWER: hello world")),
      embed: () => Effect.succeed([]),
      getModelInfo: () =>
        Effect.succeed({ contextWindow: 8000, id: "test", provider: "test" }),
    } as any);

    const result = await Effect.runPromise(
      executeReactive({
        ...baseInput,
      }).pipe(Effect.provide(Layer.merge(reactiveLLM, ebLayer))),
    );
    expect(result.status).toBe("completed");

    const reasoningEvents = captured.filter(
      (e) => e._tag === "ReasoningStepCompleted",
    ) as Extract<AgentEvent, { _tag: "ReasoningStepCompleted" }>[];
    expect(reasoningEvents.length).toBeGreaterThan(0);

    // All events should carry "reactive:main"
    for (const event of reasoningEvents) {
      expect((event as any).kernelPass).toBe("reactive:main");
    }

    // FinalAnswerProduced should also carry kernelPass
    const finalEvents = captured.filter(
      (e) => e._tag === "FinalAnswerProduced",
    ) as Extract<AgentEvent, { _tag: "FinalAnswerProduced" }>[];
    expect(finalEvents.length).toBeGreaterThan(0);
    for (const event of finalEvents) {
      expect((event as any).kernelPass).toBe("reactive:main");
    }
  });
});
