import { Effect } from "effect"
import type { InterventionHandler } from "../intervention.js"

export const earlyStopHandler: InterventionHandler<"early-stop"> = {
  type: "early-stop",
  description: "Terminate the kernel loop with a reason",
  defaultMode: "dispatch",
  execute: (decision, _state, _context) =>
    Effect.succeed({
      applied: true,
      patches: [{ kind: "early-stop" as const, reason: decision.reason }],
      cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
      reason: "early-stop dispatched",
      telemetry: { iterationsSaved: decision.iterationsSaved },
    }),
}
