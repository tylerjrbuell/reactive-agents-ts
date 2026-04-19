import { Effect } from "effect"
import type { InterventionHandler } from "../intervention.js"

export const tempAdjustHandler: InterventionHandler<"temp-adjust"> = {
  type: "temp-adjust",
  description: "Adjust LLM temperature to break repetition or overconfidence",
  defaultMode: "dispatch",
  execute: (decision, state, _ctx) => {
    const current = (state as any).currentOptions?.temperature ?? 0.7
    const { delta } = decision
    if (Math.abs(delta) < 0.05) {
      return Effect.succeed({
        applied: false,
        patches: [],
        cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
        reason: "delta-too-small",
        telemetry: { current, delta },
      })
    }
    const target = Math.round(Math.max(0.0, Math.min(1.0, current + delta)) * 1e10) / 1e10
    return Effect.succeed({
      applied: true,
      patches: [{ kind: "set-temperature" as const, temperature: target }],
      cost: { tokensEstimated: 0, latencyMsEstimated: 50 },
      reason: "fired",
      telemetry: { from: current, to: target, delta },
    })
  },
}
