import type { KernelMessage } from "../strategies/kernel/kernel-state.js";
import type { ContextProfile } from "./context-profile.js";

/** Full-turn window sizes per model tier. */
const FULL_TURNS_BY_TIER: Record<string, number> = {
  local: 2,
  mid: 3,
  large: 5,
  frontier: 8,
};

/** Rough token estimate: 4 chars ≈ 1 token */
function estimateTokens(messages: readonly KernelMessage[]): number {
  return messages.reduce((sum, m) => {
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    const toolCallTokens = "toolCalls" in m && m.toolCalls
      ? JSON.stringify(m.toolCalls).length / 4
      : 0;
    return sum + content.length / 4 + toolCallTokens;
  }, 0);
}

/** Split messages into assistant+tool_result groups (turns) */
function groupTurns(messages: readonly KernelMessage[]): KernelMessage[][] {
  const groups: KernelMessage[][] = [];
  let current: KernelMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "assistant") {
      if (current.length > 0) groups.push(current);
      current = [msg];
    } else if (msg.role === "tool_result") {
      current.push(msg);
    }
    // user messages are handled separately
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** Summarize old turns into a single compressed user message */
function summarizeTurns(turns: KernelMessage[][]): KernelMessage {
  const summaryParts = turns.map((turn) => {
    const assistant = turn.find(m => m.role === "assistant");
    const toolCalls = "toolCalls" in (assistant ?? {}) ? (assistant as any).toolCalls : undefined;
    if (toolCalls && toolCalls.length > 0) {
      const toolNames = toolCalls.map((tc: any) => tc.name).join(", ");
      const results = turn
        .filter(m => m.role === "tool_result")
        .map(m => m.content.slice(0, 100))
        .join("; ");
      return `called ${toolNames} → ${results}`;
    }
    return (assistant?.content ?? "").slice(0, 100);
  }).filter(Boolean);

  return {
    role: "user",
    content: `[Summary of prior work: ${summaryParts.join(" | ")}]`,
  };
}

/**
 * Apply sliding window compaction to keep messages within token budget.
 * - Always keeps first user message (the task)
 * - Keeps last N full turns in detail (tier-adaptive)
 * - Summarizes older turns into one compact message
 */
export function applyMessageWindow(
  messages: readonly KernelMessage[],
  profile: ContextProfile,
): readonly KernelMessage[] {
  if (messages.length === 0) return messages;

  const budgetPercent = profile.contextBudgetPercent ?? 80;
  // Use a reasonable token budget based on budget percent; default context ~8192 tokens
  const budget = (8192 * budgetPercent) / 100;
  const currentTokens = estimateTokens(messages);

  if (currentTokens <= budget) return messages;

  const tier = profile.tier ?? "mid";
  const fullTurns = FULL_TURNS_BY_TIER[tier] ?? 3;

  const [firstMsg, ...rest] = messages;
  if (!firstMsg) return messages;

  const turns = groupTurns(rest);
  if (turns.length <= fullTurns) return messages;

  const oldTurns = turns.slice(0, turns.length - fullTurns);
  const recentTurns = turns.slice(turns.length - fullTurns);

  const summaryMsg = summarizeTurns(oldTurns);
  const recentMessages = recentTurns.flat();

  return [firstMsg, summaryMsg, ...recentMessages];
}

// ── applyMessageWindowWithCompact ─────────────────────────────────────────────

/** Tier-adaptive full-turn count for keeping recent turns at full content. */
const KEEP_FULL_TURNS_BY_TIER: Record<string, number> = {
  local: 2,
  mid: 3,
  large: 5,
  frontier: 8,
}

export interface CompactOptions {
  readonly tier: string
  readonly maxTokens: number
  readonly frozenToolResultIds: ReadonlySet<string>
  readonly keepFullTurns?: number
}

export interface CompactResult {
  readonly messages: readonly KernelMessage[]
  readonly newlyFrozenIds: ReadonlySet<string>
}

