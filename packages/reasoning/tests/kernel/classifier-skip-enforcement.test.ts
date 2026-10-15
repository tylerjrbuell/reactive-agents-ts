// Run: bun test packages/reasoning/tests/kernel/classifier-skip-enforcement.test.ts --timeout 15000
/**
 * W2d 2.6 — classifier-skip honesty, ENFORCED (plan 2.6).
 *
 * The calibration field `classifierReliability:"low"` is documented (AGENTS.md:
 * "When classifier reliability is 'low', the LLM classifier call is skipped
 * entirely (saves a round-trip)"). The runtime tool-relevance classifier
 * honors it — but the live post-w1 S1 traces proved the per-run classify
 * round-trip that actually fires on local arms is the REASONING-side strategy
 * evaluator (evaluateStrategySwitch, called from iterate-pass on loop/stall
 * detection), and it never consulted reliability at all: a silent
 * extra-LLM-call-per-run class the program exists to eliminate.
 *
 * Pins:
 *  - low / skip reliability → NO LLM round-trip, deterministic
 *    shouldSwitch:false verdict carrying a classifier-skip reasoning string,
 *    observable via a harness-signal event (rax-diagnose-visible).
 *  - trusted reliability (or absent) → LLM consulted exactly as before
 *    (no behavior change for reliable models).
 *  - behavioral pin (W4.0 re-pin): a real kernel run whose loop detector
 *    fires at the iterate-pass strategy-switch site, with
 *    `calibration.classifierReliability:"low"` on the input, emits the
 *    `strategy-switch/classifier-skip` harness-signal — and does NOT when the
 *    calibration is absent. This observes the SITE's threading behaviorally
 *    instead of by grepping iterate-pass.ts source text (which a refactor
 *    would break without any behavior change).
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { LLMService, TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import type {
  CompletionRequest,
  CompletionResponse,
  ModelCalibration,
  StructuredCompletionRequest,
} from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { evaluateStrategySwitch } from "../../src/kernel/capabilities/reflect/strategy-evaluator.js";
import { runKernel } from "../../src/kernel/loop/runner.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import {
  transitionState,
  type KernelState,
  type ThoughtKernel,
} from "../../src/kernel/state/kernel-state.js";

function makeState(): KernelState {
  return {
    taskId: "skip-test",
    strategy: "reactive",
    kernelType: "react",
    steps: [],
    toolsUsed: new Set<string>(),
    scratchpad: new Map<string, string>(),
    iteration: 2,
    tokens: 100,
    cost: 0,
    status: "thinking",
    output: null,
    error: null,
    llmCalls: 1,
    meta: { maxIterations: 10 },
    controllerDecisionLog: [],
    messages: [],
  };
}

/** Mock LLMService counting complete() round-trips; answers shouldSwitch:true. */
function makeCountingLayer(sink: Ref.Ref<number[]>): Layer.Layer<LLMService> {
  return Layer.succeed(
    LLMService,
    LLMService.of({
      complete: (_request: CompletionRequest) =>
        Ref.update(sink, (xs) => [...xs, 1]).pipe(
          Effect.as(
            {
              content:
                '{"shouldSwitch": true, "recommendedStrategy": "plan-execute-reflect", "reasoning": "classifier said switch"}',
              stopReason: "end_turn",
              usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15, estimatedCost: 0 },
              model: "test",
            } satisfies CompletionResponse,
          ),
        ),
      stream: () => Effect.die("unused in classifier-skip test"),
      completeStructured: <A>(_request: StructuredCompletionRequest<A>) =>
        Effect.die("unused in classifier-skip test"),
      embed: (texts: readonly string[]) => Effect.succeed(texts.map(() => [0])),
      countTokens: (messages: readonly unknown[]) => Effect.succeed(messages.length),
      getModelConfig: () => Effect.succeed({ provider: "ollama", model: "test" }),
      getStructuredOutputCapabilities: () =>
        Effect.succeed({
          nativeJsonMode: false,
          jsonSchemaEnforcement: false,
          prefillSupport: false,
          grammarConstraints: false,
        }),
      capabilities: () =>
        Effect.succeed({
          supportsToolCalling: false,
          supportsStreaming: false,
          supportsSystemPrompt: true,
          supportsLogprobs: false,
          supportsNativeStreaming: false,
          supportsPromptCaching: false,
        }),
    }),
  );
}

