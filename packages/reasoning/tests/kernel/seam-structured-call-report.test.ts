// Run: bun test packages/reasoning/tests/kernel/seam-structured-call-report.test.ts --timeout 20000
/**
 * Seam pins: what one `completeStructured()` call reports about itself
 * (kernel/utils/structured-call-report.ts), as read by the observable LLM
 * wrapper (trace exchange + run meter), the structured-output pipeline
 * (result usage) and plan-execute (planner strategy spend).
 *
 * Origin: H3 thinking-cap recheck (2026-11-06) — a 13,855-token planner
 * exchange recorded no stop reason, no thinking size and no attempt split, and
 * plan-execute metered the planner as raw.length/4.
 */
import { describe, expect, it } from "bun:test";
import { Effect, FiberRef, Layer, Ref, Schema } from "effect";
import { EventBus, EventBusLive, type AgentEvent, type StructuredAttemptReport } from "@reactive-agents/core";
import {
  LLMParseError,
  LLMService,
  StructuredUsageRef,
  TestLLMService,
  TestLLMServiceLayer,
  type StructuredCompletionRequest,
  type TestTurn,
  type TokenUsage,
} from "@reactive-agents/llm-provider";
import { makeObservableLLM } from "../../src/kernel/observable-llm.js";
import { makeRunBudgetMeter, withRunBudgetMeter } from "../../src/kernel/run-budget.js";
import { attemptsOf, hasReportedUsage, structuredExchangeFields } from "../../src/kernel/utils/structured-call-report.js";
import { extractStructuredOutput, structuredCallSpend } from "../../src/structured-output/pipeline.js";
import { executePlanExecute } from "../../src/strategies/plan-execute.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";

const OkSchema = Schema.Struct({ ok: Schema.Boolean });

const ATTEMPTS: readonly StructuredAttemptReport[] = [
  { attempt: 0, inputTokens: 300, outputTokens: 10096, stopReason: "max_tokens", thinkingChars: 30000, parsed: false },
  { attempt: 1, inputTokens: 300, outputTokens: 1500, stopReason: "end_turn", thinkingChars: 2000, parsed: true },
];

/** Usage as a provider leaves it on StructuredUsageRef, with the per-attempt split attached. */
const USAGE_WITH_ATTEMPTS: TokenUsage & { readonly attempts: readonly StructuredAttemptReport[] } = {
  inputTokens: 600,
  outputTokens: 11596,
  totalTokens: 12196,
  estimatedCost: 0,
  attempts: ATTEMPTS,
};

type StructuredBehaviour = "succeed" | "fail" | "silent";

/**
 * Provider double: `succeed` sets the ref then returns `{ ok: true }`; `fail`
 * sets the ref then fails with a parse error (attempts billed, no value);
 * `silent` returns a value without touching the ref (replay-layer shape).
 */
function structuredDouble(behaviours: StructuredBehaviour[], completeTurns: TestTurn[] = [{ text: "unused" }]) {
  let call = 0;
  return Layer.effect(
    LLMService,
    Effect.gen(function* () {
      const base = yield* LLMService;
      return LLMService.of({
        ...base,
        completeStructured: <A>(request: StructuredCompletionRequest<A>) =>
          Effect.gen(function* () {
            const behaviour = behaviours[call++] ?? "silent";
            if (behaviour !== "silent") yield* FiberRef.set(StructuredUsageRef, USAGE_WITH_ATTEMPTS);
            if (behaviour === "fail") {
              return yield* Effect.fail(
                new LLMParseError({ message: "parse failed after 2 attempts", rawOutput: "", expectedSchema: "{}" }),
              );
            }
            return Schema.decodeUnknownSync(request.outputSchema)({ ok: true });
          }),
      });
    }),
  ).pipe(Layer.provide(TestLLMServiceLayer(completeTurns)));
}

/** Run `program` against the observable wrapper over `inner`, collecting every exchange. */
function runObserved<A>(
  inner: Layer.Layer<LLMService>,
  program: Effect.Effect<A, unknown, LLMService>,
) {
  const meter = makeRunBudgetMeter();
  const layer = Layer.merge(makeObservableLLM().pipe(Layer.provide(inner)), EventBusLive);
  return Effect.runPromise(
    withRunBudgetMeter(
      Effect.gen(function* () {
        const sink = yield* Ref.make<Extract<AgentEvent, { _tag: "LLMExchangeEmitted" }>[]>([]);
        const bus = yield* EventBus;
        yield* bus.on("LLMExchangeEmitted", (ev) => Ref.update(sink, (xs) => [...xs, ev]));
        const value = yield* Effect.either(program);
        return { value, exchanges: yield* Ref.get(sink) };
      }).pipe(Effect.provide(layer)),
      meter,
    ),
  ).then((r) => ({ ...r, meter }));
}

