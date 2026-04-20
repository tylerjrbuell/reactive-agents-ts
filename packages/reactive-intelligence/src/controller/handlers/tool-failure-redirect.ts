import { Effect } from "effect"
import type { InterventionHandler } from "../intervention.js"

export const toolFailureRedirectHandler: InterventionHandler<"tool-failure-redirect"> = {
  type: "tool-failure-redirect",
  description: "Inject redirect guidance when a tool has failed repeatedly",
  defaultMode: "dispatch",
  execute: (decision, _state, _ctx) => {
    const text =
      `"${decision.failingTool}" has failed ${decision.streakCount} times in a row. ` +
      `Stop retrying the same call. Either: (a) try a different tool, ` +
      `(b) rephrase your query, or (c) conclude with the information you have.`
    return Effect.succeed({
      applied: true,
      patches: [{ kind: "append-system-nudge" as const, text }],
      cost: { tokensEstimated: 60, latencyMsEstimated: 0 },
      reason: `tool-streak-${decision.streakCount}`,
      telemetry: { failingTool: decision.failingTool, streakCount: decision.streakCount },
    })
  },
}
