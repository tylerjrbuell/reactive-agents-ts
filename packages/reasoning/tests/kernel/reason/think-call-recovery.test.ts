// Run: bun test packages/reasoning/tests/kernel/reason/think-call-recovery.test.ts --timeout 20000
//
// A recoverable provider failure on a think call (stream init or mid-stream)
// used to end the run with `terminatedBy: "llm_error"`, e.g. Ollama's "XML
// syntax error on line 1: unexpected EOF" at iteration 5. The think call now
// retries in the same turn under a per-run budget (default 2), picking the
// recovery from the provider's error class (think-call-recovery.ts): resample
// malformed output, compact an overflow (once per run), back off a rate limit /
// timeout / network / 5xx. Fatal classes and a spent budget still end the run.
//
// RED-ON-CUT: in think-call-recovery.ts, make `recoveryStop` return "fatal"
// unconditionally and the recovery pins (a), (d), the backoff and the budget
// pins fail (one request, run failed). The fatal pin (b) and the CONTROLs stay
// green, which is what they are for.
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref, Stream } from "effect";
import {
  LLMContextOverflowError,
  LLMError,
  LLMRateLimitError,
  LLMService,
  TestLLMService,
  type CompletionRequest,
  type StreamEvent,
} from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, rootContext, type AgentEvent } from "@reactive-agents/core";
import { getRunSlot, streamSinkSlot, withRunScope } from "@reactive-agents/core/internal/run-scope";
import { executeReActKernel } from "../../../src/kernel/loop/react-kernel.js";
import { resolveHarnessConfig, llmRecoveryBudgetOf, DEFAULT_LLM_RECOVERY_BUDGET } from "../../../src/harness-config.js";
import {
  backoffMs,
  isOutputSideShrink,
  MAX_BACKOFF_MS,
  providerSpentRetries,
  recoveryOfFailure,
  recoveryStop,
  shrunkOutputBudget,
} from "../../../src/kernel/capabilities/reason/think-call-recovery.js";
import { overflowRetryWindow } from "../../../src/kernel/capabilities/reason/context-overflow-retry.js";
import { CONTEXT_PROFILES } from "../../../src/context/context-profile.js";

const PARTIAL = "GARBAGE-PARTIAL-SAMPLE";

/** Unparseable model output (Ollama's server-side tool-call parser, the owner's XML EOF). */
const malformed = () =>
  new LLMError({ message: "XML syntax error on line 1: unexpected EOF", provider: "ollama", errorClass: "malformed_output" });

type Failure =
  | "malformed-mid"
  | "malformed-init"
  | "malformed-mid-stated-wait"
  | "rate-limit"
  | "rate-limit-pre-emission"
  | "rate-limit-mid"
  | "auth"
  | "credit"
  | "quota"
  | "otpm"
  | "overflow";

/** Failures the stream raises after one text chunk (the provider retry schedule never re-sends those). */
const MID_STREAM: ReadonlySet<Failure> = new Set(["malformed-mid", "malformed-mid-stated-wait", "rate-limit-mid"]);

const failureOf = (f: Failure): LLMError | LLMRateLimitError | LLMContextOverflowError => {
  switch (f) {
    case "malformed-mid":
    case "malformed-init":
      return malformed();
    case "malformed-mid-stated-wait":
      // A resample class whose error also states a wait: a resample never waits.
      return new LLMRateLimitError({ message: "bad output", provider: "groq", retryAfterMs: 5_000, errorClass: "malformed_output", retryable: true });
    case "rate-limit":
    case "rate-limit-pre-emission":
    case "rate-limit-mid":
      return new LLMRateLimitError({ message: "429", provider: "groq", retryAfterMs: 0, errorClass: "rate_limit", retryable: true });
    case "overflow":
      return new LLMContextOverflowError({ message: "prompt is too long: 9000 tokens > 8000 maximum", tokenCount: 9000, maxTokens: 8000, errorClass: "context_overflow" });
    case "quota":
      return new LLMRateLimitError({ message: "insufficient_quota", provider: "openai", retryAfterMs: 0, errorClass: "rate_limit", retryable: false });
    case "auth":
      return new LLMError({ message: "invalid x-api-key", provider: "anthropic", errorClass: "auth" });
    case "otpm":
      // Output-side per-minute budget: a plain error, not the typed overflow (provider-error.ts).
      return new LLMError({
        message: "Request too large for model on output tokens per minute (OTPM): Limit 1000, Requested 4096",
        provider: "groq",
        errorClass: "token_rate_exceeded",
      });
    case "credit":
      return new LLMError({ message: "Your credit balance is too low", provider: "anthropic", errorClass: "invalid_param" });
  }
};

