import type { ChatSession, ChatTurn } from "$lib/stores/chat-store.js";
import type { ChatTotals } from "$lib/stores/chat-cost.js";
import type { ChatContext } from "$lib/stores/chat-store.js";
import type { ChatSubAgent } from "$lib/sub-agent-view.js";
import { sessionCostSummary } from "$lib/stores/chat-cost.js";
import { splitOfTurn } from "$lib/chat-token-usage.js";
import { estimateTokens } from "@reactive-agents/ui-core";

export interface RawMessage {
  readonly id: number;
  readonly role: "user" | "assistant";
  readonly ts: number;
  readonly tokens?: number;
  readonly content: string;
}

export interface SessionContextModel {
  readonly sessionName: string;
  readonly provider: string;
  readonly model: string;
  readonly contextLimit: number | null;
  readonly usagePct: number | null;
  readonly estimated: boolean;
  readonly totalTokens: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Per-half estimation flags (an absent provider half, or the in-flight call). */
  readonly inputEstimated: boolean;
  readonly outputEstimated: boolean;
  readonly splitComplete: boolean;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly cachePartial: boolean;
  /** Cache-adjusted billed tokens summed across calls that reported them. */
  readonly billedTokens: number;
  /** Hidden-reasoning tokens: provider-reported when available, else the trace estimate. */
  readonly reasoningTokens: number;
  /** True when `reasoningTokens` is the char/4 estimate, not a provider figure. */
  readonly reasoningEstimated: boolean;
  readonly thinkingTokens: number;
  /** Sub-agent spend, reported SEPARATELY and never rolled into the session totals above. */
  readonly subAgentCount: number;
  readonly subAgentTokens: number;
  readonly subAgentCostUsd: number;
  readonly subAgentCostKnown: boolean;
  readonly costUsd: number;
  readonly costKnown: boolean;
  readonly messageCount: number;
  readonly userCount: number;
  readonly assistantCount: number;
  readonly createdAt: number | null;
  readonly lastActivity: number | null;
  readonly rawMessages: readonly RawMessage[];
}

export interface BuildSessionContextInput {
  readonly session?: ChatSession;
  readonly totals?: ChatTotals;
  readonly turns: readonly ChatTurn[];
  readonly latestContext?: ChatContext;
}

export function buildSessionContext(input: BuildSessionContextInput): SessionContextModel {
  const { session, totals, turns, latestContext } = input;
  const cfg = (session?.agentConfig ?? {}) as Record<string, unknown>;
  const lastAssistant = [...turns].reverse().find((t) => t.role === "assistant");
  const provider = typeof cfg.provider === "string" && cfg.provider !== ""
    ? cfg.provider
    : (lastAssistant?.provider ?? "–");
  const model = typeof cfg.model === "string" && cfg.model !== ""
    ? cfg.model
    : (lastAssistant?.model ?? "–");

  const liveTotals = sessionCostSummary(totals, turns);
  const totalTokens = liveTotals.tokens;

  const streamingTurn = turns.find((t) => t.streaming);
  const streamingSplit = streamingTurn ? splitOfTurn(streamingTurn) : undefined;
  const liveInput = streamingSplit?.tokensIn ?? 0;
  const liveOutput = streamingSplit?.tokensOut ?? 0;
  const liveInEstimated = streamingSplit?.estimatedIn ?? false;
  const liveOutEstimated = streamingSplit?.estimatedOut ?? false;

  // Cache figures: sum across turns that report them. A turn that has tokens
  // but no per-call usage makes the total partial (~).
  let cacheRead = 0;
  let cacheWrite = 0;
  let cachePartial = false;
  let billed = 0;
  let reasoningReported = 0;
  for (const t of turns) {
    if (t.role !== "assistant") continue;
    if (t.tokensUsed > 0 && !t.usage) cachePartial = true;
    if (t.usage) {
      cacheRead += t.usage.cacheReadTokensIn;
      cacheWrite += t.usage.cacheCreationTokensIn;
      billed += t.usage.billedTokens;
      reasoningReported += t.usage.reasoningTokens;
    }
  }

  // Thinking estimate: sum thought text, estimateTokens. ~ by construction.
  let thoughtText = "";
  for (const t of turns) {
    for (const s of t.reasoningSteps ?? []) {
      if (typeof s.thought === "string") thoughtText += s.thought;
    }
  }
  const thinkingTokens = thoughtText.trim().length > 0 ? estimateTokens(thoughtText) : 0;

  const userCount = turns.filter((t) => t.role === "user").length;
  const assistantCount = turns.filter((t) => t.role === "assistant").length;

  const sub = subAgentSpend(turns);

  return {
    sessionName: session?.name ?? "–",
    provider,
    model,
    contextLimit: latestContext?.windowTokens ?? null,
    usagePct: latestContext?.utilizationPct !== undefined ? Math.round(latestContext.utilizationPct) : null,
    estimated: latestContext?.estimated === true,
    totalTokens,
    inputTokens: (totals?.tokensIn ?? 0) + liveInput,
    outputTokens: (totals?.tokensOut ?? 0) + liveOutput,
    inputEstimated: liveInEstimated || !(totals?.splitComplete ?? true),
    outputEstimated: liveOutEstimated || !(totals?.splitComplete ?? true),
    splitComplete: (totals?.splitComplete ?? true) && !streamingTurn,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    cachePartial,
    billedTokens: billed,
    reasoningTokens: reasoningReported > 0 ? reasoningReported : thinkingTokens,
    reasoningEstimated: reasoningReported === 0,
    thinkingTokens,
    subAgentCount: sub.count,
    subAgentTokens: sub.tokens,
    subAgentCostUsd: sub.costUsd,
    subAgentCostKnown: sub.costKnown,
    costUsd: totals?.costUsd ?? 0,
    costKnown: totals?.costKnown ?? true,
    messageCount: turns.length,
    userCount,
    assistantCount,
    createdAt: session?.createdAt ?? null,
    lastActivity: session?.lastUsedAt ?? null,
    rawMessages: turns.map((t) => ({
      id: t.id,
      role: t.role,
      ts: t.ts,
      tokens: t.role === "assistant" ? t.tokensUsed : undefined,
      content: t.content,
    })),
  };
}

export interface SubAgentSpend {
  readonly count: number;
  readonly tokens: number;
  readonly costUsd: number;
  readonly costKnown: boolean;
}

export function subAgentSpend(turns: readonly ChatTurn[]): SubAgentSpend {
  let count = 0;
  let tokens = 0;
  let costUsd = 0;
  let costKnown = true;

  const visit = (sa: ChatSubAgent): void => {
    count += 1;
    if (typeof sa.tokens === "number" && Number.isFinite(sa.tokens)) tokens += sa.tokens;
    if (typeof sa.costUsd === "number" && Number.isFinite(sa.costUsd)) costUsd += sa.costUsd;
    else costKnown = false;
    if (sa.status === "running") costKnown = false;
    for (const nested of sa.turn.subAgents ?? []) visit(nested);
  };

  for (const t of turns) {
    if (t.role !== "assistant") continue;
    for (const sa of t.subAgents ?? []) visit(sa);
  }

  return { count, tokens, costUsd, costKnown };
}