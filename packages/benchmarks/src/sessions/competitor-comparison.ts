import type { BenchmarkSession } from "../types.js"
import { ABLATION_VARIANTS } from "../session.js"

export const competitorComparisonSession: BenchmarkSession = {
  id: "competitor-comparison",
  name: "Framework Landscape Comparison",
  version: "1.0.0",
  taskIds: ["rw-1", "rw-2", "rw-7", "rw-8", "rw-9"],
  models: [
    { id: "claude-haiku", provider: "anthropic", model: "claude-haiku-4-5", contextTier: "standard" },
    { id: "gpt-4o-mini",  provider: "openai",    model: "gpt-4o-mini",      contextTier: "standard" },
  ],
  harnessVariants: [...ABLATION_VARIANTS],
  runs: 3,
  traceDir: "benchmark-traces",
  concurrency: 1,
  timeoutMs: 180_000,
}
