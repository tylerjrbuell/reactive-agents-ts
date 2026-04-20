import type { BenchmarkSession } from "../types.js"
import { getVariant } from "../session.js"

export const regressionGateSession: BenchmarkSession = {
  id: "regression-gate",
  name: "CI Regression Gate",
  version: "1.0.0",
  tiers: ["moderate", "complex", "expert"],
  models: [
    { id: "claude-haiku", provider: "anthropic", model: "claude-haiku-4-5", contextTier: "standard" },
  ],
  harnessVariants: [getVariant("ra-full")],
  runs: 1,
  concurrency: 3,
  timeoutMs: 90_000,
}
