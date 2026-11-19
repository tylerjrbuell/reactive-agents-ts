// packages/llm-provider/src/capability-learned.ts
//
// Learn a model's real limit from a provider error that states it.
//
// A hosted provider that rejects a request as too long usually says the limit
// it enforced ("prompt is too long: 213462 tokens > 200000 maximum"). For a
// model with no static row and no discovery answer (every unknown OpenAI
// model; any provider whose discovery was offline), that sentence is the only
// place the real number appears. `mapProviderError` hands each mapped failure
// here; a stated limit is written through the provider-reported tier
// (capability-reported.ts), so the next synchronous `resolveCapability` (the
// next kernel iteration, the next build) runs on it instead of the provisional
// guess. Static, probe, cache and user rows still win over it.
//
// Nothing is retried here: the error still fails the call (the kernel's
// context-overflow recovery shrinks and re-sends). The learned limit is
// observable three ways: on the mapped error (`learnedLimit`), through
// `learnedCapabilityLimitFor`, and in the resolved capability itself.
//
// Patterns (provider docs / observed bodies; same fixtures as error-class.ts):
//   anthropic  window: "prompt is too long: N tokens > M maximum"
//              output: "max_tokens: N > M, which is the maximum allowed number
//                       of output tokens for <model>"
//   openai-compatible (openai, groq, xai, litellm)
//              window: "maximum context length is M tokens"
//              output: "supports at most M completion tokens"
//   gemini     window: "input token count (N) exceeds the maximum number of
//                       tokens allowed (M)"
// LiteLLM relays its upstream's text, so it tries every pattern. A per-minute
// token budget ("Limit N, Requested M") is a rate, not a model limit, and is
// never learned (the caller passes only `context_overflow` / `invalid_param`).

import { registerReportedModelMetadata, reportedModelMetadataFor } from "./capability-reported.js";
import type { LLMErrorClass } from "./error-class.js";

/** A limit a provider stated in an error message. */
export interface StatedLimit {
  /** `context-window`: input/context tokens. `max-output`: completion tokens. */
  readonly kind: "context-window" | "max-output";
  /** The limit, in tokens. */
  readonly tokens: number;
}

/** A stated limit, attributed to the model it was learned for. */
export interface LearnedCapabilityLimit extends StatedLimit {
  readonly provider: string;
  readonly model: string;
}

interface LimitPattern {
  readonly kind: StatedLimit["kind"];
  /** Group 1 is the limit. */
  readonly re: RegExp;
}

const ANTHROPIC: readonly LimitPattern[] = [
  { kind: "context-window", re: /prompt is too long:\s*[\d,]+\s*tokens?\s*>\s*([\d,]+)\s*maximum/i },
  {
    kind: "max-output",
    re: /max_tokens:\s*[\d,]+\s*>\s*([\d,]+),?\s*which is the maximum allowed number of output tokens/i,
  },
];

const OPENAI_COMPAT: readonly LimitPattern[] = [
  { kind: "context-window", re: /maximum context length is\s*([\d,]+)\s*tokens/i },
  { kind: "max-output", re: /supports at most\s*([\d,]+)\s*completion tokens/i },
];

const GEMINI: readonly LimitPattern[] = [
  {
    kind: "context-window",
    re: /input token count\s*\(?[\d,]+\)?\s*exceeds the maximum number of tokens allowed\s*\(?([\d,]+)\)?/i,
  },
];

const PATTERNS: Readonly<Record<string, readonly LimitPattern[]>> = {
  anthropic: ANTHROPIC,
  openai: OPENAI_COMPAT,
  groq: OPENAI_COMPAT,
  xai: OPENAI_COMPAT,
  gemini: GEMINI,
  litellm: [...OPENAI_COMPAT, ...ANTHROPIC, ...GEMINI],
};

/**
 * Parse the limit a provider stated in an error message.
 *
 * @param provider - provider id (selects that provider's message shapes)
 * @param message - the provider's one-line reason
 * @returns the stated limit, or `undefined` when none was stated
 */
export function parseStatedLimit(provider: string, message: string): StatedLimit | undefined {
  for (const p of PATTERNS[provider] ?? []) {
    const m = message.match(p.re);
    const tokens = m?.[1] !== undefined ? Number(m[1].replace(/,/g, "")) : NaN;
    if (Number.isSafeInteger(tokens) && tokens > 0) return { kind: p.kind, tokens };
  }
  return undefined;
}

const learned = new Map<string, LearnedCapabilityLimit[]>();
const keyOf = (provider: string, model: string): string => `${provider}/${model}`;

/**
 * Learn from one mapped provider failure: when the message states a limit,
 * write it through the provider-reported tier and remember it.
 *
 * Only `context_overflow` (window) and `invalid_param` (output limit) failures
 * are read; every other class returns `undefined` without parsing.
 *
 * @param provider - provider id
 * @param model - model id the request was sent with; nothing is learned without one
 * @param errorClass - the failure's class (see error-class.ts)
 * @param message - the provider's one-line reason
 * @returns the learned limit, or `undefined`
 */
export function learnLimitFromProviderError(
  provider: string,
  model: string | undefined,
  errorClass: LLMErrorClass,
  message: string,
): LearnedCapabilityLimit | undefined {
  if (model === undefined || model.length === 0) return undefined;
  if (errorClass !== "context_overflow" && errorClass !== "invalid_param") return undefined;
  const stated = parseStatedLimit(provider, message);
  if (stated === undefined) return undefined;
  // An output limit inside an overflow message (or the reverse) is not trusted.
  if ((stated.kind === "context-window") !== (errorClass === "context_overflow")) return undefined;

  const prior = reportedModelMetadataFor(provider, model) ?? {};
  registerReportedModelMetadata(provider, model, {
    ...prior,
    ...(stated.kind === "context-window"
      ? { maxContextTokens: stated.tokens }
      : { maxOutputTokens: stated.tokens }),
  });
  const entry: LearnedCapabilityLimit = { provider, model, ...stated };
  const key = keyOf(provider, model);
  learned.set(key, [...(learned.get(key) ?? []).filter((l) => l.kind !== stated.kind), entry]);
  return entry;
}

/**
 * Limits learned from provider errors for `(provider, model)` in this process,
 * one per kind (the latest wins).
 *
 * @param provider - provider id
 * @param model - model id
 */
export function learnedCapabilityLimitFor(
  provider: string,
  model: string,
): readonly LearnedCapabilityLimit[] {
  return learned.get(keyOf(provider, model)) ?? [];
}

/** Test seam: forgets every learned limit (the reported tier has its own reset). */
export function _resetLearnedLimitsForTesting(): void {
  learned.clear();
}
