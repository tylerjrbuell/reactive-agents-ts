// File: tests/strategies/reactive-max-iterations.test.ts
//
// 2026-10-23 introspective harness loop — explicit maxIterations cap fix (A).
//
// Root cause (wiki/Research/Harness-Reports/introspective-2026-10-24-02-*):
// reactive.ts resolved `Math.min(contextProfile.maxIterations, config.strategies
// .reactive.maxIterations)`, but the builder bakes the schema default 10 into
// config unconditionally — so an EXPLICIT `.withReasoning({ maxIterations: 10 /
// 12 / 20 })` was indistinguishable from the default and got silently stolen
// down to the local-tier hint (8). Trace proof: "Approaching maxIterations
// (iter=7, max=8)" on a run configured with maxIterations=10.
//
// Contract pinned here:
//   1. An explicit user cap ALWAYS wins (no min with the tier hint).
//   2. The tier hint still applies when nothing was set explicitly (most-
//      restrictive min semantics — byte-identical to the pre-fix default path).
//   3. An explicit LOWER cap still wins over a higher hint (2026-04-30
//      regression guard, byte-identical).
//   4. Whenever the tier hint clamps the effective cap below the config face
//      value, a visible structured `max_iterations_clamped` signal is emitted
//      through the strategy's emitLog channel (ObservableLogger).

import { describe, it, expect } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { executeReactive, resolveMaxIterationCap } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import { makeObservableLogger, ObservableLogger } from "@reactive-agents/observability";
import type { LogEvent } from "@reactive-agents/observability";

/**
 * Local full-ContextProfile shape with a tier maxIterations HINT.
 * `tier: "local"` keeps the token-delta guard threshold at 300 — the counting
 * mock below grows usage faster than that, so the ONLY thing that can stop the
 * loop early is the resolved iteration cap itself.
 */
const localProfile = (hint: number) => ({
  tier: "local" as const,
  maxIterations: hint,
});

/**
 * Counting LLM that never emits FINAL ANSWER. Usage grows ≥400 tokens per call
 * so `shouldExitOnLowDelta` (needs tokenDelta < tier threshold) never fires —
 * callCount therefore tracks the resolved maxIterations cap.
 */
const makeCountingLayer = () => {
  const state = { callCount: 0 };
  const nextUsage = () => {
    state.callCount++;
    const inputTokens = 100 + state.callCount * 400;
    return {
      content: `Thinking about step ${state.callCount}...`,
      usage: { inputTokens, outputTokens: 50, totalTokens: inputTokens + 50, estimatedCost: 0 },
    };
  };
  return { state, layer: (async () => {
    const { LLMService: LLMSvc } = await import("@reactive-agents/llm-provider");
    type Ev = import("@reactive-agents/llm-provider").StreamEvent;
    const streamFor = (): Stream.Stream<Ev, never> => {
      const r = nextUsage();
      return Stream.make(
        { type: "text_delta" as const, text: r.content },
        { type: "content_complete" as const, content: r.content },
        { type: "usage" as const, usage: r.usage },
      ) as Stream.Stream<Ev, never>;
    };
    return Layer.succeed(LLMSvc, {
      complete: (_req: unknown) => {
        const r = nextUsage();
        return Effect.succeed({
          content: r.content,
          stopReason: "end_turn" as const,
          usage: r.usage,
          model: "test-model",
        });
      },
      stream: (_req: unknown) => Effect.succeed(streamFor()),
      completeStructured: () => Effect.succeed({} as never),
      embed: (texts: string[]) => Effect.succeed(texts.map(() => [])),
      countTokens: () => Effect.succeed(0),
      getModelConfig: () =>
        Effect.succeed({ provider: "anthropic" as const, model: "test-model" }),
      capabilities: () =>
        Effect.succeed({
          supportsToolCalling: false,
          supportsStreaming: true,
          supportsStructuredOutput: false,
          supportsLogprobs: false,
        }),
    } as never);
  })() };
};

/** The clamp signal shape the fix must emit through emitLog (ObservableLogger). */
function findClampEvent(events: readonly LogEvent[]): Extract<LogEvent, { _tag: "log" }> | undefined {
  return events.find(
    (e): e is Extract<LogEvent, { _tag: "log" }> => e._tag === "log" && e.message === "max_iterations_clamped",
  );
}

// ─── Pure resolution pins (A3) ────────────────────────────────────────────────

describe("resolveMaxIterationCap — explicit-cap precedence (2026-10-23 fix)", () => {
  it("explicit cap 10 WINS over a lower tier hint 8 (no steal-down, no clamp)", () => {
    expect(
      resolveMaxIterationCap({ configCap: 10, tierHint: 8, explicit: true }),
    ).toEqual({ maxIterations: 10, clamped: false });
  });

  it("explicit cap 20 WINS over a lower tier hint 8", () => {
    expect(
      resolveMaxIterationCap({ configCap: 20, tierHint: 8, explicit: true }),
    ).toEqual({ maxIterations: 20, clamped: false });
  });

  it("explicit LOWER cap 3 still wins over frontier hint 12 (2026-04-30 regression guard)", () => {
    expect(
      resolveMaxIterationCap({ configCap: 3, tierHint: 12, explicit: true }),
    ).toEqual({ maxIterations: 3, clamped: false });
  });

  it("tier hint applies when cap is NOT explicit (min semantics preserved + clamp signal)", () => {
    expect(
      resolveMaxIterationCap({ configCap: 10, tierHint: 8, explicit: undefined }),
    ).toEqual({ maxIterations: 8, clamped: true });
    expect(
      resolveMaxIterationCap({ configCap: 10, tierHint: 8, explicit: false }),
    ).toEqual({ maxIterations: 8, clamped: true });
  });

  it("profileless path keeps the fallback default 10 (no clamp)", () => {
    expect(
      resolveMaxIterationCap({ configCap: 10, tierHint: undefined, explicit: undefined }),
    ).toEqual({ maxIterations: 10, clamped: false });
    expect(
      resolveMaxIterationCap({ configCap: undefined, tierHint: undefined, explicit: undefined }),
    ).toEqual({ maxIterations: 10, clamped: false });
  });

  it("explicit flag without a usable cap degrades to the hint path (hint wins, clamped)", () => {
    expect(
      resolveMaxIterationCap({ configCap: undefined, tierHint: 8, explicit: true }),
    ).toEqual({ maxIterations: 8, clamped: true });
  });

  it("non-positive sources are ignored (defensive, mirrors pre-filter)", () => {
    expect(resolveMaxIterationCap({ configCap: 0, tierHint: -3, explicit: true })).toEqual({
      maxIterations: 10,
      clamped: false,
    });
  });
});