const structuredCall = Effect.gen(function* () {
  const llm = yield* LLMService;
  return yield* llm.completeStructured({ messages: [{ role: "user", content: "x" }], outputSchema: OkSchema });
});

describe("structured call report — observable wrapper", () => {
  it("success: the exchange carries the attempt split, final stop reason and summed thinking size", async () => {
    const { exchanges, meter } = await runObserved(structuredDouble(["succeed"]), structuredCall);
    expect(exchanges).toHaveLength(1);
    const resp = exchanges[0]!.response;
    expect(resp.attempts).toEqual(ATTEMPTS);
    expect(resp.stopReason).toBe("end_turn");
    expect(resp.thinkingChars).toBe(32000);
    expect(resp.tokensOut).toBe(11596);
    expect(meter.tokens).toBe(12196);
    expect(meter.llmCalls).toBe(1);
  }, 20000);

  it("failure: the billed attempts are metered and recorded on the error exchange", async () => {
    const { value, exchanges, meter } = await runObserved(structuredDouble(["fail"]), structuredCall);
    expect(value._tag).toBe("Left");
    expect(exchanges).toHaveLength(1);
    const resp = exchanges[0]!.response;
    expect(resp.stopReason).toBe("error");
    expect(resp.attempts).toEqual(ATTEMPTS);
    expect(resp.tokensOut).toBe(11596);
    expect(meter.tokens).toBe(12196);
    expect(meter.llmCalls).toBe(1);
  }, 20000);

  it("a call that reports nothing never inherits the previous call's report", async () => {
    const { exchanges, meter } = await runObserved(
      structuredDouble(["succeed", "silent"]),
      Effect.zipRight(structuredCall, structuredCall),
    );
    expect(exchanges).toHaveLength(2);
    expect(exchanges[1]!.response.attempts).toBeUndefined();
    expect(exchanges[1]!.response.tokensOut).toBeUndefined();
    expect(meter.tokens).toBe(12196);
    expect(meter.llmCalls).toBe(2);
  }, 20000);
});

