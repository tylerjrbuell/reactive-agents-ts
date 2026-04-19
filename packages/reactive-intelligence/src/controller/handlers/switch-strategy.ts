import { Effect } from "effect"
import type { InterventionHandler } from "../intervention.js"

export const switchStrategyHandler: InterventionHandler<"switch-strategy"> = {
  type: "switch-strategy",
  description: "Switch reasoning strategy mid-run when current is stuck",
  defaultMode: "dispatch",
  execute: (decision, state, _ctx) => {
    const to = decision.to
    // `state.strategy` is the canonical field on KernelStateLike; tests may pass `currentStrategy`
    const current: string | undefined =
      state.strategy ?? (state as unknown as Record<string, unknown>).currentStrategy as string | undefined
    if (!to || to === current) {
      return Effect.succeed({
        applied: false,
        patches: [],
        cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
        reason: "same-strategy",
        telemetry: {},
      })
    }
    return Effect.succeed({
      applied: true,
      patches: [{ kind: "request-strategy-switch" as const, to, reason: decision.reason ?? "dispatcher" }],
      cost: { tokensEstimated: 100, latencyMsEstimated: 200 },
      reason: "fired",
      telemetry: { from: current, to },
    })
  },
}
