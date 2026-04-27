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
  let maxIter = -1
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
        if (ev.iter > maxIter) maxIter = ev.iter
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
        if (ev.iter > maxIter) maxIter = ev.iter
        break
      default:
        break
    }
  }

  return {
    totalEvents: trace.events.length,
    iterations: Math.max(0, maxIter + 1),
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
