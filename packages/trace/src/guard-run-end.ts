// File: src/guard-run-end.ts
//
// Did a guard's `terminate` event end the run? Since Plan 8 item 3 a soft guard
// (stall, loop, low-delta, oracle force, early stop, quota) only PROPOSES an
// exit; the kernel's exit gate decides, and records that decision as an
// `exit_gate` guard-fired event with `metadata.proposedBy` + `gateDecision`.
//
// Two trace generations exist:
//   - before 2026-11-06 the proposing guard emitted outcome "terminate" BEFORE
//     the gate decided, so a denied exit (`deny-once`) still reads "terminate";
//   - since then the gate emits the guard's event after deciding: "terminate"
//     only for accept / handoff, "block" for a denial.
// Reading the paired `exit_gate` event answers both the same way. A guard event
// with no paired gate event (traces older than the gate, or harness exits that
// never go through a proposal) keeps its own outcome.

/** The minimal event shape this reader needs (typed trace events and raw JSONL records both fit). */
export interface GuardEventLike {
  readonly kind?: unknown
  readonly guard?: unknown
  readonly outcome?: unknown
  readonly iter?: unknown
  readonly metadata?: unknown
}

/** Gate decisions that end the run. `deny-once` / `deny` keep it going. */
const RUN_ENDING_DECISIONS: ReadonlySet<string> = new Set(["accept", "handoff"])

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object"

const metaField = (e: GuardEventLike, key: string): unknown => (isRecord(e.metadata) ? e.metadata[key] : undefined)

/**
 * The exit gate's decision for the guard event at `index`: the first `exit_gate`
 * event after it in the same iteration whose `proposedBy` is that guard.
 * Undefined when none exists.
 */
export function gateDecisionFor(events: readonly GuardEventLike[], index: number): string | undefined {
  const e = events[index]
  if (e === undefined) return undefined
  for (let i = index + 1; i < events.length; i++) {
    const g = events[i]!
    if (g.kind !== "guard-fired" || g.guard !== "exit_gate") continue
    if (g.iter !== e.iter || metaField(g, "proposedBy") !== e.guard) continue
    const decision = metaField(g, "gateDecision")
    return typeof decision === "string" ? decision : undefined
  }
  return undefined
}

/**
 * True when the guard-fired event at `index` ended the run: the paired exit gate
 * accepted or handed off its proposal. Without a paired gate event, the event's
 * own outcome decides (`terminate` = ended) — this covers guards that never
 * propose and the `exit_gate` event itself (its handoff reads `terminate`).
 */
export function guardEndedRun(events: readonly GuardEventLike[], index: number): boolean {
  const e = events[index]
  if (e === undefined || e.kind !== "guard-fired") return false
  const decision = gateDecisionFor(events, index)
  if (decision !== undefined) return RUN_ENDING_DECISIONS.has(decision)
  return e.outcome === "terminate"
}

/**
 * Guard-fired events that ended the run, optionally limited to `guards`.
 *
 * @param events - The trace's events in order (any shape with `kind`/`guard`/`outcome`/`iter`/`metadata`).
 * @param guards - Guard names to keep; omit for every guard.
 * @returns The run-ending guard events, in trace order.
 */
export function runEndingGuardEvents<E extends GuardEventLike>(
  events: readonly E[],
  guards?: readonly string[],
): E[] {
  const out: E[] = []
  events.forEach((e, i) => {
    if (e.kind !== "guard-fired") return
    if (guards !== undefined && !guards.includes(typeof e.guard === "string" ? e.guard : "")) return
    if (guardEndedRun(events, i)) out.push(e)
  })
  return out
}
