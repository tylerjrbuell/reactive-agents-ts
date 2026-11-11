// packages/trace/src/replay.ts

import { readFile } from "node:fs/promises"
import { isTraceEvent, type TraceEvent } from "./events"

export interface Trace {
  readonly runId: string
  readonly events: readonly TraceEvent[]
}

/**
 * Load a JSONL trace and parse it into a Trace object: from a file path, or
 * from JSONL text already in hand (`{ text }`, e.g. a trace a server read or
 * received). Parsing is {@link parseTrace}.
 *
 * @param source A `.jsonl` file path, or `{ text }` holding the JSONL itself.
 */
export async function loadTrace(source: string | { readonly text: string }): Promise<Trace> {
  return parseTrace(typeof source === "string" ? await readFile(source, "utf8") : source.text)
}

/**
 * Parse JSONL trace text into a Trace object. Synchronous and pure.
 * Each line must be valid JSON representing a TraceEvent; other lines are skipped.
 *
 * `isTraceEvent` checks the base fields, that `kind` is a known trace-event
 * kind, and that the fields that kind's payload requires are present (see
 * `REQUIRED_FIELDS_BY_KIND` in `events.ts`) — it does not validate nested
 * shapes or field types.
 *
 * @param text JSONL, one TraceEvent per line.
 */
export function parseTrace(text: string): Trace {
  // A run that is cut off (cell timeout) can flush its sink twice, writing every
  // event again; `seq` is unique within a run, so the first copy wins.
  const seen = new Set<string>()
  const events = text
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed: unknown = JSON.parse(line)
        if (!isTraceEvent(parsed)) return []
        const key = `${parsed.runId}:${parsed.seq}`
        if (seen.has(key)) return []
        seen.add(key)
        return [parsed]
      } catch {
        return []
      }
    })
  const runId = events[0]?.runId ?? "unknown"
  return { runId, events }
}

export interface TraceStats {
  readonly totalEvents: number
  readonly iterations: number
  readonly interventionsDispatched: number
  readonly interventionsSuppressed: number
  readonly maxEntropy: number
  readonly avgEntropy: number
  readonly toolCalls: number
  readonly durationMs: number
  readonly totalTokens: number
  // Diagnostic stats (Sprint 3.6)
  readonly llmExchanges: number
  readonly verifierVerdicts: number
  readonly verifierRejections: number
  readonly guardsFired: number
  readonly harnessSignalsInjected: number
  readonly stateSnapshots: number
}

/**
 * Compute summary statistics from a trace.
 * Aggregates entropy, interventions, tool calls, and completion metrics.
 */
export function traceStats(trace: Trace): TraceStats {
  let interventionsDispatched = 0
  let interventionsSuppressed = 0
  let maxEntropy = 0
  let entropySum = 0
  let entropyCount = 0
  let toolCalls = 0
  // Loop count sources, best first (see `iterations` below).
  let progressLoops = 0
  let lastProgressIter: number | undefined
  let maxSnapshotIter = -1
  let maxEntropyIter = -1
  let durationMs = 0
  let totalTokens = 0
  let llmExchanges = 0
  let verifierVerdicts = 0
  let verifierRejections = 0
  let guardsFired = 0
  let harnessSignalsInjected = 0
  let stateSnapshots = 0

  for (const ev of trace.events) {
    switch (ev.kind) {
      case "intervention-dispatched":
        interventionsDispatched++
        break
      case "intervention-suppressed":
        interventionsSuppressed++
        break
      case "entropy-scored":
        if (ev.composite > maxEntropy) maxEntropy = ev.composite
        if (ev.iter > maxEntropyIter) maxEntropyIter = ev.iter
        entropySum += ev.composite
        entropyCount++
        break
      case "tool-call-end":
        toolCalls++
        break
      case "run-completed":
        durationMs = ev.durationMs
        totalTokens = ev.totalTokens
        break
      case "llm-exchange":
        llmExchanges++
        break
      case "verifier-verdict":
        verifierVerdicts++
        if (!ev.verified) verifierRejections++
        break
      case "guard-fired":
        guardsFired++
        break
      case "harness-signal-injected":
        harnessSignalsInjected++
        break
      case "kernel-state-snapshot":
        stateSnapshots++
        if (ev.iter > maxSnapshotIter) maxSnapshotIter = ev.iter
        break
      case "iteration-exit":
        // A repeated report of the same iteration is one loop.
        if (ev.iter !== lastProgressIter) progressLoops++
        lastProgressIter = ev.iter
        break
      default:
        break
    }
  }

  // Loops, in the event stream's numbering (core `ReasoningIterationProgress`,
  // 1-based, one per finished loop). Canonical: the `iteration-exit` records of
  // those events. Traces recorded before they were kept fall back to the larger
  // of the highest kernel snapshot `iter` (the kernel's post-increment
  // `state.iteration`, the same numbering) and the 0-based entropy iteration + 1
  // (a run whose only snapshot is the opening one): 44/45 Cortex runs with a
  // stored event stream agreed, 2026-11-11. The old `max(iter) + 1` also took
  // snapshots as 0-based and counted one loop too many on every kernel run.
  const iterations =
    progressLoops > 0 ? progressLoops : Math.max(0, maxSnapshotIter, maxEntropyIter + 1)

  return {
    totalEvents: trace.events.length,
    iterations,
    interventionsDispatched,
    interventionsSuppressed,
    maxEntropy,
    avgEntropy: entropyCount > 0 ? entropySum / entropyCount : 0,
    toolCalls,
    durationMs,
    totalTokens,
    llmExchanges,
    verifierVerdicts,
    verifierRejections,
    guardsFired,
    harnessSignalsInjected,
    stateSnapshots,
  }
}
