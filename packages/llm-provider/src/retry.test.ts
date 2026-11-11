import { describe, expect, it } from "bun:test";
import { Effect, Stream } from "effect";
import { isRetryableLLMError, retryStreamBeforeFirstEmission } from "./retry.js";
import { mapProviderError } from "./provider-error.js";
import { LLMError, LLMMalformedOutputError, LLMParseError, LLMRateLimitError, LLMTimeoutError } from "./errors.js";
import type { LLMErrors } from "./errors.js";
import type { StreamEvent } from "./types.js";

/**
 * EH-1 (2026-07-29 systems audit, root cause #3): `retryPolicy` was wired
 * into `complete()` on all 5 providers but never `stream()`. This pins the
 * streaming-safe wrapper's core property: retry only up to the first emitted
 * event, never after — a bare `Stream.retry` would duplicate output for any
 * failure that lands after partial content has already reached the caller.
 */
describe("retryStreamBeforeFirstEmission", () => {
  it("retries a retryable failure that occurs before any emission, then succeeds", async () => {
    let attempts = 0;
    const stream = Stream.async<StreamEvent, LLMError | LLMRateLimitError>((emit) => {
      attempts += 1;
      if (attempts < 3) {
        emit.fail(
          new LLMRateLimitError({ message: "rate limited", provider: "anthropic", retryAfterMs: 1 }),
        );
      } else {
        emit.single({ type: "text_delta", text: "ok" });
        emit.end();
      }
    });

    const events = await Effect.runPromise(
      Stream.runCollect(retryStreamBeforeFirstEmission(stream)).pipe(Effect.map((c) => [...c])),
    );

    expect(attempts).toBe(3);
    expect(events).toEqual([{ type: "text_delta", text: "ok" }]);
  }, 15_000); // retryPolicy's exponential backoff (1s, 2s, ...) is real delay, not mocked.

  it("does NOT retry once something has already been emitted, even on a retryable tag", async () => {
    let attempts = 0;
    const stream = Stream.async<StreamEvent, LLMError | LLMTimeoutError>((emit) => {
      attempts += 1;
      emit.single({ type: "text_delta", text: `attempt-${attempts}` });
      emit.fail(new LLMTimeoutError({ message: "timed out", provider: "anthropic", timeoutMs: 100 }));
    });

    const result = await Effect.runPromiseExit(
      Stream.runCollect(retryStreamBeforeFirstEmission(stream)),
    );

    // Exactly one attempt: the failure happened AFTER an emission, so the
    // guard must not restart the producer a second time.
    expect(attempts).toBe(1);
    expect(result._tag).toBe("Failure");
  });

  it("does not retry a non-retryable error tag even before any emission", async () => {
    let attempts = 0;
    const stream = Stream.async<StreamEvent, LLMError>((emit) => {
      attempts += 1;
      emit.fail(new LLMError({ message: "bad request", provider: "anthropic" }));
    });

    const result = await Effect.runPromiseExit(
      Stream.runCollect(retryStreamBeforeFirstEmission(stream)),
    );

    expect(attempts).toBe(1);
    expect(result._tag).toBe("Failure");
  });

  it("exhausts the retry budget and surfaces the failure if never emits", async () => {
    let attempts = 0;
    const stream = Stream.async<StreamEvent, LLMError | LLMRateLimitError>((emit) => {
      attempts += 1;
      emit.fail(new LLMRateLimitError({ message: "rate limited", provider: "anthropic", retryAfterMs: 1 }));
    });

    const result = await Effect.runPromiseExit(
      Stream.runCollect(retryStreamBeforeFirstEmission(stream)),
    );

    // Schedule.recurs(3) → 1 initial + 3 retries = 4 total attempts.
    expect(attempts).toBe(4);
    expect(result._tag).toBe("Failure");
  }, 15_000); // full backoff exhaustion: ~1s+2s+4s of real delay.
});

// RED-on-cut: put the retry predicate back to tag-only
// (`_tag === "LLMRateLimitError" || _tag === "LLMTimeoutError"`) and the
// malformed-output resample below stops at 1 attempt.
describe("malformed model output — own tag, resampled before first emission", () => {
  const ollamaXmlEof = (): LLMErrors =>
    mapProviderError({ message: "XML syntax error on line 1: unexpected EOF" }, "ollama");

  it("maps to LLMMalformedOutputError, not a rate limit", () => {
    const e = ollamaXmlEof();
    expect(e._tag).toBe("LLMMalformedOutputError");
    expect((e as { errorClass?: string }).errorClass).toBe("malformed_output");
    expect((e as { retryable?: boolean }).retryable).toBe(true);
  });

  it("is resampled when it fails before any emission", async () => {
    let attempts = 0;
    const stream = Stream.async<StreamEvent, LLMErrors>((emit) => {
      attempts += 1;
      if (attempts < 2) {
        emit.fail(ollamaXmlEof());
      } else {
        emit.single({ type: "text_delta", text: "ok" });
        emit.end();
      }
    });

    const events = await Effect.runPromise(
      Stream.runCollect(retryStreamBeforeFirstEmission(stream)).pipe(Effect.map((c) => [...c])),
    );

    expect(attempts).toBe(2);
    expect(events).toEqual([{ type: "text_delta", text: "ok" }]);
  }, 15_000);

  it("is NOT resampled once something was emitted", async () => {
    let attempts = 0;
    const stream = Stream.async<StreamEvent, LLMErrors>((emit) => {
      attempts += 1;
      emit.single({ type: "text_delta", text: `attempt-${attempts}` });
      emit.fail(ollamaXmlEof());
    });

    const result = await Effect.runPromiseExit(Stream.runCollect(retryStreamBeforeFirstEmission(stream)));

    expect(attempts).toBe(1);
    expect(result._tag).toBe("Failure");
  });
});

describe("isRetryableLLMError — keys on retryable, tag only as fallback", () => {
  it("structural flag wins over the tag", () => {
    expect(isRetryableLLMError(new LLMMalformedOutputError({ message: "x", provider: "ollama" }))).toBe(true);
    expect(
      isRetryableLLMError(new LLMRateLimitError({ message: "quota", provider: "openai", retryAfterMs: 1, retryable: false })),
    ).toBe(false);
    expect(isRetryableLLMError(new LLMError({ message: "t", provider: "openai", retryable: true }))).toBe(true);
  });

  it("no flag: rate limit and timeout retry, the rest do not", () => {
    expect(isRetryableLLMError(new LLMRateLimitError({ message: "r", provider: "openai", retryAfterMs: 1 }))).toBe(true);
    expect(isRetryableLLMError(new LLMTimeoutError({ message: "t", provider: "openai", timeoutMs: 1 }))).toBe(true);
    expect(isRetryableLLMError(new LLMError({ message: "e", provider: "openai" }))).toBe(false);
    expect(isRetryableLLMError(new LLMParseError({ message: "p", rawOutput: "", expectedSchema: "" }))).toBe(false);
  });
});