interface Outcome {
  readonly shouldSwitch: boolean;
  readonly reasoning: string;
  readonly llmCalls: number;
  readonly signals: readonly { readonly origin: string; readonly contentPreview: string }[];
}

async function runEvaluation(
  classifierReliability: string | undefined,
  withBus: boolean,
): Promise<Outcome> {
  const llmSink = await Effect.runPromise(Ref.make<number[]>([]));
  const llmLayer = makeCountingLayer(llmSink);

  return Effect.runPromise(
    Effect.gen(function* () {
      const signalSink = yield* Ref.make<AgentEvent[]>([]);
      if (withBus) {
        const bus = yield* EventBus;
        yield* bus.on("HarnessSignalInjectedEmitted", (ev) =>
          Ref.update(signalSink, (xs) => [...xs, ev]),
        );
      }
      const evaluation = yield* evaluateStrategySwitch(
        makeState(),
        "Search the web for X and write the findings to ./x.md",
        ["plan-execute-reflect", "reflexion"],
        ["reactive"],
        classifierReliability === undefined
          ? undefined
          : { classifierReliability },
      );
      const llmCalls = (yield* Ref.get(llmSink)).length;
      const signals = (yield* Ref.get(signalSink)).flatMap((ev) =>
        ev._tag === "HarnessSignalInjectedEmitted"
          ? [{ origin: ev.origin, contentPreview: ev.contentPreview }]
          : [],
      );
      return {
        shouldSwitch: evaluation.shouldSwitch,
        reasoning: evaluation.reasoning,
        llmCalls,
        signals,
      };
    }).pipe(
      Effect.provide(withBus ? Layer.merge(llmLayer, EventBusLive) : llmLayer),
    ),
  );
}

// ── Behavioral pin for the iterate-pass loop-detector site (W4.0 re-pin) ─────

/** A fully-specified calibration carrying the documented skip reliability. */
const LOW_RELIABILITY_CALIBRATION: ModelCalibration = {
  modelId: "classifier-skip-behavior-test",
  calibratedAt: new Date(0).toISOString(),
  probeVersion: 1,
  runsAveraged: 1,
  steeringCompliance: "hybrid",
  parallelCallCapability: "sequential-only",
  observationHandling: "uses-recall",
  systemPromptAttention: "moderate",
  optimalToolResultChars: 800,
  classifierReliability: "low",
};

/** Identical repeated action — trips `detectLoop` at the iterate-pass switch site. */
const LOOP_ACTION = JSON.stringify({ tool: "web-search", input: '{"query":"loop-trigger"}' });

/**
 * Drive a REAL kernel run whose loop detector fires at the iterate-pass
 * strategy-switch site (identical repeated action + strategySwitching enabled
 * with an alternative available, and NO fallbackStrategy so the evaluator — the
 * classify round-trip — is the decision path). Returns the harness-signal origins
 * emitted during the run and the terminal status.
 */
