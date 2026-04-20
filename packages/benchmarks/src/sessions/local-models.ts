import type { BenchmarkSession } from "../types.js"
import { getVariant } from "../session.js"

export const localModelsSession: BenchmarkSession = {
  id: "local-models",
  name: "Local Model Benchmark",
  version: "1.0.0",
  taskIds: ["rw-2", "rw-3", "rw-6", "rw-8", "rw-9"],
  models: [
    { id: "qwen3-4b",  provider: "ollama", model: "qwen3:4b",  contextTier: "local" },
    { id: "cogito-8b", provider: "ollama", model: "cogito:8b", contextTier: "local" },
  ],
  harnessVariants: [getVariant("bare-llm"), getVariant("ra-full")],
  runs: 3,
  traceDir: "benchmark-traces",
  concurrency: 1,
  timeoutMs: 180_000,
}
