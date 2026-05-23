import { Effect } from "effect"
import type {
  InterventionConfig,
  InterventionContext,
  InterventionHandler,
  KernelStatePatch,
} from "./intervention.js"
import type { ControllerDecision } from "../types.js"
import {
  emitToCompose,
  type BaseCtx,
  type ControlStrategyEvaluatedPayload,
  type KernelStateLike,
  type LifecycleFailurePayload,
  type NudgeCtx,
  type Tag,
} from "@reactive-agents/core"

// ─── RI → Compose bridge (HS-112) ──────────────────────────────────────────────
//
// Sparse mapping: only RI decisions that have a natural Compose tag are
// bridged. Decisions without a natural tag (compress, skill-activate,
// temp-adjust, tool-inject, memory-boost, prompt-switch, skill-reinject)
// stay internal — inventing new tags to force coverage would expand the
// Compose surface for cosmetic reasons.
//
// The bridge fires only after the handler reports `outcome.applied === true`.
// Skipped, suppressed, and erroring decisions do not emit; observers see
// confirmed kernel-affecting events, not the full deliberation stream.

type BridgeableDecision = Extract<
  ControllerDecision,
  { decision:
      | "switch-strategy"
      | "harness-harm"
      | "stall-detect"
      | "human-escalate"
      | "tool-failure-redirect"
  }
>

const isBridgeable = (d: ControllerDecision): d is BridgeableDecision =>
  d.decision === "switch-strategy" ||
  d.decision === "harness-harm" ||
  d.decision === "stall-detect" ||
  d.decision === "human-escalate" ||
  d.decision === "tool-failure-redirect"

const lifecycleFailureFromDecision = (
  decision: BridgeableDecision,
  ctx: InterventionContext,
  state: Readonly<KernelStateLike & Record<string, unknown>>,
  reason: LifecycleFailurePayload["reason"],
  errorMessage: string,
): LifecycleFailurePayload => ({
  reason,
  errorMessage,
  attemptNumber: ctx.iteration,
  failureStreak: ctx.budget.interventionsFiredThisRun + 1,
  currentStrategy: typeof state.strategy === "string" ? state.strategy : "unknown",
})

const baseCtxFromState = (
  ctx: InterventionContext,
  state: Readonly<KernelStateLike & Record<string, unknown>>,
): BaseCtx => ({
  iteration: ctx.iteration,
  phase: "audit",
  state: state as unknown as KernelStateLike,
  strategy: typeof state.strategy === "string" ? state.strategy : "unknown",
})

const nudgeCtxFromState = (
  ctx: InterventionContext,
  state: Readonly<KernelStateLike & Record<string, unknown>>,
  trigger: string,
): NudgeCtx => ({
  ...baseCtxFromState(ctx, state),
  trigger,
  severity: "warn",
})

/**
 * Apply the bridge: convert an applied RI decision into a Compose tag
 * emission. Always-success — the bridge is observational only.
 */
const bridgeAppliedDecision = (
  decision: BridgeableDecision,
  ctx: InterventionContext,
  state: Readonly<KernelStateLike & Record<string, unknown>>,
): Effect.Effect<void> => {
  const pipeline = ctx.harnessPipeline
  if (pipeline === undefined) return Effect.void

  switch (decision.decision) {
    case "switch-strategy": {
      const payload: ControlStrategyEvaluatedPayload = {
        currentStrategy: decision.from,
        score: 1 - ctx.entropyScore.composite, // higher confidence = lower entropy
        failureStreak: ctx.budget.interventionsFiredThisRun,
        recommendedAction: "switch",
        availableStrategies: [decision.to],
      }
      return emitToCompose(
        pipeline,
        "control.strategy-evaluated" satisfies Tag,
        payload,
        baseCtxFromState(ctx, state),
      )
    }
    case "harness-harm": {
      return emitToCompose(
        pipeline,
        "lifecycle.failure" satisfies Tag,
        lifecycleFailureFromDecision(
          decision,
          ctx,
          state,
          "tool-error",
          `harness-harm detected (${decision.harmLevel}): ${decision.reason}`,
        ),
        baseCtxFromState(ctx, state),
      )
    }
    case "stall-detect": {
      return emitToCompose(
        pipeline,
        "lifecycle.failure" satisfies Tag,
        lifecycleFailureFromDecision(
          decision,
          ctx,
          state,
          "llm-refusal",
          `stall detected after ${decision.stalledIterations} iterations: ${decision.reason}`,
        ),
        baseCtxFromState(ctx, state),
      )
    }
    case "human-escalate": {
      return emitToCompose(
        pipeline,
        "lifecycle.failure" satisfies Tag,
        lifecycleFailureFromDecision(
          decision,
          ctx,
          state,
          "verifier-rejection",
          `human escalation requested: ${decision.reason}`,
        ),
        baseCtxFromState(ctx, state),
      )
    }
    case "tool-failure-redirect": {
      return emitToCompose(
        pipeline,
        "nudge.healing-failure" satisfies Tag,
        `tool-failure-redirect on "${decision.failingTool}" (streak=${decision.streakCount}): ${decision.reason}`,
        nudgeCtxFromState(ctx, state, "tool-failure-redirect"),
      )
    }
  }
}

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

          // HS-112 — RI→Compose bridge. Sparse: only decisions with a
          // natural Compose tag emit. Always-success (observers cannot
          // crash dispatch).
          if (isBridgeable(decision)) {
            yield* bridgeAppliedDecision(decision, context, state)
          }
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
