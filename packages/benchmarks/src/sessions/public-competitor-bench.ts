import type { BenchmarkSession } from "../types.js"
import { getVariant } from "../session.js"

// ── Public competitor benchmark (v0.13 "Receipts") ───────────────────────────
// RA vs the established TS agent frameworks on LOCAL models — the core public
// claim is cross-tier: the same harness that works on frontier models lifts
// small local models. Frameworks drive Ollama through its OpenAI-compatible
// endpoint (see competitors/ai-sdk-model.ts); RA uses its native provider.
//
// One model per session — strict one-model-resident serialization so GPU
// contention / model thrash can't contaminate timings (runner warm-up loads
// the model untimed at session start). Run both sessions back-to-back.
//
// Variant set = the plan-2.2 named comparison:
//   bare-llm        — universal baseline (single call, no tools)
//   manual-react    — build-it-yourself loop (raw SDK + native FC)
//   langchain-react — LangGraph.js createReactAgent
//   vercel-ai-sdk   — Vercel AI SDK generateText + maxSteps
//   mastra-agent    — Mastra Agent
//   ra-full         — RA full harness
const PUBLIC_COMPETITOR_VARIANTS = [
  getVariant("bare-llm"),
  getVariant("manual-react"),
  getVariant("langchain-react"),
  getVariant("vercel-ai-sdk"),
  getVariant("mastra-agent"),
  getVariant("ra-full"),
] as const

const SHARED = {
  version: "1.0.0",
  taskIds: ["rw-1", "rw-2", "rw-7", "rw-8", "rw-9"],
  harnessVariants: [...PUBLIC_COMPETITOR_VARIANTS],
  runs: 3,
  traceDir: "benchmark-traces",
  concurrency: 1,
  timeoutMs: 240_000,
} satisfies Partial<BenchmarkSession>

export const publicCompetitorQwenSession: BenchmarkSession = {
  ...SHARED,
  id: "public-competitor-qwen3-14b",
  name: "Public Competitor Benchmark — qwen3:14b",
  models: [
    { id: "qwen3-14b", provider: "ollama", model: "qwen3:14b", contextTier: "local" },
  ],
}

export const publicCompetitorCogitoSession: BenchmarkSession = {
  ...SHARED,
  id: "public-competitor-cogito-8b",
  name: "Public Competitor Benchmark — cogito:8b",
  models: [
    { id: "cogito-8b", provider: "ollama", model: "cogito:8b", contextTier: "local" },
  ],
}
