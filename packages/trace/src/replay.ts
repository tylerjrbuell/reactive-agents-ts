// packages/trace/src/replay.ts

import { readFile } from "node:fs/promises"
import type { TraceEvent } from "./events"

export interface Trace {
  readonly runId: string
  readonly events: readonly TraceEvent[]
}

/**
 * Load a JSONL trace file and parse it into a Trace object.
 * Each line must be valid JSON representing a TraceEvent.
 */
export async function loadTrace(path: string): Promise<Trace> {
  const text = await readFile(path, "utf8")
  const events = text
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as TraceEvent]
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
  readonly toolCalls: number
  readonly durationMs: number
  readonly totalTokens: number
}

/**
 * Compute summary statistics from a trace.
 * Aggregates entropy, interventions, tool calls, and completion metrics.
 */
export function traceStats(trace: Trace): TraceStats {
  let interventionsDispatched = 0
  let interventionsSuppressed = 0
  let maxEntropy = 0
  let toolCalls = 0
  let iterations = 0
  let durationMs = 0
  let totalTokens = 0

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
        if (ev.iter > iterations) iterations = ev.iter
        break
      case "tool-call-end":
        toolCalls++
        break
      case "run-completed":
        durationMs = ev.durationMs
        totalTokens = ev.totalTokens
        break
      default:
        break
    }
  }

  return {
    totalEvents: trace.events.length,
    iterations,
    interventionsDispatched,
    interventionsSuppressed,
    maxEntropy,
    toolCalls,
    durationMs,
    totalTokens,
  }
}
