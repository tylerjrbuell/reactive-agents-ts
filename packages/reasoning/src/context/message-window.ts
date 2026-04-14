import type { KernelMessage } from "../strategies/kernel/kernel-state.js";

// ── applyMessageWindowWithCompact ─────────────────────────────────────────────

/** Tier-adaptive full-turn count for keeping recent turns at full content. */
const KEEP_FULL_TURNS_BY_TIER: Record<string, number> = {
  local: 2,
  mid: 3,
  large: 5,
  frontier: 8,
}

/**
 * Sliding message window.
 *
 * Only fires when estimated tokens exceed 75% of maxTokens. When over budget:
 *   - Keep the first user message (the original task) as the API cache prefix.
 *   - Keep the most recent N turns in full (N tier-adaptive).
 *   - Replace older turns with a compact summary: `[Prior: called X → brief]`.
 *
 * Recall is intentionally off the critical path — the Observations section in
 * the system prompt (populated from step.metadata.extractedFact) is the safety
 * net for distilled data from older turns.
 */
export function applyMessageWindowWithCompact(
  messages: readonly KernelMessage[],
  tier: string,
  maxTokens: number,
  keepFullTurnsOverride?: number,
): KernelMessage[] {
  const keepFullTurns = keepFullTurnsOverride ?? KEEP_FULL_TURNS_BY_TIER[tier] ?? 3

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

  // ── Estimate tokens (1 char ≈ 0.25 tokens) ─────────────────────────────
  const mutable = [...messages] as KernelMessage[]
  const estimatedTokens = mutable.reduce((sum, m) => {
    const c = m.content ?? ""
    return sum + Math.ceil((typeof c === "string" ? c : JSON.stringify(c)).length / 4)
  }, 0)

  const budget = Math.floor(maxTokens * 0.75)
  if (estimatedTokens <= budget) {
    return mutable
  }

  // ── Over budget: keep first user message + recent N turns ──────────────
  const firstUser = mutable.find((m) => m.role === "user")
  const recentTurnIdxs = new Set(
    turns
      .slice(-keepFullTurns)
      .flatMap((t) => [t.assistantIdx, ...t.resultIdxs]),
  )

  const oldSummaryParts = turns
    .slice(0, Math.max(0, turns.length - keepFullTurns))
    .map((t) => {
      const assistantMsg = mutable[t.assistantIdx]!
      const toolNames = (assistantMsg.role === "assistant" && assistantMsg.toolCalls
        ? assistantMsg.toolCalls
        : [])
        .map((tc) => tc.name)
        .join(", ")
      const snippet = t.resultIdxs
        .map((i) => {
          const c = mutable[i]?.content ?? ""
          return typeof c === "string" ? c.slice(0, 60) : ""
        })
        .join("; ")
      return toolNames ? `called ${toolNames} → ${snippet}` : ""
    })
    .filter(Boolean)

  const windowed: KernelMessage[] = []
  if (firstUser) windowed.push(firstUser)
  if (oldSummaryParts.length > 0) {
    windowed.push({ role: "user", content: `[Prior: ${oldSummaryParts.join(" | ")}]` })
  }
  for (let i = 0; i < mutable.length; i++) {
    if (recentTurnIdxs.has(i)) windowed.push(mutable[i]!)
  }

  return windowed
}
