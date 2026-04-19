import { Effect } from "effect"
import type { InterventionHandler } from "../intervention.js"

export const toolInjectHandler: InterventionHandler<"tool-inject"> = {
  type: "tool-inject",
  description: "Inject tool-usage guidance when model appears to be skipping tools",
  defaultMode: "advisory",
  execute: (decision, _state, _ctx) => {
    if (!decision.toolName) {
      return Effect.succeed({
        applied: false,
        patches: [],
        cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
        reason: "no-tool-name",
        telemetry: {},
      })
    }
    const text = `Use the ${decision.toolName} tool — ${decision.reason}`
    return Effect.succeed({
      applied: true,
      patches: [{ kind: "inject-tool-guidance" as const, text }],
      cost: { tokensEstimated: 50, latencyMsEstimated: 0 },
      reason: "fired",
      telemetry: { toolName: decision.toolName },
    })
  },
}