// ─── Strategy-level integration pins (A3 + A2 visibility) ────────────────────

describe("executeReactive — explicit cap vs tier hint (strategy level)", () => {
  it("explicit 10 is NOT stolen down by hint 3: the loop runs past the hint", async () => {
    const counting = makeCountingLayer();
    const llmLayer = await counting.layer;
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));
    const loggerLayer = Layer.succeed(ObservableLogger, logger);

    await Effect.runPromise(
      provideTestEnvelope(
        executeReactive({
          taskDescription: "Test explicit maxIterations wins over the tier hint",
          taskType: "test",
          memoryContext: "",
          availableTools: ["never-called-tool"],
          // Never-satisfied required tool keeps the loop from exiting early via
          // the end-turn path — see reactive-context-engineering.test.ts precedent.
          requiredTools: ["never-called-tool"],
          config: {
            ...defaultReasoningConfig,
            strategies: {
              ...defaultReasoningConfig.strategies,
              reactive: {
                ...defaultReasoningConfig.strategies.reactive,
                maxIterations: 10,
                maxIterationsExplicit: true,
              },
            },
          },
          contextProfile: localProfile(3),
        }),
      ).pipe(Effect.provide(loggerLayer), Effect.provide(llmLayer)),
    );

    // Pre-fix: min(3, 10) = 3 → callCount stuck at ≤3. Post-fix: explicit 10
    // wins → the loop demonstrably runs past the stolen cap.
    expect(counting.state.callCount).toBeGreaterThan(3);

    // Explicit cap means NO clamp fired.
    const events = await Effect.runPromise(logger.getBuffer());
    expect(findClampEvent(events)).toBeUndefined();
  });

  it("tier hint 3 clamps a non-explicit config 10 AND emits max_iterations_clamped", async () => {
    const counting = makeCountingLayer();
    const llmLayer = await counting.layer;
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));
    const loggerLayer = Layer.succeed(ObservableLogger, logger);

    await Effect.runPromise(
      provideTestEnvelope(
        executeReactive({
          taskDescription: "Test tier hint applies when cap unset",
          taskType: "test",
          memoryContext: "",
          availableTools: ["never-called-tool"],
          requiredTools: ["never-called-tool"],
          config: {
            ...defaultReasoningConfig,
            strategies: {
              ...defaultReasoningConfig.strategies,
              reactive: {
                ...defaultReasoningConfig.strategies.reactive,
                maxIterations: 10,
                // maxIterationsExplicit deliberately absent — schema default.
              },
            },
          },
          contextProfile: localProfile(3),
        }),
      ).pipe(Effect.provide(loggerLayer), Effect.provide(llmLayer)),
    );

    // Hint applied: the loop stops at/before 3 (it cannot reach the config 10).
    expect(counting.state.callCount).toBeLessThanOrEqual(4);

    // A2: the clamp is visible through emitLog with sources + result.
    const events = await Effect.runPromise(logger.getBuffer());
    const clamp = findClampEvent(events);
    expect(clamp).toBeDefined();
    expect(clamp?.fields).toMatchObject({
      configMaxIterations: 10,
      tierHint: 3,
      tier: "local",
      effectiveMaxIterations: 3,
    });
  });

  it("explicit LOWER cap 3 over hint 12 keeps 2026-04-30 behavior (regression guard)", async () => {
    const counting = makeCountingLayer();
    const llmLayer = await counting.layer;
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));
    const loggerLayer = Layer.succeed(ObservableLogger, logger);

    await Effect.runPromise(
      provideTestEnvelope(
        executeReactive({
          taskDescription: "Test explicit lower cap honored over high hint",
          taskType: "test",
          memoryContext: "",
          availableTools: ["never-called-tool"],
          requiredTools: ["never-called-tool"],
          config: {
            ...defaultReasoningConfig,
            strategies: {
              ...defaultReasoningConfig.strategies,
              reactive: {
                ...defaultReasoningConfig.strategies.reactive,
                maxIterations: 3,
                maxIterationsExplicit: true,
              },
            },
          },
          // Frontier tier hint 12 — never clamps downward, and the explicit 3
          // wins. Frontier tokenDelta threshold (1000) may early-exit around
          // iteration 3; that is cap-equivalent for this guard.
          contextProfile: { tier: "frontier" as const, maxIterations: 12 },
        }),
      ).pipe(Effect.provide(loggerLayer), Effect.provide(llmLayer)),
    );

    expect(counting.state.callCount).toBeLessThanOrEqual(4);
    const events = await Effect.runPromise(logger.getBuffer());
    expect(findClampEvent(events)).toBeUndefined();
  });
});
