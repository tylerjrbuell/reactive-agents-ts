import { Effect } from "effect"
import type { InterventionHandler } from "../intervention.js"

const COMPRESS_COST_TOKENS = 300

export const contextCompressHandler: InterventionHandler<"compress"> = {
  type: "compress",
  description: "Compress message history when tokens trend high",
  defaultMode: "dispatch",
  execute: (decision, state, _ctx) => {
    const currentTokens = (state as any).tokens as number ?? 0
    const estimatedSavings = decision.estimatedSavings
    if (estimatedSavings <= COMPRESS_COST_TOKENS * 2) {
      return Effect.succeed({
        applied: false,
        patches: [],
        cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
        reason: "savings-below-cost",
        telemetry: { currentTokens, estimatedSavings },
      })
    }
    const targetTokens = Math.max(4000, Math.floor(currentTokens * 0.6))
    return Effect.succeed({
      applied: true,
      patches: [{ kind: "compress-messages" as const, targetTokens }],
      cost: { tokensEstimated: COMPRESS_COST_TOKENS, latencyMsEstimated: 800 },
      reason: "fired",
      telemetry: { currentTokens, targetTokens, estimatedSavings, sections: decision.sections },
    })
  },
}