describe("structured call report — pipeline and planner spend", () => {
  const extract = extractStructuredOutput({ schema: OkSchema, prompt: "give ok", maxRetries: 1 });

  it("native success under the observable wrapper returns the provider usage and attempt count", async () => {
    const { value } = await runObserved(structuredDouble(["succeed"]), extract);
    expect(value._tag).toBe("Right");
    if (value._tag !== "Right") return;
    expect(value.right.nativeMode).toBe(true);
    expect(value.right.usage.totalTokens).toBe(12196);
    expect(value.right.attempts).toBe(2);
  }, 20000);

  it("a failed native call's usage seeds the prompt-mode fallback total", async () => {
    const { value } = await runObserved(structuredDouble(["fail"], [{ text: '{"ok":true}' }]), extract);
    expect(value._tag).toBe("Right");
    if (value._tag !== "Right") return;
    expect(value.right.nativeMode).toBe(false);
    expect(value.right.usage.totalTokens).toBeGreaterThan(12196);
  }, 20000);

  it("without the wrapper, a stale ref value the call did not write is not counted", async () => {
    const program = Effect.locally(StructuredUsageRef, USAGE_WITH_ATTEMPTS)(extract).pipe(
      Effect.provide(structuredDouble(["silent"])),
    );
    const result = await Effect.runPromise(program);
    expect(result.nativeMode).toBe(true);
    expect(result.usage.totalTokens).toBe(0);
  }, 20000);

  it("structuredCallSpend uses reported usage, and estimates only when none was reported", () => {
    const estimate = { prompt: "p".repeat(40), raw: "x".repeat(40) };
    const reported = { inputTokens: 1, outputTokens: 2, totalTokens: 3, estimatedCost: 0.5 };
    const unreported = { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 };
    expect(structuredCallSpend(reported, estimate)).toEqual({ tokens: 3, cost: 0.5, inputTokens: 1, outputTokens: 2, llmCalls: 1 });
    expect(structuredCallSpend(unreported, estimate)).toEqual({ tokens: 20, cost: 0, inputTokens: 10, outputTokens: 10, llmCalls: 1 });
    // The meter passes no estimate: an unreported call counts as one call, zero tokens.
    expect(structuredCallSpend(null)).toEqual({ tokens: 0, cost: 0, inputTokens: 0, outputTokens: 0, llmCalls: 1 });
    expect(hasReportedUsage(null)).toBe(false);
    expect(hasReportedUsage(unreported)).toBe(false);
    expect(hasReportedUsage(reported)).toBe(true);
  }, 20000);

  it("plan-execute meters the planner with the provider-reported usage", async () => {
    const PLAN = JSON.stringify({ steps: [{ title: "Summarize", instruction: "Write a summary", type: "analysis" }] });
    const base = TestLLMService([
      { match: "planning agent", text: PLAN },
      { match: "OVERALL GOAL", text: "FINAL ANSWER: Summary written." },
      { match: "GOAL:", text: "SATISFIED: done." },
      { match: "Synthesize", text: "The summary is written." },
    ]);
    const PLANNER_TOKENS = 50000;
    const layer = Layer.succeed(
      LLMService,
      LLMService.of({
        ...base,
        completeStructured: <A>(request: StructuredCompletionRequest<A>) =>
          FiberRef.set(StructuredUsageRef, {
            inputTokens: 1000,
            outputTokens: PLANNER_TOKENS - 1000,
            totalTokens: PLANNER_TOKENS,
            estimatedCost: 0,
          }).pipe(Effect.zipRight(base.completeStructured(request))),
      }),
    );
    const result = await Effect.runPromise(
      provideTestEnvelope(
        executePlanExecute({
          taskDescription: "Summarize the topic",
          taskType: "research",
          memoryContext: "",
          availableTools: [],
          config: defaultReasoningConfig,
        }).pipe(Effect.provide(layer)),
      ),
    );
    expect(result.metadata.tokensUsed).toBeGreaterThanOrEqual(PLANNER_TOKENS);
  }, 20000);

  it("one planner call lands on the run meter once (the wrapper meters, the strategy only reports)", async () => {
    // Simplicity audit item 7: the observable wrapper meters the structured
    // call, and plan-execute accounts the same call on its LOCAL spend. The
    // strategy spend never feeds the meter (resolveRunSpend takes the max), so
    // the planner's tokens must appear on the meter exactly once.
    const PLAN = JSON.stringify({ steps: [{ title: "Summarize", instruction: "Write a summary", type: "analysis" }] });
    const base = TestLLMService([
      { match: "planning agent", text: PLAN },
      { match: "OVERALL GOAL", text: "FINAL ANSWER: Summary written." },
      { match: "GOAL:", text: "SATISFIED: done." },
      { match: "Synthesize", text: "The summary is written." },
    ]);
    const PLANNER_TOKENS = 50000;
    const inner = Layer.succeed(
      LLMService,
      LLMService.of({
        ...base,
        completeStructured: <A>(request: StructuredCompletionRequest<A>) =>
          FiberRef.set(StructuredUsageRef, {
            inputTokens: 1000,
            outputTokens: PLANNER_TOKENS - 1000,
            totalTokens: PLANNER_TOKENS,
            estimatedCost: 0,
          }).pipe(Effect.zipRight(base.completeStructured(request))),
      }),
    );
    const program = Effect.gen(function* () {
      return yield* provideTestEnvelope(
        executePlanExecute({
          taskDescription: "Summarize the topic",
          taskType: "research",
          memoryContext: "",
          availableTools: [],
          config: defaultReasoningConfig,
        }),
      );
    });
    const { value, meter } = await runObserved(inner, program);
    expect(value._tag).toBe("Right");
    if (value._tag !== "Right") return;
    expect(meter.tokens).toBeGreaterThanOrEqual(PLANNER_TOKENS);
    expect(meter.tokens).toBeLessThan(2 * PLANNER_TOKENS);
    expect(value.right.metadata.tokensUsed).toBeLessThan(2 * PLANNER_TOKENS);
  }, 20000);
});

describe("structured call report — shaping", () => {
  it("reads the typed attempts list, null when absent or empty, and keeps absent fields absent", () => {
    const usage: TokenUsage = { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCost: 0 };
    expect(attemptsOf(USAGE_WITH_ATTEMPTS)).toEqual(ATTEMPTS);
    expect(attemptsOf({ ...usage, attempts: [] })).toBeNull();
    expect(attemptsOf(usage)).toBeNull();
    expect(attemptsOf(null)).toBeNull();
    expect(structuredExchangeFields({ usage: null, attempts: null })).toEqual({});
    expect(structuredExchangeFields({ usage, attempts: null })).toEqual({ usage });
  }, 20000);
});
