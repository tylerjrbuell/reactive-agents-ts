/**
 * M1 Spike: Minimal measurement instrumentation for RI dispatcher validation.
 *
 * Collects entropy signals, dispatcher events, and intervention outcomes
 * from the event bus during agent execution to populate RIDispatchMetrics.
 *
 * GREEN Phase: This module is wired into test harnesses to capture
 * real dispatch behavior without modifying production code.
 */

import { Effect } from "effect"

/** Entropy score: a snapshot of agent entropy at one iteration. */
export interface EntropyScore {
  readonly composite: number
  readonly token?: number
  readonly structural?: number
  readonly semantic?: number
  readonly behavioral?: number
  readonly contextPressure?: number
}

/** EventBus publish/subscribe interface (simplified for our use). */
export interface EventBus {
  readonly subscribe: (
    handler: (event: unknown) => Effect.Effect<void, never>
  ) => Effect.Effect<() => void, never>
}

/** Captured event data for a single entropy-score moment. */
export interface EntropyEvent {
  readonly taskId: string
  readonly iteration: number
  readonly composite: number
  readonly sources: {
    readonly contextPressure?: number
    readonly behavioral?: number
    readonly token?: number
    readonly structural?: number
    readonly semantic?: number
  }
  readonly timestamp: Date
}

/** Captured event data for dispatcher decision and firing. */
export interface InterventionEvent {
  readonly taskId: string
  readonly iteration: number
  readonly decisionType: string
  readonly cost: {
    readonly tokensEstimated: number
    readonly latencyMsEstimated: number
  }
  readonly timestamp: Date
}

/** Summary of dispatch behavior across a session. */
export interface DispatchMetricsSummary {
  readonly entropyEvents: readonly EntropyEvent[]
  readonly interventionEvents: readonly InterventionEvent[]
  readonly entropyMean: number
  readonly entropySigma: number  // standard deviation
  readonly interventionCount: number
  readonly meanLatencyMs: number
  readonly meanTokenCost: number
}

/**
 * Create a measurement collector that subscribes to event bus.
 * Collects EntropyScored and InterventionDispatched events.
 *
 * Usage:
 * ```ts
 * const collector = makeDispatchMeasurementCollector()
 * // wire into the agent's event bus
 * // run the agent
 * const metrics = collector.getSummary()
 * ```
 */
export function makeDispatchMeasurementCollector(): {
  wireIntoEventBus: (eventBus: EventBus) => Effect.Effect<void, never>
  getSummary: () => DispatchMetricsSummary
  reset: () => void
} {
  const entropyEvents: EntropyEvent[] = []
  const interventionEvents: InterventionEvent[] = []

  return {
    wireIntoEventBus: (eventBus: EventBus) =>
      Effect.gen(function* () {
        // Subscribe to EntropyScored events (if available in event bus)
        yield* eventBus.subscribe((e: any) => {
          if (e._tag === "EntropyScored") {
            entropyEvents.push({
              taskId: e.taskId ?? "unknown",
              iteration: typeof e.iteration === "number" ? e.iteration : 0,
              composite: typeof e.composite === "number" ? e.composite : 0,
              sources: {
                contextPressure: e.sources?.contextPressure,
                behavioral: e.sources?.behavioral,
                token: e.sources?.token,
                structural: e.sources?.structural,
                semantic: e.sources?.semantic,
              },
              timestamp: new Date(),
            })
          } else if (e._tag === "InterventionDispatched") {
            interventionEvents.push({
              taskId: e.taskId ?? "unknown",
              iteration: typeof e.iteration === "number" ? e.iteration : 0,
              // HS-107: schema-required field. Prior fallback to e.patchKind
              // conflated patches with decisions in trace analytics.
              decisionType: e.decisionType ?? "unknown",
              cost: {
                tokensEstimated: e.cost?.tokensEstimated ?? 0,
                latencyMsEstimated: e.cost?.latencyMsEstimated ?? 0,
              },
              timestamp: new Date(),
            })
          }
          return Effect.void
        }).pipe(Effect.catchAll(() => Effect.void))
      }).pipe(Effect.catchAll(() => Effect.void)),

    getSummary: () => {
      const composites = entropyEvents.map(e => e.composite)
      const mean = composites.length > 0
        ? composites.reduce((a, b) => a + b, 0) / composites.length
        : 0
      const variance = composites.length > 0
        ? composites.reduce((sum, val) => sum + (val - mean) ** 2, 0) / composites.length
        : 0
      const sigma = Math.sqrt(variance)

      const latencies = interventionEvents.map(e => e.cost.latencyMsEstimated)
      const meanLatencyMs = latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : 0

      const tokens = interventionEvents.map(e => e.cost.tokensEstimated)
      const meanTokenCost = tokens.length > 0
        ? tokens.reduce((a, b) => a + b, 0) / tokens.length
        : 0

      return {
        entropyEvents,
        interventionEvents,
        entropyMean: mean,
        entropySigma: sigma,
        interventionCount: interventionEvents.length,
        meanLatencyMs,
        meanTokenCost,
      }
    },

    reset: () => {
      entropyEvents.length = 0
      interventionEvents.length = 0
    },
  }
}

/**
 * Compute standard deviation from a set of entropy scores.
 * Helper for test assertions on entropy trajectory quality.
 */
export function computeEntropyStats(scores: readonly EntropyScore[]): {
  mean: number
  sigma: number
  min: number
  max: number
  range: number
} {
  if (scores.length === 0) {
    return { mean: 0, sigma: 0, min: 0, max: 0, range: 0 }
  }

  const composites = scores.map(s => s.composite)
  const mean = composites.reduce((a, b) => a + b, 0) / composites.length
  const variance = composites.reduce((sum, val) => sum + (val - mean) ** 2, 0) / composites.length
  const sigma = Math.sqrt(variance)
  const min = Math.min(...composites)
  const max = Math.max(...composites)

  return { mean, sigma, min, max, range: max - min }
}
