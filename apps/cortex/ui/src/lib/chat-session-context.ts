import type { ChatSession, ChatTurn } from "$lib/stores/chat-store.js";
import type { ChatTotals } from "$lib/stores/chat-cost.js";
import type { ChatContext } from "$lib/stores/chat-store.js";
import { sessionCostSummary } from "$lib/stores/chat-cost.js";
import { splitOfTurn } from "$lib/chat-token-usage.js";
import { charsToTokens } from "@reactive-agents/ui-core";

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
  readonly thinkingTokens: number;
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
  for (const t of turns) {
    if (t.role !== "assistant") continue;
    if (t.tokensUsed > 0 && !t.usage) cachePartial = true;
    if (t.usage) {
      cacheRead += t.usage.cacheReadTokensIn;
      cacheWrite += t.usage.cacheCreationTokensIn;
    }
  }

  // Thinking estimate: sum thought lengths, charsToTokens. ~ by construction.
  let thoughtChars = 0;
  for (const t of turns) {
    for (const s of t.reasoningSteps ?? []) {
      if (typeof s.thought === "string") thoughtChars += s.thought.length;
    }
  }
  const thinkingTokens = thoughtChars > 0 ? charsToTokens(thoughtChars) : 0;

  const userCount = turns.filter((t) => t.role === "user").length;
  const assistantCount = turns.filter((t) => t.role === "assistant").length;

  return {
    sessionName: session?.name ?? "–",
    provider,
    model,
    contextLimit: latestContext?.windowTokens ?? null,
    usagePct: latestContext ? Math.round(latestContext.utilizationPct) : null,
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
    thinkingTokens,
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