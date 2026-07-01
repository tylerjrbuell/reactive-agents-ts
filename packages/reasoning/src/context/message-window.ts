import type { KernelMessage } from "../kernel/state/kernel-state.js";

// ── applyMessageWindowWithCompact ─────────────────────────────────────────────

/** Tier-adaptive full-turn count for keeping recent turns at full content. */
const KEEP_FULL_TURNS_BY_TIER: Record<string, number> = {
  local: 2,
  mid: 3,
  large: 5,
  frontier: 8,
}

/**
 * Rough chars-per-token used for the compaction trigger estimate. A coarse
 * heuristic (real BPE varies by content) — matches CHARS_PER_TOKEN in
 * tool-formatting.ts. Underestimates dense code/JSON, so treat the trigger as a
 * lower bound, not an exact budget.
 */
const CHARS_PER_TOKEN = 4

/** Fraction of maxTokens at which the sliding window begins compacting. */
const COMPACTION_THRESHOLD = 0.75

/** Max chars of a summarized tool-result snippet in the [Prior: ...] fold. */
const SUMMARY_SNIPPET_CHARS = 80

/** Collapse whitespace and truncate at a word boundary for the fold summary. */
function briefSnippet(text: string, max = SUMMARY_SNIPPET_CHARS): string {
  const oneLine = text.replace(/\s+/g, " ").trim()
  if (oneLine.length <= max) return oneLine
  const cut = oneLine.slice(0, max)
  const lastSpace = cut.lastIndexOf(" ")
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…"
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
    return sum + Math.ceil((typeof c === "string" ? c : JSON.stringify(c)).length / CHARS_PER_TOKEN)
  }, 0)

  const budget = Math.floor(maxTokens * COMPACTION_THRESHOLD)
  if (estimatedTokens <= budget) {
    return mutable
  }

  // ── Over budget: keep first user message + recent N turns ──────────────
  // The recent window is an INDEX RANGE (everything from the earliest kept turn
  // onward), not just the grouped assistant/tool_result indices. This preserves
  // ungrouped messages interleaved in the recent region — mid-thread user
  // clarifications and assistant final-answer text that belong to no turn group
  // would otherwise be silently dropped.
  const firstUserIdx = mutable.findIndex((m) => m.role === "user")
  const recentTurns = turns.slice(-keepFullTurns)
  const cutoffIdx = recentTurns.length > 0 ? recentTurns[0]!.assistantIdx : mutable.length

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
          return typeof c === "string" ? briefSnippet(c) : ""
        })
        .filter(Boolean)
        .join("; ")
      return toolNames ? `called ${toolNames} → ${snippet}` : ""
    })
    .filter(Boolean)

  // Ungrouped USER messages before the cutoff carry instructions (e.g. "only
  // use USD") — preserve them verbatim rather than folding into the lossy
  // summary. Assistant chatter in the old region is dropped; the [Prior] summary
  // and the Observations section stand in for older tool work.
  const preservedOldUsers: KernelMessage[] = []
  for (let i = 0; i < cutoffIdx; i++) {
    if (i === firstUserIdx) continue
    const m = mutable[i]!
    if (m.role === "user") preservedOldUsers.push(m)
  }

  const windowed: KernelMessage[] = []
  // firstUser is added explicitly only when it sits before the recent window;
  // if it falls inside the recent range the range loop below includes it.
  if (firstUserIdx >= 0 && firstUserIdx < cutoffIdx) windowed.push(mutable[firstUserIdx]!)
  if (oldSummaryParts.length > 0) {
    windowed.push({ role: "user", content: `[Prior: ${oldSummaryParts.join(" | ")}]` })
  }
  for (const u of preservedOldUsers) windowed.push(u)
  for (let i = cutoffIdx; i < mutable.length; i++) windowed.push(mutable[i]!)

  return windowed
}
