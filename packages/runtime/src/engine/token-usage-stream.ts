import type { AgentStreamEvent } from "../stream-types.js";

/**
 * Project a core-bus `LLMRequestCompleted` event onto the public stream's
 * `TokenUsage` shape. Returns `undefined` for another task or a malformed
 * payload.
 *
 * Honesty rule: the provider's split wins. When either half is missing the
 * event is marked `estimated` and the missing half stays absent — no 70/30
 * fallback is computed here. Cache figures are copied only when numeric.
 */
export function toTokenUsageStreamEvent(
  busEvent: unknown,
  taskId: string,
): AgentStreamEvent | undefined {
  const e = busEvent as {
    taskId?: unknown;
    requestId?: unknown;
    tokensUsed?: unknown;
    tokensIn?: unknown;
    tokensOut?: unknown;
    cacheReadTokensIn?: unknown;
    cacheCreationTokensIn?: unknown;
    billedTokens?: unknown;
    reasoningTokens?: unknown;
    model?: unknown;
    provider?: unknown;
    durationMs?: unknown;
    firstTokenMs?: unknown;
    estimatedCost?: unknown;
    iteration?: unknown;
  };
  if (String(e.taskId ?? "") !== taskId) return undefined;
  if (typeof e.tokensUsed !== "number" || !Number.isFinite(e.tokensUsed)) return undefined;
  if (typeof e.requestId !== "string" || e.requestId.length === 0) return undefined;

  const tokensIn = typeof e.tokensIn === "number" ? e.tokensIn : undefined;
  const tokensOut = typeof e.tokensOut === "number" ? e.tokensOut : undefined;

  return {
    _tag: "TokenUsage",
    callId: e.requestId,
    tokensTotal: e.tokensUsed,
    ...(tokensIn !== undefined ? { tokensIn } : {}),
    ...(tokensOut !== undefined ? { tokensOut } : {}),
    estimated: tokensIn === undefined || tokensOut === undefined,
    ...(typeof e.cacheReadTokensIn === "number"
      ? { cacheReadTokensIn: e.cacheReadTokensIn }
      : {}),
    ...(typeof e.cacheCreationTokensIn === "number"
      ? { cacheCreationTokensIn: e.cacheCreationTokensIn }
      : {}),
    ...(typeof e.billedTokens === "number" ? { billedTokens: e.billedTokens } : {}),
    ...(typeof e.reasoningTokens === "number" ? { reasoningTokens: e.reasoningTokens } : {}),
    model: typeof e.model === "string" ? e.model : "",
    provider: typeof e.provider === "string" ? e.provider : "",
    durationMs: typeof e.durationMs === "number" ? e.durationMs : 0,
    // Time to first token: forwarded only when numeric, so streamed turns can
    // report a true generation rate (not the duration-wide lower bound).
    ...(typeof e.firstTokenMs === "number" && Number.isFinite(e.firstTokenMs)
      ? { firstTokenMs: e.firstTokenMs }
      : {}),
    costUsd: typeof e.estimatedCost === "number" ? e.estimatedCost : 0,
    ...(typeof e.iteration === "number" ? { iteration: e.iteration } : {}),
  };
}