/**
 * Two-pass message compaction:
 *
 * Pass 1 — Microcompact: strip content of tool_result messages older than
 *           keepFullTurns turns, unless ID is in frozenToolResultIds.
 *           Returns newlyFrozenIds for the caller to persist in state.
 *
 * Pass 2 — Sliding window: keep first user message (task) + last N turns full.
 *           Older turns get summarized into "[Prior work: called X → snippet]".
 *           Only fires when over budget.
 */
export function applyMessageWindowWithCompact(
  messages: readonly KernelMessage[],
  opts: CompactOptions,
): CompactResult {
  const keepFullTurns = opts.keepFullTurns ?? KEEP_FULL_TURNS_BY_TIER[opts.tier] ?? 3

  // ── Identify turn groups (assistant+tool_result pairs) ──────────────────
  type TurnGroup = { assistantIdx: number; resultIdxs: number[] }
  const turns: TurnGroup[] = []
  let currentTurn: TurnGroup | null = null

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!
    if (msg.role === "assistant" && "toolCalls" in msg && (msg as any).toolCalls?.length) {
      if (currentTurn) turns.push(currentTurn)
      currentTurn = { assistantIdx: i, resultIdxs: [] }
    } else if (msg.role === "tool_result" && currentTurn) {
      currentTurn.resultIdxs.push(i)
    }
  }
  if (currentTurn) turns.push(currentTurn)

  // ── Pass 1: Microcompact old turns ──────────────────────────────────────
  const mutable = [...messages] as KernelMessage[]
  const newlyFrozenIds = new Set<string>()
  const oldTurns = turns.slice(0, Math.max(0, turns.length - keepFullTurns))

  for (const turn of oldTurns) {
    for (const idx of turn.resultIdxs) {
      const msg = mutable[idx]!
      if (msg.role !== "tool_result") continue
      const id = (msg as any).toolCallId as string | undefined
      if (!id) continue
      if (opts.frozenToolResultIds.has(id)) continue // never re-strip frozen

      const content = (msg as any).content as string
      if (content.length > 200) {
        const recallKey = (msg as any).storedKey ?? id;
        ;(mutable[idx] as any) = {
          ...msg,
          content: `[${content.length} chars — use recall("${recallKey}") to retrieve]`,
        }
        newlyFrozenIds.add(id)
      }
    }
  }

  // ── Pass 2: Sliding window (only when over budget) ─────────────────────
  // Estimate: 1 char ≈ 0.25 tokens
  const estimatedTokens = mutable.reduce((sum, m) => {
    const c = (m as any).content ?? ""
    return sum + Math.ceil((typeof c === "string" ? c : JSON.stringify(c)).length / 4)
  }, 0)

  const budget = Math.floor(opts.maxTokens * 0.75)
  if (estimatedTokens <= budget) {
    return { messages: mutable, newlyFrozenIds }
  }

  // Over budget: keep first user message + recent N turns
  const firstUser = mutable.find((m) => m.role === "user")
  const recentTurnIdxs = new Set(
    turns
      .slice(-keepFullTurns)
      .flatMap((t) => [t.assistantIdx, ...t.resultIdxs]),
  )

  const oldSummaryParts = turns.slice(0, Math.max(0, turns.length - keepFullTurns)).map((t) => {
    const assistantMsg = mutable[t.assistantIdx]!
    const toolNames = ("toolCalls" in assistantMsg ? (assistantMsg as any).toolCalls ?? [] : [])
      .map((tc: any) => tc.name)
      .join(", ")
    const snippet = t.resultIdxs
      .map((i) => {
        const c = (mutable[i] as any)?.content ?? ""
        return typeof c === "string" ? c.slice(0, 60) : ""
      })
      .join("; ")
    return toolNames ? `called ${toolNames} → ${snippet}` : ""
  }).filter(Boolean)

  const windowed: KernelMessage[] = []
  if (firstUser) windowed.push(firstUser)
  if (oldSummaryParts.length > 0) {
    windowed.push({ role: "user", content: `[Prior work: ${oldSummaryParts.join(" | ")}]` })
  }
  for (let i = 0; i < mutable.length; i++) {
    if (recentTurnIdxs.has(i)) windowed.push(mutable[i]!)
  }

  return { messages: windowed, newlyFrozenIds }
}
