import { Effect } from "effect"
import type {
  InterventionConfig,
  InterventionContext,
  InterventionHandler,
  KernelStatePatch,
} from "./intervention.js"
import type { ControllerDecision } from "../types.js"
import type { KernelStateLike } from "@reactive-agents/core"

export interface DispatchResult {
  readonly appliedPatches: readonly KernelStatePatch[]
  readonly skipped: readonly { decisionType: string; reason: string }[]
  readonly totalCost: { tokens: number; latencyMs: number }
}

export interface Dispatcher {
  readonly dispatch: (
    decisions: readonly ControllerDecision[],
    state: Readonly<KernelStateLike & Record<string, unknown>>,
    context: InterventionContext
  ) => Effect.Effect<DispatchResult, never>
  readonly handlers: Map<string, InterventionHandler>
  readonly config: InterventionConfig
}

export function makeDispatcher(config: InterventionConfig): Dispatcher {
  const handlers = new Map<string, InterventionHandler>()

  const dispatch = (
    decisions: readonly ControllerDecision[],
    state: Readonly<KernelStateLike & Record<string, unknown>>,
    context: InterventionContext
  ): Effect.Effect<DispatchResult, never> =>
    Effect.gen(function* () {
      const appliedPatches: KernelStatePatch[] = []
      const skipped: { decisionType: string; reason: string }[] = []
      let tokens = 0
      let latencyMs = 0

      for (const decision of decisions) {
        const key = decision.decision
        const mode =
          config.modes[key as ControllerDecision["decision"]] ??
          handlers.get(key)?.defaultMode ??
          "advisory"

        if (mode === "off") {
          skipped.push({ decisionType: key, reason: "mode-off" })
          continue
        }
        if (mode === "advisory") {
          skipped.push({ decisionType: key, reason: "mode-advisory" })
          continue
        }

        // Suppression gates — checked in priority order
        if (context.entropyScore.composite < config.suppression.minEntropyComposite) {
          skipped.push({ decisionType: key, reason: "below-entropy-threshold" })
          continue
        }
        if (context.iteration < config.suppression.minIteration) {
          skipped.push({ decisionType: key, reason: "below-iteration-threshold" })
          continue
        }
        if (context.budget.interventionsFiredThisRun >= config.suppression.maxFiresPerRun) {
          skipped.push({ decisionType: key, reason: "max-fires-exceeded" })
          continue
        }
        if (context.budget.tokensSpentOnInterventions >= config.suppression.maxInterventionTokenBudget) {
          skipped.push({ decisionType: key, reason: "over-budget" })
          continue
        }

        const handler = handlers.get(key)
        if (!handler) {
          skipped.push({ decisionType: key, reason: "no-handler" })
          continue
        }

        const outcome = yield* handler
          .execute(decision as Extract<ControllerDecision, { decision: typeof key }>, state, context)
          .pipe(
            Effect.catchAll(() =>
              Effect.succeed({
                applied: false,
                patches: [] as KernelStatePatch[],
                cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
                reason: "handler-error",
                telemetry: {},
              })
            )
          )

        if (outcome.applied) {
          appliedPatches.push(...outcome.patches)
          tokens += outcome.cost.tokensEstimated
          latencyMs += outcome.cost.latencyMsEstimated
        } else {
          skipped.push({ decisionType: key, reason: outcome.reason })
        }
      }

      return { appliedPatches, skipped, totalCost: { tokens, latencyMs } }
    })

  return { dispatch, handlers, config }
}

export function registerHandler(dispatcher: Dispatcher, handler: InterventionHandler): void {
  if (dispatcher.handlers.has(handler.type)) {
    throw new Error(`Handler already registered for ${handler.type}`)
  }
  dispatcher.handlers.set(handler.type, handler)
}
