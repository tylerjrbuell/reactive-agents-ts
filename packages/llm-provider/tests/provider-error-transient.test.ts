// Transient-error classification for mapProviderError.
//
// Root cause (Wave 5 cross-tier diagnosis): 5xx / 529-overload / network errors
// fell through to the catch-all LLMError, which the retry policy does NOT retry
// (it only retries LLMRateLimitError + LLMTimeoutError). So a transient Groq/
// provider blip failed immediately — the source of the 0-token bench runs.
//
// A transient server/network failure and a 429 share the same remediation:
// back off and retry. So mapProviderError now classifies them as the retryable
// LLMRateLimitError class (with an honest message), while genuinely permanent
// 4xx errors stay LLMError.

import { describe, it, expect } from "bun:test";
import { mapProviderError } from "../src/provider-error.js";
import { retryPolicy } from "../src/retry.js";
import type { LLMErrors } from "../src/errors.js";

const map = (raw: unknown) => mapProviderError(raw, "groq");

// The retry policy's while-predicate: does it choose to retry this error?
// (Schedule internals aren't publicly inspectable; we assert the classification
// tag the predicate keys on, which is the contract retry.ts documents.)
const RETRYABLE_TAGS = new Set(["LLMRateLimitError", "LLMTimeoutError"]);
const isRetried = (e: LLMErrors) => RETRYABLE_TAGS.has(e._tag);

describe("mapProviderError — transient server/network → retryable", () => {
  it("429 → LLMRateLimitError (retried)", () => {
    const e = map({ status: 429, message: "rate limited" });
    expect(e._tag).toBe("LLMRateLimitError");
    expect(isRetried(e)).toBe(true);
  });

  for (const status of [500, 502, 503, 504, 529]) {
    it(`${status} → retryable (was a fatal LLMError)`, () => {
      const e = map({ status, message: `${status} server error` });
      expect(isRetried(e)).toBe(true);
      // Message stays honest about what actually happened.
      expect(e.message.toLowerCase()).not.toBe("rate limit exceeded");
    });
  }

  it("529 overloaded_error is retryable (the Anthropic/Groq overload case)", () => {
    const e = map({ status: 529, message: "overloaded_error: server overloaded" });
    expect(isRetried(e)).toBe(true);
    expect(e.message).toContain("overloaded");
  });

  for (const code of ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN"]) {
    it(`network ${code} → retryable`, () => {
      const e = map({ code, message: `request failed ${code}` });
      expect(isRetried(e)).toBe(true);
    });
  }

  it("'socket hang up' (no status) → retryable", () => {
    const e = map({ message: "socket hang up" });
    expect(isRetried(e)).toBe(true);
  });
});

describe("mapProviderError — permanent errors stay fatal (not retried)", () => {
  for (const status of [400, 401, 403, 422]) {
    it(`${status} → LLMError (NOT retried)`, () => {
      const e = map({ status, message: `${status} bad request` });
      expect(e._tag).toBe("LLMError");
      expect(isRetried(e)).toBe(false);
    });
  }

  it("404 model-not-found → LLMError (NOT retried)", () => {
    const e = mapProviderError({ status: 404, message: 'model "foo" not found' }, "groq", "foo");
    expect(e._tag).toBe("LLMError");
    expect(isRetried(e)).toBe(false);
  });
});

// retryPolicy is a real Schedule — sanity that it exists and is a Schedule.
describe("retryPolicy wiring", () => {
  it("is defined", () => {
    expect(retryPolicy).toBeDefined();
  });
});

// ─── Auth failures name the missing env var (first-touch DX) ─────────────────
// A first-time user with no key previously saw the raw SDK text ("Could not
// resolve authentication method…") which never names ANTHROPIC_API_KEY. The
// auth branch maps 401/403/credential-phrased errors to one actionable line.
describe("mapProviderError — auth failures name the provider env var", () => {
  it("anthropic no-key SDK error names ANTHROPIC_API_KEY", () => {
    const e = mapProviderError(
      { message: "Could not resolve authentication method. Expected either apiKey or authToken to be set." },
      "anthropic",
    );
    expect(e._tag).toBe("LLMError");
    expect(e.message).toContain("ANTHROPIC_API_KEY");
  });

  it("401 on groq names GROQ_API_KEY", () => {
    const e = mapProviderError({ status: 401, message: "Invalid API Key" }, "groq");
    expect(e.message).toContain("GROQ_API_KEY");
    expect(isRetried(e)).toBe(false);
  });

  it("403 on openai names OPENAI_API_KEY", () => {
    const e = mapProviderError({ status: 403, message: "forbidden" }, "openai");
    expect(e.message).toContain("OPENAI_API_KEY");
  });

  it("gemini names GOOGLE_API_KEY (not GEMINI_API_KEY)", () => {
    const e = mapProviderError({ status: 401, message: "unauthorized" }, "gemini");
    expect(e.message).toContain("GOOGLE_API_KEY");
  });

  it("ollama auth-ish error does NOT invent an env var (local, keyless)", () => {
    const e = mapProviderError({ status: 401, message: "unauthorized" }, "ollama");
    expect(e.message).not.toContain("_API_KEY");
  });
});
