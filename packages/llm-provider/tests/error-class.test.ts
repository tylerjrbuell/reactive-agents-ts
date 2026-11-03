// Typed provider-failure classification (measurement only — no retry change).
import { describe, it, expect } from "bun:test";
import { classifyProviderError } from "../src/error-class.js";
import { mapProviderError } from "../src/provider-error.js";
import { LLMTimeoutError } from "../src/errors.js";
import type { LLMErrorClass } from "../src/error-class.js";

type Row = readonly [label: string, provider: string, status: number | undefined, message: string, expected: LLMErrorClass, retryable: boolean, code?: string];

const rows: ReadonlyArray<Row> = [
  // overflow
  ["openai ctx", "openai", 400, "This model's maximum context length is 8192 tokens. However, your messages resulted in 9000 tokens.", "context_overflow", false, "context_length_exceeded"],
  ["groq ctx", "groq", 400, "Please reduce the length of the messages or completion.", "context_overflow", false],
  ["anthropic ctx", "anthropic", 400, "prompt is too long: 213462 tokens > 200000 maximum", "context_overflow", false],
  ["anthropic 413", "anthropic", 413, "Request exceeds the maximum allowed number of bytes.", "request_too_large", false],
  ["groq 413", "groq", 413, "Request too large for model llama on tokens per minute (TPM)", "request_too_large", false],
  ["gemini ctx", "gemini", 400, "The input token count (1100000) exceeds the maximum number of tokens allowed (1048575).", "context_overflow", false],
  ["ollama 413", "ollama", 413, "request body too large", "request_too_large", false],
  ["litellm ctx", "litellm", 400, "ContextWindowExceededError: maximum context length is 4096 tokens", "context_overflow", false],
  // near-misses: max_tokens param error is a param fault, not overflow
  ["max_tokens param", "openai", 400, "max_tokens is too large: 999999. This model supports at most 16384 completion tokens.", "invalid_param", false],
  ["400 plain", "anthropic", 400, "temperature: range: 0..1", "invalid_param", false],
  // 429 stays rate limit even if it mentions tokens
  ["openai tpm 429", "openai", 429, "Request too large for gpt-4 on tokens per min (TPM)", "rate_limit", true],
  ["quota 429", "openai", 429, "You exceeded your current quota", "rate_limit", false, "insufficient_quota"],
  ["rate 429", "groq", 429, "rate limited", "rate_limit", true],
  // tools
  ["ollama no tools", "ollama", 400, "registry.ollama.ai/library/gemma does not support tools", "tool_schema_invalid", false],
  ["openai bad fn", "openai", 400, "Invalid schema for function 'x': In context=(), 'additionalProperties' is required", "tool_schema_invalid", false],
  ["anthropic tool schema", "anthropic", 400, "tools.0.input_schema: JSON schema is invalid", "tool_schema_invalid", false],
  // auth / model / filter
  ["401", "openai", 401, "Incorrect API key provided", "auth", false],
  ["403", "gemini", 403, "forbidden", "auth", false],
  ["404 model", "anthropic", 404, "model: claude-x", "model_not_found", false],
  ["ollama model", "ollama", undefined, "model 'foo' not found", "model_not_found", false],
  ["filter", "openai", 400, "Your request was rejected: content_policy_violation", "content_filter", false],
  // transport
  ["529", "anthropic", 529, "Overloaded", "provider_5xx", true],
  ["503", "groq", 503, "unavailable", "provider_5xx", true],
  ["econnreset", "ollama", undefined, "read ECONNRESET", "network", true],
  ["eof", "ollama", undefined, "unexpected EOF", "network", true],
  ["timeout", "openai", undefined, "Request timed out.", "timeout", true],
  ["408", "openai", 408, "Request Timeout", "timeout", true],
  ["aborted is not network", "openai", undefined, "context canceled", "unknown", false],
  ["unknown", "openai", undefined, "something odd", "unknown", false],
];

describe("classifyProviderError — table", () => {
  for (const [label, provider, status, message, expected, retryable, code] of rows) {
    it(`${provider}: ${label} -> ${expected}`, () => {
      expect(classifyProviderError({ providerId: provider, status, message, code })).toEqual({
        errorClass: expected,
        retryable,
      });
    });
  }
});

describe("mapProviderError — classification reaches the error value", () => {
  it("overflow becomes LLMContextOverflowError with parsed tokens, status, not retryable", () => {
    const e = mapProviderError(
      { status: 400, message: "prompt is too long: 213462 tokens > 200000 maximum" },
      "anthropic",
    );
    expect(e._tag).toBe("LLMContextOverflowError");
    if (e._tag !== "LLMContextOverflowError") return;
    expect(e.errorClass).toBe("context_overflow");
    expect(e.retryable).toBe(false);
    expect(e.status).toBe(400);
    expect(e.tokenCount).toBe(213462);
    expect(e.maxTokens).toBe(200000);
  });

  it("413 -> request_too_large overflow error", () => {
    const e = mapProviderError({ status: 413, message: "Request too large" }, "groq");
    expect(e._tag).toBe("LLMContextOverflowError");
    expect((e as { errorClass?: string }).errorClass).toBe("request_too_large");
  });

  it("openai-style 400 overflow with string code", () => {
    const e = mapProviderError(
      { status: 400, code: "context_length_exceeded", message: "This model's maximum context length is 8192 tokens. However, your messages resulted in 9000 tokens." },
      "openai",
    );
    expect(e._tag).toBe("LLMContextOverflowError");
  });

  it("existing tags unchanged, now classified", () => {
    const r = mapProviderError({ status: 429, message: "slow" }, "openai");
    expect(r._tag).toBe("LLMRateLimitError");
    expect((r as { errorClass?: string }).errorClass).toBe("rate_limit");
    const s = mapProviderError({ status: 503, message: "down" }, "groq");
    expect(s._tag).toBe("LLMRateLimitError");
    expect((s as { errorClass?: string }).errorClass).toBe("provider_5xx");
    const a = mapProviderError({ status: 401, message: "no" }, "openai");
    expect(a._tag).toBe("LLMError");
    expect((a as { errorClass?: string; status?: number }).errorClass).toBe("auth");
    expect((a as { status?: number }).status).toBe(401);
    const p = mapProviderError({ status: 400, message: "bad temperature" }, "openai");
    expect(p._tag).toBe("LLMError");
    expect((p as { errorClass?: string }).errorClass).toBe("invalid_param");
  });

  it("LLMTimeoutError carries structural class without call-site changes", () => {
    const t = new LLMTimeoutError({ message: "x", provider: "openai", timeoutMs: 1 });
    expect(t.errorClass).toBe("timeout");
    expect(t.retryable).toBe(true);
  });
});