/**
 * One kernel run. The first `failures.length` stream calls fail as scripted
 * (mid-stream ones stream `PARTIAL` first); every later call answers.
 */
async function run(failures: readonly Failure[], harness = resolveHarnessConfig()) {
  const requests: CompletionRequest[] = [];
  const captured: string[] = [];
  const base = TestLLMService([{ match: "Task:", text: "FINAL ANSWER: the second sample" }]);
  const layer = Layer.succeed(
    LLMService,
    LLMService.of({
      ...base,
      stream: (req: CompletionRequest) => {
        const failure = failures[requests.length];
        requests.push(req);
        if (failure === undefined) return base.stream(req);
        const err = failureOf(failure);
        // Before any event, on the stream: what a built-in provider surfaces
        // after `retryStreamBeforeFirstEmission` spent its schedule.
        if (failure === "rate-limit-pre-emission") return Effect.succeed(Stream.fail(err));
        if (!MID_STREAM.has(failure)) return Effect.fail(err);
        const partial: StreamEvent[] = [{ type: "text_delta", text: PARTIAL }];
        return Effect.succeed(Stream.concat(Stream.fromIterable(partial), Stream.fail(err)));
      },
    }),
  );
  const program = Effect.gen(function* () {
    const events = yield* Ref.make<AgentEvent[]>([]);
    const bus = yield* EventBus;
    yield* bus.subscribe((ev) => Ref.update(events, (xs) => [...xs, ev]));
    const sink = yield* getRunSlot(streamSinkSlot);
    sink.current = (text) => Effect.sync(() => void captured.push(text));
    const result = yield* executeReActKernel({ task: "Answer the question", maxIterations: 3, harness });
    const signals = (yield* Ref.get(events)).flatMap((e) =>
      e._tag === "HarnessSignalInjectedEmitted" && e.origin === "llm-recovery" ? [e] : [],
    );
    return { result, signals };
  }).pipe(Effect.provide(Layer.mergeAll(layer, EventBusLive)), withRunScope(rootContext("recovery-run", "agent")));
  const { result, signals } = await Effect.runPromise(program);
  return { result, signals, requests, captured };
}

