// Typed provider-failure classification (measurement only — no retry change).
import { describe, it, expect } from "bun:test";
import { NETWORK_FAULT, classifyProviderError, isLLMErrorClass, recoveryFor } from "../src/error-class.js";
import { mapProviderError } from "../src/provider-error.js";
import { LLMTimeoutError } from "../src/errors.js";
import type { LLMErrorClass, LLMRecovery } from "../src/error-class.js";

type Row = readonly [label: string, provider: string, status: number | undefined, message: string, expected: LLMErrorClass, retryable: boolean, code?: string];

const rows: ReadonlyArray<Row> = [
  // overflow
  ["openai ctx", "openai", 400, "This model's maximum context length is 8192 tokens. However, your messages resulted in 9000 tokens.", "context_overflow", false, "context_length_exceeded"],
  ["groq ctx", "groq", 400, "Please reduce the length of the messages or completion.", "context_overflow", false],
  ["anthropic ctx", "anthropic", 400, "prompt is too long: 213462 tokens > 200000 maximum", "context_overflow", false],
  ["anthropic 413", "anthropic", 413, "Request exceeds the maximum allowed number of bytes.", "request_too_large", false],
  ["groq 413 TPM", "groq", 413, "Request too large for model llama on tokens per minute (TPM)", "token_rate_exceeded", false],
  ["gemini ctx", "gemini", 400, "The input token count (1100000) exceeds the maximum number of tokens allowed (1048575).", "context_overflow", false],
  ["ollama 413", "ollama", 413, "request body too large", "request_too_large", false],
  ["litellm ctx", "litellm", 400, "ContextWindowExceededError: maximum context length is 4096 tokens", "context_overflow", false],
  // near-misses: max_tokens param error is a param fault, not overflow
  ["max_tokens param", "openai", 400, "max_tokens is too large: 999999. This model supports at most 16384 completion tokens.", "invalid_param", false],
  ["400 plain", "anthropic", 400, "temperature: range: 0..1", "invalid_param", false],
  // "Request too large" vs a per-minute budget: the request alone exceeds it, so waiting cannot help
  ["openai tpm 429", "openai", 429, "Request too large for gpt-4 on tokens per min (TPM)", "token_rate_exceeded", false],
  // other 429s that mention tokens stay rate limits (budget spent by earlier calls; a wait clears it)
  ["openai tpm used 429", "openai", 429, "Rate limit reached for gpt-4 in organization org-x on tokens per min (TPM): Limit 10000, Used 9000, Requested 2000.", "rate_limit", true],
  ["quota 429", "openai", 429, "You exceeded your current quota", "quota", false, "insufficient_quota"],
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

// Census of ~/.reactive-agents/traces llm_error runs (2026-11-10), real message
// strings (org ids redacted). Ollama/Groq stream errors carry no HTTP status.
const census: ReadonlyArray<Row> = [
  // malformed model output -> resample
  ["ollama XML eof (trace 01M7320F4K6SANX75DKRWJXBKC)", "ollama", undefined, "XML syntax error on line 1: unexpected EOF", "malformed_output", true],
  ["ollama XML eof, kernel-wrapped", "ollama", undefined, "ollama call failed (ollama:mimo-v2.6:latest): XML syntax error on line 1: unexpected EOF", "malformed_output", true],
  ["ollama XML mismatched element", "ollama", undefined, "ollama request failed: XML syntax error on line 1: element <function> closed by </parameter>", "malformed_output", true],
  ["ollama XML eof on a 500", "ollama", 500, "XML syntax error on line 1: unexpected EOF", "malformed_output", true],
  ["ollama JSON tool call", "ollama", undefined, "error parsing tool call: raw='{\"name\": \"web-search\", \"arguments\": {', err=unexpected end of JSON input", "malformed_output", true],
  ["groq unknown tool", "groq", 400, "groq request failed: Tool call validation failed: tool call validation failed: attempted to call tool 'recall' which was not in request.tools", "malformed_output", true],
  ["groq unknown tool, no status", "groq", undefined, "groq request failed: Tool call validation failed: tool call validation failed: attempted to call tool 'search_web' which was not in request.tools", "malformed_output", true],
  ["groq failed_generation", "groq", 400, "Failed to call a function. Please adjust your prompt. See 'failed_generation' for more details.", "malformed_output", true, "tool_use_failed"],
  // per-minute token budget -> shrink
  ["groq 413 TPM", "groq", 413, "groq request failed: 413 Request too large for model `openai/gpt-oss-20b` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 8122, please reduce your message size and try again.", "token_rate_exceeded", false],
  ["groq 413 ITPM", "groq", 413, "groq request failed: 413 Request too large for model `qwen/qwen3.8-27b` in organization `org_x` service tier `on_demand` on input tokens per minute (ITPM): Limit 7000, Requested 9641, please reduce your message size and try again.", "token_rate_exceeded", false],
  ["groq 429 OTPM", "groq", 429, "429 Request too large for model `qwen/qwen3.8-27b` in organization `org_x` service tier `on_demand` on output tokens per minute (OTPM): Limit 1000, Requested 1174. The request's expected output tokens exceed the enforced limit; reduce max_tokens", "token_rate_exceeded", false],
  ["groq TPM, no status", "groq", undefined, "groq request failed: 413 Request too large for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 9697, please reduce your message size and try again.", "token_rate_exceeded", false],
  // hard body limit stays distinct
  ["hard 413 body", "anthropic", 413, "Request exceeds the maximum allowed number of bytes.", "request_too_large", false],
  // genuine transport EOF stays network
  ["bare unexpected EOF", "ollama", undefined, "unexpected EOF", "network", true],
  // billing / prepaid balance -> fatal quota (15 trace files, 2026-11-10); was invalid_param / unknown
  ["anthropic 400 credit balance", "anthropic", 400, "anthropic request failed: 400 Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.", "quota", false],
  ["anthropic credit balance, stream-wrapped, no status", "anthropic", undefined, "stream failed at iteration 0: anthropic call failed (anthropic:claude-sonnet-4-6): anthropic request failed: 400 Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.", "quota", false],
  ["gemini 402 prepayment", "gemini", 402, "gemini request failed: { \"error\": { \"code\": 402, \"message\": \"Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing. Learn more at https://ai.google.dev/gemini-api/docs/billing#prepay. \", \"status\": \"RESOURCE_EXHAUSTED\" }", "quota", false],
  ["gemini prepayment, no status", "gemini", undefined, "gemini call failed (gemini:gemini-2.5-flash): gemini request failed: Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing.", "quota", false],
  ["openai 429 insufficient_quota", "openai", 429, "You exceeded your current quota, please check your plan and billing details.", "quota", false, "insufficient_quota"],
  ["openai billing hard limit", "openai", 400, "Billing hard limit has been reached", "quota", false, "billing_hard_limit_reached"],
];

describe("classifyProviderError — llm_error census", () => {
  for (const [label, provider, status, message, expected, retryable, code] of census) {
    it(`${provider}: ${label} -> ${expected}`, () => {
      expect(classifyProviderError({ providerId: provider, status, message, code })).toEqual({
        errorClass: expected,
        retryable,
      });
    });
  }

  // RED-on-cut: move the MALFORMED_OUTPUT check below the NETWORK_FAULT check in
  // classifyProviderError and this reads "network" (the message ends "unexpected EOF").
  it("order pin: parser EOF is malformed_output, not network, though NETWORK_FAULT matches it", () => {
    const message = "XML syntax error on line 1: unexpected EOF";
    expect(NETWORK_FAULT.test(message)).toBe(true);
    expect(classifyProviderError({ providerId: "ollama", message }).errorClass).toBe("malformed_output");
  });
});

describe("recoveryFor — policy per class", () => {
  const table: ReadonlyArray<readonly [LLMErrorClass, LLMRecovery]> = [
    ["malformed_output", "resample"],
    ["token_rate_exceeded", "shrink"],
    ["context_overflow", "shrink"],
    ["request_too_large", "shrink"],
    ["rate_limit", "backoff"],
    ["timeout", "backoff"],
    ["network", "backoff"],
    ["provider_5xx", "backoff"],
    ["invalid_param", "fatal"],
    ["tool_schema_invalid", "fatal"],
    ["auth", "fatal"],
    ["model_not_found", "fatal"],
    ["content_filter", "fatal"],
    ["unknown", "fatal"],
  ];
  for (const [cls, recovery] of table) {
    it(`${cls} -> ${recovery}`, () => expect(recoveryFor(cls)).toBe(recovery));
  }

  it("non-retryable backoff/resample is fatal; shrink survives", () => {
    expect(recoveryFor("rate_limit", false)).toBe("fatal");
    expect(recoveryFor("malformed_output", false)).toBe("fatal");
    expect(recoveryFor("token_rate_exceeded", false)).toBe("shrink");
    expect(recoveryFor("rate_limit", true)).toBe("backoff");
  });

  it("every census row resolves to the intended recovery", () => {
    const got = census.map(([, provider, status, message, , , code]) => {
      const c = classifyProviderError({ providerId: provider, status, message, code });
      return recoveryFor(c.errorClass, c.retryable);
    });
    expect(got).toEqual([
      ...Array<LLMRecovery>(8).fill("resample"),
      ...Array<LLMRecovery>(4).fill("shrink"),
      "shrink",
      "backoff",
      ...Array<LLMRecovery>(6).fill("fatal"),
    ]);
  });

  it("quota is fatal whatever retryable says", () => {
    expect(recoveryFor("quota")).toBe("fatal");
    expect(recoveryFor("quota", true)).toBe("fatal");
  });

  // RED-on-cut: move the QUOTA_EXHAUSTED check below the 429 rule and this reads rate_limit.
  it("order pin: a 429 insufficient_quota is quota, not a rate limit", () => {
    expect(classifyProviderError({ providerId: "openai", status: 429, message: "insufficient_quota" }).errorClass).toBe("quota");
  });

  it("near-miss: a plain 429 that mentions quota limits stays a retryable rate limit", () => {
    expect(
      classifyProviderError({ providerId: "gemini", status: 429, message: "Resource has been exhausted (e.g. check quota)." }),
    ).toEqual({ errorClass: "rate_limit", retryable: true });
  });
});

describe("isLLMErrorClass — structural guard over the closed set", () => {
  it("accepts every class recoveryFor knows, including quota", () => {
    for (const c of ["rate_limit", "quota", "token_rate_exceeded", "malformed_output", "unknown"]) {
      expect(isLLMErrorClass(c)).toBe(true);
    }
  });
  it("rejects error tags, prototype keys and near-misses", () => {
    for (const s of ["LLMRateLimitError", "toString", "constructor", "Quota", "invalid-param", ""]) {
      expect(isLLMErrorClass(s)).toBe(false);
    }
  });
});

describe("mapProviderError — quota keeps its class on the error value", () => {
  it("anthropic 400 credit balance -> errorClass quota, not retryable", () => {
    const e = mapProviderError(
      { status: 400, message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." },
      "anthropic",
    );
    expect((e as { errorClass?: string }).errorClass).toBe("quota");
    expect((e as { retryable?: boolean }).retryable).toBe(false);
  });
  it("openai 429 insufficient_quota -> errorClass quota, not retryable", () => {
    const e = mapProviderError({ status: 429, code: "insufficient_quota", message: "You exceeded your current quota" }, "openai");
    expect((e as { errorClass?: string }).errorClass).toBe("quota");
    expect((e as { retryable?: boolean }).retryable).toBe(false);
  });
});

describe("mapProviderError — census classes reach the right tag", () => {
  it("malformed output -> LLMMalformedOutputError with errorClass malformed_output", () => {
    const e = mapProviderError({ message: "XML syntax error on line 1: unexpected EOF" }, "ollama");
    expect(e._tag).toBe("LLMMalformedOutputError");
    expect((e as { errorClass?: string }).errorClass).toBe("malformed_output");
    expect((e as { retryable?: boolean }).retryable).toBe(true);
  });

  it("groq 400 tool validation -> LLMMalformedOutputError, not the permanent LLMError", () => {
    const e = mapProviderError(
      { status: 400, message: "Tool call validation failed: tool call validation failed: attempted to call tool 'recall' which was not in request.tools" },
      "groq",
    );
    expect(e._tag).toBe("LLMMalformedOutputError");
    expect((e as { status?: number }).status).toBe(400);
    expect((e as { errorClass?: string }).errorClass).toBe("malformed_output");
  });

  it("input TPM -> LLMContextOverflowError with Requested/Limit as tokenCount/maxTokens", () => {
    const e = mapProviderError(
      { status: 413, message: "Request too large for model `qwen/qwen3.8-27b` in organization `org_x` service tier `on_demand` on input tokens per minute (ITPM): Limit 7000, Requested 9641, please reduce your message size and try again." },
      "groq",
    );
    expect(e._tag).toBe("LLMContextOverflowError");
    if (e._tag !== "LLMContextOverflowError") return;
    expect(e.errorClass).toBe("token_rate_exceeded");
    expect(e.tokenCount).toBe(9641);
    expect(e.maxTokens).toBe(7000);
  });

  it("output OTPM -> LLMError (not the prompt-compaction tag, not a retried rate limit)", () => {
    const e = mapProviderError(
      { status: 429, message: "429 Request too large for model `qwen/qwen3.8-27b` in organization `org_x` service tier `on_demand` on output tokens per minute (OTPM): Limit 1000, Requested 1174." },
      "groq",
    );
    expect(e._tag).toBe("LLMError");
    expect((e as { errorClass?: string }).errorClass).toBe("token_rate_exceeded");
  });
});

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
