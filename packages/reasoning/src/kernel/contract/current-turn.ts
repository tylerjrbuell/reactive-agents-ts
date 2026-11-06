// Current-turn extraction — the ONE place that knows how chat callers inline
// prior conversation into the task string.
//
// Defect this closes (2026-11-03): Cortex/gateway chat prepend the whole
// conversation to the task text. The RunContract compiler then derived
// requirements (paths, action needs, enumeration, horizon) from PRIOR turns,
// which stayed outstanding forever so the terminal gate could not be satisfied.
// `deriveConditions` already scoped itself to the current turn; the contract
// compiler did not. Both now share this function.
//
// Callers' wire formats (the only text markers that exist; a typed envelope
// field would need runtime/** edits — out of kernel authority):
//   - `--- Current message ---` — runtime `withHistoryBlock` (reactive-agent.ts)
//   - `New request:`            — chat contextSummary composition
//   - gateway `buildEnrichedInstruction`: "You are in a live conversation with
//     <sender> on <platform>.\n\nUser: <message>" after a history block.
// The LAST marker wins (they compose: withHistoryBlock wraps the chat string).

/** The slice of the task text that is the user's current ask. */
export interface CurrentTurn {
  /** Text of the current turn (the whole task when no marker is present). */
  readonly text: string;
  /** Offset of `text` within the ORIGINAL task string. */
  readonly offset: number;
  /** True when prior-conversation text was removed ahead of `text`. */
  readonly historyStripped: boolean;
}

const LITERAL_MARKERS = ["New request:", "--- Current message ---"] as const;
const GATEWAY_MARKER = /You are in a live conversation with [^\n]*\n\nUser: /g;

/**
 * Harness-injected context that can trail the user's message: the standing
 * frame's carried prior context and the fenced recalled-memory block
 * (strategies/memory-fence.ts). Cortex traces carried both AFTER the current
 * message, and memory text ("files … issues") compiled a phantom
 * `action:create-ticket` (truthfulness audit 2026-11-06, item 1). Neither is
 * the user's ask, so the current turn ends where the first one begins.
 */
const TRAILING_CONTEXT_MARKERS = [
  "Prior context (from earlier work on this task):",
  "Relevant Memory (retrieved data",
  "<retrieved_memory>",
] as const;

/** Offset where injected trailing context starts at or after `from`, else `task.length`. */
function trailingContextStart(task: string, from: number): number {
  let cut = task.length;
  for (const marker of TRAILING_CONTEXT_MARKERS) {
    const idx = task.indexOf(marker, from);
    if (idx >= 0) cut = Math.min(cut, idx);
  }
  return cut;
}

/**
 * Locate the current turn inside a (possibly history-prefixed) task string.
 * Pure, deterministic. No marker present ⇒ `{ text: task, offset: 0 }`
 * (byte-identical to the pre-fix compile input). Injected trailing context
 * (prior context, recalled memory) is cut from the end in every case.
 */
export function extractCurrentTurn(task: string): CurrentTurn {
  let end = -1;
  for (const marker of LITERAL_MARKERS) {
    const idx = task.lastIndexOf(marker);
    if (idx >= 0) end = Math.max(end, idx + marker.length);
  }
  if (task.includes("--- Conversation history ---")) {
    for (const m of task.matchAll(GATEWAY_MARKER)) {
      end = Math.max(end, (m.index ?? 0) + m[0].length);
    }
  }
  const start = Math.max(end, 0);
  const cut = trailingContextStart(task, start);
  if (end < 0 && cut === task.length) return { text: task, offset: 0, historyStripped: false };
  const text = cut < task.length ? task.slice(start, cut).trimEnd() : task.slice(start);
  return { text, offset: start, historyStripped: end >= 0 };
}
