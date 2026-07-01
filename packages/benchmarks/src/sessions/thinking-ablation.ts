// File: src/sessions/thinking-ablation.ts
//
// Cross-tier thinking ablation — empirical gate for the .withThinking() feature
// (feat/cross-tier-thinking). Measures whether native model thinking (extended
// thinking on Anthropic/Gemini, reasoning_effort on OpenAI, Qwen3 /think token)
// lifts reactive agent quality on reasoning-sensitive tasks.
//
// Two otherwise-identical variants:
//   • thinking-off — builder.withThinking(false): explicit disable (baseline)
//   • thinking-on  — builder.withThinking():      enable, provider chooses budget
//
// Tasks — reasoning-heavy real-world tasks (multi-step, analysis, planning):
//   rw-1: Research synthesis with source conflict   (plan-execute / reasoning primary)
//   rw-2: Data investigation with red herring       (react / reasoning + loop-intelligence)
//   rw-5: Zero-downtime migration plan              (tree-of-thought / reasoning + memory-fidelity)
//
// Fan-out: 2 tiers × 2 variants × 3 tasks × 3 runs = 36 dispatches.
//
// Verdict rule (project lift rule): ≥3pp accuracy lift AND ≤15% token overhead
// on a per-tier basis → flip that tier's default-on. Any tier that doesn't clear
// the bar keeps thinking opt-in (the `withThinking()` call stays user-facing).
// See wiki/Research/Debriefs/2026-07-01-cross-tier-thinking-debrief.md.

import type { BenchmarkSession, HarnessVariant } from "../types.js"

const thinkingOffVariant: HarnessVariant = {
  type: "internal",
  id: "thinking-off",
  label: "RA Full (Thinking OFF)",
  config: {
    tools: true,
    reasoning: true,
    reactiveIntelligence: true,
    thinking: false,
  },
}

const thinkingOnVariant: HarnessVariant = {
  type: "internal",
  id: "thinking-on",
  label: "RA Full (Thinking ON)",
  config: {
    tools: true,
    reasoning: true,
    reactiveIntelligence: true,
    thinking: true,
  },
}

const _session: BenchmarkSession = {
  id: "thinking-ablation",
  name: "Cross-Tier Thinking Ablation (off vs on — reasoning-sensitive gate)",
  version: "1.0.0",
  taskIds: ["rw-1", "rw-2", "rw-5"],
  models: [
    { id: "qwen3-14b",    provider: "ollama",    model: "qwen3:14b",          contextTier: "local"    },
    { id: "claude-sonnet", provider: "anthropic", model: "claude-sonnet-4-5",  contextTier: "standard" },
  ],
  harnessVariants: [
    thinkingOffVariant,
    thinkingOnVariant,
  ],
  runs: 3,  // pass^k, N≥3 for statistical lift confidence
  traceDir: "benchmark-traces/thinking-ablation",
  concurrency: 1,
  timeoutMs: 300_000,
  logLevel: "progress",
}

/**
 * Factory for the cross-tier thinking ablation session.
 * Returns the session definition without executing any LLM calls.
 */
export function thinkingAblationSession(): BenchmarkSession {
  return _session
}
