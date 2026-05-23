import { Effect } from "effect"
import type {
  InterventionConfig,
  InterventionContext,
  InterventionHandler,
  KernelStatePatch,
} from "./intervention.js"
import type { ControllerDecision } from "../types.js"
import type { KernelStateLike } from "@reactive-agents/core"

/**
 * One applied patch tagged with the ControllerDecision type that produced it.
 * HS-107: prior `KernelStatePatch[]` flat shape dropped the decision→patch
 * link, causing downstream emitters to publish `decisionType=patch.kind` and
 * conflate 8 distinct names for 5 logical decisions in trace analytics.
 */
export interface AppliedPatchRecord {
  readonly decisionType: ControllerDecision["decision"]
  readonly patch: KernelStatePatch
}

export interface DispatchResult {
  readonly appliedPatches: readonly AppliedPatchRecord[]
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
      const appliedPatches: AppliedPatchRecord[] = []
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
        // early-stop is exempt from the entropy-composite floor: it fires specifically
        // at LOW entropy (convergence), so checking composite >= 0.55 would always block it.
        const minEntropy = context.adaptiveMinEntropy ?? config.suppression.minEntropyComposite;
        if (key !== "early-stop" && context.entropyScore.composite < minEntropy) {
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
          for (const patch of outcome.patches) {
            appliedPatches.push({ decisionType: key as ControllerDecision["decision"], patch })
          }
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
