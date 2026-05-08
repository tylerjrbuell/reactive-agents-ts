/**
 * Unit tests for the extracted tool-classifier setup helper.
 *
 * Three decision branches:
 *   1. wantsClassification === false → returns config defaults unchanged
 *      (no LLM call, no work)
 *   2. wantsClassification === true && reliability === "low" → literal-mention
 *      fallback (deterministic, no LLM)
 *   3. wantsClassification === true && reliability is reliable → LLM classify
 *      (covered by integration tests; this test file focuses on the
 *      deterministic branches)
 *
 * Authored 2026-05-07 (W23 step 4b).
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Context } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { classifyTools } from "../src/engine/phases/agent-loop/setup/classifier.js";
import type { ReactiveAgentsConfig } from "../src/types.js";
import type { ModelCalibration } from "@reactive-agents/llm-provider";
import type { Task } from "@reactive-agents/core";

// ─── Fixture builders ───

const makeTask = (input: unknown): Task =>
  ({
    id: "t-classify",
    agentId: "agent-classify",
    type: "query",
    input,
    priority: "medium",
    status: "pending",
    metadata: { tags: [] },
    createdAt: new Date(),
  }) as unknown as Task;

const makeConfig = (overrides: Partial<ReactiveAgentsConfig> = {}): ReactiveAgentsConfig =>
  ({
    agentId: "agent-classify",
    enableGuardrails: false,
    ...overrides,
  }) as unknown as ReactiveAgentsConfig;

// LLMService stub that fails if invoked — verifies "no LLM call" branches
const FailIfInvokedLLMLayer = Layer.succeed(
  LLMService,
  {
    complete: () => Effect.die(new Error("LLM should not be invoked on this branch")),
    stream: () => Effect.die(new Error("LLM should not be invoked on this branch")),
  } as any,
);

// ─── Tests ───

describe("classifyTools (W23 setup helper)", () => {
  it("returns config defaults when classification is not requested", async () => {
    const config = makeConfig({ adaptiveToolFiltering: false });
    const result = await Effect.runPromise(
      classifyTools({
        config,
        task: makeTask("compute 2+2"),
        cachedToolDefs: [{ name: "calculator" }, { name: "search" }],
        resolvedCalibration: { classifierReliability: "high" } as unknown as ModelCalibration,
        obs: null,
        isNormal: false,
      }).pipe(Effect.provide(FailIfInvokedLLMLayer)) as Effect.Effect<any, never, never>,
    );

    expect(result.effectiveRequiredTools).toBeUndefined();
    expect(result.effectiveRequiredToolQuantities).toBeUndefined();
    expect(result.classifiedRelevantTools).toBeUndefined();
  });

  it("preserves caller-supplied requiredTools.tools (no override)", async () => {
    const config = makeConfig({
      adaptiveToolFiltering: false,
      requiredTools: { tools: ["search", "summarize"], adaptive: false } as any,
    });
    const result = await Effect.runPromise(
      classifyTools({
        config,
        task: makeTask("research a topic"),
        cachedToolDefs: [{ name: "search" }, { name: "summarize" }],
        resolvedCalibration: undefined,
        obs: null,
        isNormal: false,
      }).pipe(Effect.provide(FailIfInvokedLLMLayer)) as Effect.Effect<any, never, never>,
    );

    expect(result.effectiveRequiredTools).toEqual(["search", "summarize"]);
  });

  it("falls back to literal mentions when reliability is 'low' and classification is wanted", async () => {
    const config = makeConfig({
      adaptiveToolFiltering: true,
      requiredTools: { tools: undefined, adaptive: true } as any,
    });
    const result = await Effect.runPromise(
      classifyTools({
        config,
        task: makeTask("Use the calculator to add 5 and 7"),
        cachedToolDefs: [{ name: "calculator" }, { name: "search" }, { name: "weather" }],
        resolvedCalibration: { classifierReliability: "low" } as unknown as ModelCalibration,
        obs: null,
        isNormal: false,
      }).pipe(Effect.provide(FailIfInvokedLLMLayer)) as Effect.Effect<any, never, never>,
    );

    // Literal-mention fallback picked up "calculator" from the task text
    expect(result.effectiveRequiredTools).toEqual(["calculator"]);
    // No quantities/relevant set when using literal-mention fallback
    expect(result.effectiveRequiredToolQuantities).toBeUndefined();
    expect(result.classifiedRelevantTools).toBeUndefined();
  });

  it("returns empty defaults when reliability is 'low' and no tool names are mentioned literally", async () => {
    const config = makeConfig({
      adaptiveToolFiltering: true,
      requiredTools: { tools: undefined, adaptive: true } as any,
    });
    const result = await Effect.runPromise(
      classifyTools({
        config,
        task: makeTask("hello world"),
        cachedToolDefs: [{ name: "calculator" }, { name: "search" }],
        resolvedCalibration: { classifierReliability: "low" } as unknown as ModelCalibration,
        obs: null,
        isNormal: false,
      }).pipe(Effect.provide(FailIfInvokedLLMLayer)) as Effect.Effect<any, never, never>,
    );

    // No literal mentions, no override
    expect(result.effectiveRequiredTools).toBeUndefined();
  });

  it("skips classification entirely when reliability is 'skip'", async () => {
    const config = makeConfig({
      adaptiveToolFiltering: true,
      requiredTools: { tools: undefined, adaptive: true } as any,
    });
    const result = await Effect.runPromise(
      classifyTools({
        config,
        task: makeTask("any task"),
        cachedToolDefs: [{ name: "calculator" }],
        resolvedCalibration: { classifierReliability: "skip" } as unknown as ModelCalibration,
        obs: null,
        isNormal: false,
      }).pipe(Effect.provide(FailIfInvokedLLMLayer)) as Effect.Effect<any, never, never>,
    );

    expect(result.effectiveRequiredTools).toBeUndefined();
    expect(result.classifiedRelevantTools).toBeUndefined();
  });
});
