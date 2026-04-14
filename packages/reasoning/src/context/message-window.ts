import type { KernelMessage } from "../strategies/kernel/kernel-state.js";

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
    if (msg.role === "assistant" && msg.toolCalls?.length) {
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
      const id = msg.toolCallId
      if (!id) continue
      if (opts.frozenToolResultIds.has(id)) continue // never re-strip frozen

      const content = msg.content
      if (content.length > 200) {
        const recallKey = msg.storedKey ?? id;
        mutable[idx] = {
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
    const c = m.content ?? ""
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
    const toolNames = (assistantMsg.role === "assistant" && assistantMsg.toolCalls ? assistantMsg.toolCalls : [])
      .map((tc) => tc.name)
      .join(", ")
    const snippet = t.resultIdxs
      .map((i) => {
        const c = mutable[i]?.content ?? ""
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
