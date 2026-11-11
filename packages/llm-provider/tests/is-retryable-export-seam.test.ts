// Seam pin: the provider retry predicate is public, so consumers (the kernel's
// think-call recovery) import it instead of keeping a copy that drifts.
import { describe, expect, it } from "bun:test";
import { isRetryableLLMError } from "@reactive-agents/llm-provider";
import { isRetryableLLMError as fromRetryModule } from "../src/retry.js";
import { LLMError, LLMRateLimitError, LLMTimeoutError } from "../src/errors.js";

describe("isRetryableLLMError public export (seam)", () => {
  it("is the same function the retry schedule gates on", () => {
    expect(isRetryableLLMError).toBe(fromRetryModule);
  });

  it("answers like the provider schedule", () => {
    expect(
      isRetryableLLMError(new LLMTimeoutError({ message: "t", provider: "anthropic", timeoutMs: 1 })),
    ).toBe(true);
    expect(
      isRetryableLLMError(
        new LLMRateLimitError({ message: "r", provider: "anthropic", retryAfterMs: 1 }),
      ),
    ).toBe(true);
    expect(
      isRetryableLLMError(
        new LLMError({ message: "net", provider: "anthropic", errorClass: "network", retryable: true }),
      ),
    ).toBe(true);
    expect(
      isRetryableLLMError(
        new LLMError({ message: "auth", provider: "anthropic", errorClass: "auth", retryable: true }),
      ),
    ).toBe(false);
    expect(isRetryableLLMError(new LLMError({ message: "x", provider: "anthropic" }))).toBe(false);
  });
});