describe("recoverable LLM failure on a think turn", () => {
  it("(a) mid-stream malformed output, then success: the run completes with the second sample's answer", async () => {
    const { result, signals, requests } = await run(["malformed-mid"]);
    expect(requests.length).toBeGreaterThanOrEqual(2);
    expect(result.terminatedBy).not.toBe("llm_error");
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("the second sample");
    expect(signals.map((s) => [s.signalKind, s.metadata?.errorClass, s.metadata?.recovery, s.metadata?.attempt])).toEqual([
      ["redirect", "malformed_output", "resample", 1],
    ]);
  });

  it("(a') an init failure (before any chunk) is resampled the same way", async () => {
    const { result, signals } = await run(["malformed-init"]);
    expect(result.terminatedBy).not.toBe("llm_error");
    expect(result.output).toContain("the second sample");
    expect(signals[0]!.metadata).toMatchObject({ streamedTextVoid: false, discarded: { textChars: 0 } });
  });

  it("(d) text the failed attempt streamed is void: it never reaches the final output, and the signal says so", async () => {
    const { result, signals, captured } = await run(["malformed-mid"]);
    // The partial WAS forwarded to the sink before the failure...
    expect(captured.join("")).toContain(PARTIAL);
    // ...so the recovery signal marks it void for consumers to drop...
    expect(signals[0]!.metadata).toMatchObject({
      streamedTextVoid: true,
      discarded: { textChars: PARTIAL.length, thinkingChars: 0, toolCalls: 0 },
    });
    // ...and nothing of it survives into the run's answer or its steps.
    expect(result.output).not.toContain(PARTIAL);
    expect(result.steps.some((s) => s.content.includes(PARTIAL))).toBe(false);
  });

  it("(b) fatal classes (auth, credit, exhausted quota) end the run at once, no retry", async () => {
    for (const fatal of ["auth", "credit", "quota"] as const) {
      const { result, signals, requests } = await run([fatal]);
      expect(requests).toHaveLength(1);
      expect(result.terminatedBy).toBe("llm_error");
      expect(signals).toHaveLength(0);
    }
  });

  it("(c) the budget is spent after 2 recoveries: a third recoverable failure ends the run", async () => {
    // Alternating classes, so only the budget (not the same-class streak) stops it.
    const { result, signals, requests } = await run(["malformed-mid", "rate-limit", "malformed-mid"]);
    expect(requests).toHaveLength(3);
    expect(result.terminatedBy).toBe("llm_error");
    expect(signals.map((s) => [s.signalKind, s.metadata?.recovery, s.metadata?.reason ?? null])).toEqual([
      ["redirect", "resample", null],
      ["redirect", "backoff", null],
      ["block", "resample", "budget"],
    ]);
  });

  it("the same class is never retried three times in a row, even with budget left", async () => {
    const { result, signals, requests } = await run(
      ["malformed-mid", "malformed-mid", "malformed-mid"],
      resolveHarnessConfig({ llmRecoveryBudget: 5 }),
    );
    expect(requests).toHaveLength(3);
    expect(result.terminatedBy).toBe("llm_error");
    expect(signals.at(-1)!.metadata).toMatchObject({ reason: "streak", exhausted: true });
  });

  it("a rate limit backs off and retries", async () => {
    const { result, signals } = await run(["rate-limit"]);
    expect(result.terminatedBy).not.toBe("llm_error");
    expect(signals[0]!.metadata).toMatchObject({ recovery: "backoff", waitMs: 0 });
  });

  it("an output-side token budget (OTPM) lowers max_tokens and re-sends the same prompt (no compaction)", async () => {
    const { result, signals, requests } = await run(["otpm"]);
    expect(result.terminatedBy).not.toBe("llm_error");
    expect(signals[0]!.metadata).toMatchObject({ errorClass: "token_rate_exceeded", recovery: "shrink", shrinkTarget: "output" });
    expect(requests[1]!.messages).toEqual(requests[0]!.messages);
    expect(requests[1]!.maxTokens).toBeDefined();
    expect(requests[1]!.maxTokens!).toBeLessThan(requests[0]!.maxTokens ?? Number.POSITIVE_INFINITY);
  });

  it("a failure the provider's own retry schedule already spent is not retried again by the kernel", async () => {
    // A retryable error on the stream before any event: built-in providers
    // already re-sent it 3 times with backoff (`retryStreamBeforeFirstEmission`).
    const { result, signals, requests } = await run(["rate-limit-pre-emission"]);
    expect(requests).toHaveLength(1);
    expect(result.terminatedBy).toBe("llm_error");
    expect(signals.map((s) => [s.signalKind, s.metadata?.reason])).toEqual([["block", "provider-retried"]]);
    // CONTROL: after the stream emitted, the provider cannot re-send, so the kernel does.
    const mid = await run(["rate-limit-mid"]);
    expect(mid.requests).toHaveLength(2);
    expect(mid.result.terminatedBy).not.toBe("llm_error");
  });

  it("a resample never sleeps, even when the error states a wait", async () => {
    const t0 = Date.now();
    const { result, signals } = await run(["malformed-mid-stated-wait"]);
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(result.terminatedBy).not.toBe("llm_error");
    expect(signals[0]!.metadata).toMatchObject({ recovery: "resample" });
    expect(signals[0]!.metadata?.waitMs).toBeUndefined();
  });

  it("a prompt-side shrink after an output-side shrink keeps the lowered max_tokens", async () => {
    const { result, signals, requests } = await run(["otpm", "overflow"]);
    expect(signals.map((s) => s.metadata?.shrinkTarget)).toEqual(["output", "prompt"]);
    expect(result.terminatedBy).not.toBe("llm_error");
    expect(requests).toHaveLength(3);
    const lowered = requests[1]!.maxTokens!;
    expect(lowered).toBeLessThan(requests[0]!.maxTokens ?? Number.POSITIVE_INFINITY);
    expect(requests[2]!.maxTokens).toBe(lowered);
  });

  it("a recovered turn is one iteration, one thought: no loop or no-progress step for the failed attempt", async () => {
    const clean = await run([]);
    const recovered = await run(["malformed-mid"]);
    expect(recovered.result.iterations).toBe(clean.result.iterations);
    expect(recovered.result.steps.map((s) => s.type)).toEqual(clean.result.steps.map((s) => s.type));
  });

  it("CONTROL: llmRecoveryBudget 0 turns recovery off", async () => {
    const { result, requests, signals } = await run(["malformed-mid"], resolveHarnessConfig({ llmRecoveryBudget: 0 }));
    expect(requests).toHaveLength(1);
    expect(result.terminatedBy).toBe("llm_error");
    expect(signals.map((s) => s.metadata?.reason)).toEqual(["budget"]);
  });
});