async function runLoopDetectorCycle(
  calibration: ModelCalibration | undefined,
): Promise<{ readonly origins: readonly string[]; readonly status: string }> {
  const kernel: ThoughtKernel = (state) =>
    Effect.succeed(
      transitionState(state, {
        status: "thinking",
        iteration: state.iteration + 1,
        steps: [...state.steps, makeStep("action", LOOP_ACTION)],
      }),
    );

  return Effect.runPromise(
    Effect.gen(function* () {
      const signalSink = yield* Ref.make<AgentEvent[]>([]);
      const bus = yield* EventBus;
      yield* bus.on("HarnessSignalInjectedEmitted", (ev) =>
        Ref.update(signalSink, (xs) => [...xs, ev]),
      );
      const result = yield* runKernel(
        kernel,
        { task: "loop-detector cycle", ...(calibration ? { calibration } : {}) },
        {
          maxIterations: 20,
          strategy: "reactive",
          kernelType: "react",
          loopDetection: { maxSameToolCalls: 3 },
          strategySwitching: {
            enabled: true,
            maxSwitches: 1,
            availableStrategies: ["plan-execute-reflect"],
          },
        },
      );
      const origins = (yield* Ref.get(signalSink)).flatMap((ev) =>
        ev._tag === "HarnessSignalInjectedEmitted" ? [ev.origin] : [],
      );
      return { origins, status: result.status };
    }).pipe(
      Effect.provide(
        Layer.merge(
          TestLLMServiceLayer([{ match: ".*", text: "no valid strategy JSON here" }]),
          EventBusLive,
        ),
      ),
    ),
  );
}

// ── Skip-eligible reliabilities: no round-trip, deterministic verdict ───────

describe("W2d 2.6 — classifierReliability enforcement at the reasoning classify site", () => {
  it("reliability 'low' → NO LLM round-trip; deterministic shouldSwitch:false + skip reasoning", async () => {
    const out = await runEvaluation("low", true);

    // At HEAD this is 1 (the evaluator fires the classify exchange — the
    // live S1 trace shape). The documented skip must actually skip.
    expect(out.llmCalls).toBe(0);
    expect(out.shouldSwitch).toBe(false);
    expect(out.reasoning.toLowerCase()).toContain("classifier-skip");
    // Observable (wire-or-delete honored): a harness-signal names the skip.
    expect(out.signals.length).toBe(1);
    expect(out.signals[0]!.origin).toContain("classifier-skip");
  }, 15000);

  it("reliability 'skip' → bypass-eligible too (mirrors the runtime classifier vocabulary)", async () => {
    const out = await runEvaluation("skip", false);
    expect(out.llmCalls).toBe(0);
    expect(out.shouldSwitch).toBe(false);
    expect(out.reasoning.toLowerCase()).toContain("classifier-skip");
  }, 15000);

  it("reliability 'high' → LLM evaluator consulted exactly as before (no regression for trusted models)", async () => {
    const out = await runEvaluation("high", false);
    expect(out.llmCalls).toBe(1);
    expect(out.shouldSwitch).toBe(true);
    expect(out.reasoning).toBe("classifier said switch");
  }, 15000);

  it("no calibration (reliability undefined) → LLM evaluator consulted (byte-identical legacy behavior)", async () => {
    const out = await runEvaluation(undefined, false);
    expect(out.llmCalls).toBe(1);
    expect(out.shouldSwitch).toBe(true);
  }, 15000);

  it("behavioral pin (W4.0): a low-reliability kernel run emits the iterate-pass classifier-skip harness-signal", async () => {
    const { origins } = await runLoopDetectorCycle(LOW_RELIABILITY_CALIBRATION);
    // The skip is observable exactly where rax diagnose looks — proving the
    // iterate-pass loop-detector site threaded calibration into the evaluator.
    expect(origins).toContain("strategy-switch/classifier-skip");
  }, 15000);

  it("behavioral pin (W4.0): the same run WITHOUT calibration emits no classifier-skip signal (the evaluator is consulted)", async () => {
    const { origins } = await runLoopDetectorCycle(undefined);
    // Absent calibration → the classify round-trip runs → no skip signal.
    // This is the discriminating half: it fails if the site stops threading the
    // calibration field (both arms would then look alike).
    expect(origins).not.toContain("strategy-switch/classifier-skip");
  }, 15000);
});
