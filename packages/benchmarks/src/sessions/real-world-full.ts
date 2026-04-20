import type { BenchmarkSession } from "../types.js"
import { ABLATION_VARIANTS } from "../session.js"

export const realWorldFullSession: BenchmarkSession = {
  id: "real-world-full",
  name: "Real-World Benchmark Suite",
  version: "1.0.0",
  tiers: ["real-world"],
  models: [
    { id: "claude-haiku", provider: "anthropic", model: "claude-haiku-4-5",  contextTier: "standard" },
    { id: "qwen3-4b",     provider: "ollama",    model: "qwen3:4b",          contextTier: "local" },
    { id: "cogito-8b",    provider: "ollama",    model: "cogito:8b",         contextTier: "local" },
  ],
  harnessVariants: [...ABLATION_VARIANTS],
  runs: 3,
  traceDir: "benchmark-traces",
  concurrency: 1,
  timeoutMs: 300_000,
}
