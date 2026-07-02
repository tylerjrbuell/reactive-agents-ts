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
  // 240s was razor-thin against observed legit durations (up to 228-231s on
  // multi-step plan-execute/reflect and manual tool loops) — a first run on
  // this box measured 13/90 cells (14%, worst on ra-full at 5/15) as hard
  // 0-token timeouts, roughly proportional across every tool-using variant
  // (not RA-specific). 420s gives real headroom above the observed max.
  timeoutMs: 420_000,
} satisfies Partial<BenchmarkSession>

// Run order: cogito:8b first (faster — 8B, smaller than qwen3:14b), then the
// qwen3 family. Smaller/faster models let us validate the harness end-to-end
// (and catch regressions like the timeout contamination found on the first
// qwen3:14b attempt) before committing hours of GPU time to bigger models.
export const publicCompetitorCogitoSession: BenchmarkSession = {
  ...SHARED,
  id: "public-competitor-cogito-8b",
  name: "Public Competitor Benchmark — cogito:8b",
  models: [
    { id: "cogito-8b", provider: "ollama", model: "cogito:8b", contextTier: "local" },
  ],
}

export const publicCompetitorQwenSession: BenchmarkSession = {
  ...SHARED,
  id: "public-competitor-qwen3-14b",
  name: "Public Competitor Benchmark — qwen3:14b",
  models: [
    { id: "qwen3-14b", provider: "ollama", model: "qwen3:14b", contextTier: "local" },
  ],
}

// Cheap end-to-end smoke: 1 task, 1 run, all 6 variants (~6 LLM calls instead
// of 90). Run before any full session to catch wiring/timeout/display
// regressions without burning a multi-hour GPU run. Uses cogito:8b — the
// fastest bench model — so the smoke itself stays cheap.
export const publicCompetitorSmokeSession: BenchmarkSession = {
  ...SHARED,
  id: "public-competitor-smoke",
  name: "Public Competitor Benchmark — smoke (cogito:8b, rw-2, 1 run)",
  taskIds: ["rw-2"],
  runs: 1,
  models: [
    { id: "cogito-8b", provider: "ollama", model: "cogito:8b", contextTier: "local" },
  ],
}