describe("think-call-recovery (seam pin)", () => {
  it("recoveryOfFailure keys on the provider class, then the typed tag; anything else is fatal", () => {
    expect(recoveryOfFailure(malformed())).toEqual({ errorClass: "malformed_output", recovery: "resample" });
    expect(recoveryOfFailure(new LLMError({ message: "x", provider: "groq", errorClass: "request_too_large" })).recovery).toBe("shrink");
    expect(recoveryOfFailure(new LLMError({ message: "TPM", provider: "groq", errorClass: "token_rate_exceeded" })).recovery).toBe("shrink");
    expect(recoveryOfFailure(new LLMRateLimitError({ message: "429", provider: "groq", retryAfterMs: 0 })).recovery).toBe("backoff");
    expect(recoveryOfFailure({ _tag: "LLMError", errorClass: "not-a-class" }).recovery).toBe("fatal");
    expect(recoveryOfFailure(new LLMError({ message: "x", provider: "ollama", errorClass: "network" })).recovery).toBe("backoff");
    expect(recoveryOfFailure(new LLMError({ message: "x", provider: "openai", errorClass: "provider_5xx" })).recovery).toBe("backoff");
    expect(recoveryOfFailure(failureOf("quota")).recovery).toBe("fatal");
    expect(recoveryOfFailure(new LLMError({ message: "boom", provider: "anthropic" }))).toEqual({ errorClass: "LLMError", recovery: "fatal" });
    expect(recoveryOfFailure(undefined).recovery).toBe("fatal");
  });

  it("recoveryStop: fatal, then budget, then same-class streak, then the one shrink per run", () => {
    const resample = { errorClass: "malformed_output", recovery: "resample" } as const;
    const shrink = { errorClass: "context_overflow", recovery: "shrink" } as const;
    const fresh = { used: 0, shrinkSpent: false };
    const none = { errorClass: "", count: 0 };
    expect(recoveryStop({ errorClass: "auth", recovery: "fatal" }, fresh, 2, none)).toBe("fatal");
    expect(recoveryStop(resample, { used: 2, shrinkSpent: false }, 2, none)).toBe("budget");
    expect(recoveryStop(resample, fresh, 5, { errorClass: "malformed_output", count: 2 })).toBe("streak");
    expect(recoveryStop(resample, fresh, 5, { errorClass: "network", count: 2 })).toBeUndefined();
    expect(recoveryStop(shrink, { used: 1, shrinkSpent: true }, 5, none)).toBe("shrink-spent");
    expect(recoveryStop(resample, fresh, 2, none)).toBeUndefined();
  });

  it("providerSpentRetries: only a provider-retryable backoff/resample failure before the stream's first event", () => {
    const rl = failureOf("rate-limit");
    expect(providerSpentRetries(recoveryOfFailure(rl), rl, true)).toBe(true);
    expect(providerSpentRetries(recoveryOfFailure(rl), rl, false)).toBe(false);
    // No `retryable` flag and not a rate-limit tag: the provider schedule skips it.
    expect(providerSpentRetries(recoveryOfFailure(malformed()), malformed(), true)).toBe(false);
    // shrink is a different request: never provider-retried.
    const ovf = failureOf("overflow");
    expect(providerSpentRetries(recoveryOfFailure(ovf), ovf, true)).toBe(false);
    const quota = failureOf("quota");
    expect(providerSpentRetries(recoveryOfFailure(quota), quota, true)).toBe(false);
  });

  it("backoffMs takes the stated retry-after, else doubles from 1s, capped at 10s", () => {
    expect(backoffMs({ retryAfterMs: 250 }, 1)).toBe(250);
    expect(backoffMs({}, 1)).toBe(1000);
    expect(backoffMs({}, 2)).toBe(2000);
    expect(backoffMs({ retryAfterMs: 60_000 }, 1)).toBe(MAX_BACKOFF_MS);
    expect(backoffMs({}, 9)).toBe(MAX_BACKOFF_MS);
  });

  it("shrink sizing: an input-side token budget caps the compaction window; an output-side one halves max_tokens", () => {
    const profile = { ...CONTEXT_PROFILES["mid"], explicitNumCtx: 32_000 };
    // TPM: 8,122 requested against an 8,000 budget -> 0.7 x 8,000, not 0.7 x 8,122.
    expect(overflowRetryWindow(profile, { tokenCount: 8122, maxTokens: 8000 }, "token_rate_exceeded")).toBe(5600);
    // A window overflow keeps 0.7 x the reported prompt (2d, unchanged).
    expect(overflowRetryWindow(profile, { tokenCount: 8122, maxTokens: 8000 }, "context_overflow")).toBe(5685);
    const otpm = recoveryOfFailure(failureOf("otpm"));
    expect(isOutputSideShrink(otpm, failureOf("otpm"))).toBe(true);
    const tpm = new LLMContextOverflowError({ message: "TPM", tokenCount: 8122, maxTokens: 8000, errorClass: "token_rate_exceeded" });
    expect(isOutputSideShrink(recoveryOfFailure(tpm), tpm)).toBe(false);
    expect(shrunkOutputBudget(4096)).toBe(2048);
    expect(shrunkOutputBudget(300)).toBe(256);
    expect(shrunkOutputBudget(undefined)).toBe(2048);
    // The once-per-run latch is the prompt compaction's, not an output shrink's.
    expect(recoveryStop(otpm, { used: 1, shrinkSpent: true }, 5, { errorClass: "", count: 0 }, true)).toBeUndefined();
  });

  it("the budget is a whole number in 0..10, absent = default 2", () => {
    expect(llmRecoveryBudgetOf(resolveHarnessConfig())).toBe(DEFAULT_LLM_RECOVERY_BUDGET);
    expect("llmRecoveryBudget" in resolveHarnessConfig()).toBe(false);
    expect(resolveHarnessConfig({ llmRecoveryBudget: 3.7 }).llmRecoveryBudget).toBe(3);
    expect(resolveHarnessConfig({ llmRecoveryBudget: -1 }).llmRecoveryBudget).toBe(0);
    expect(resolveHarnessConfig({ llmRecoveryBudget: 99 }).llmRecoveryBudget).toBe(10);
  });
});
