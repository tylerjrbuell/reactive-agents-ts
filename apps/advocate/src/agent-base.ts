// apps/advocate/src/agent-base.ts
//
// Shared foundation for reactive-agents internal "meta-agents".
//
// This is the self-improving, robust baseline every agent in the (future) suite
// inherits — the advocate is the first. Each agent layers its own persona,
// tools, and gateway/cron schedule on top of this. Keeping the advanced wiring
// here (rather than copy-pasted per agent) is what lets the suite grow into
// delegated sub-agents / multi-agent pipelines without each one re-deriving the
// robustness story.
//
// Everything here uses verified, current builder APIs. Notable *omissions* and
// why (honesty over feature-count):
//   - withProgressCheckpoint: its own JSDoc says mid-run checkpointing "requires
//     kernel-level hooks not yet wired". The gateway already persists across
//     heartbeats via memory + the agent's seen-store, so wiring it would be
//     decorative. Left out until it actually checkpoints.
//   - The self-improvement bandit rewards entropy-convergence + task-completion,
//     not draft quality directly. Within a heartbeat, draft quality is enforced
//     by the grounding grade-gate + the plan-execute-reflect loop; cross-run
//     learning compounds on convergence. We do not claim the bandit optimizes
//     "human-postable draft" — that would need a quality reward in the RI
//     learning-engine (out of scope here).

import { ReactiveAgents } from "reactive-agents";
import {
  budgetLimit,
  timeoutAfter,
  maxIterations,
  watchdog,
} from "@reactive-agents/compose";

export interface MetaAgentBaseConfig {
  /** Stable agent identity (used for memory namespacing + telemetry). */
  readonly name: string;
  /** Provider id as passed to withProvider (e.g. "ollama", "anthropic"). */
  readonly provider: string;
  /** Model id or full model config (numCtx etc.). */
  readonly model: string | { readonly model: string; readonly numCtx?: number };
  /** Per-run token ceiling before the budget killswitch stops the agent. */
  readonly maxTokensPerRun?: number;
  /**
   * Same-provider fallback models, tried in order when the primary errors.
   * Realistic for local fleets (gemma4 → qwen3:14b → cogito:14b); leave empty
   * for hosted providers where a single model is the contract.
   */
  readonly fallbackModels?: readonly string[];
}

/**
 * Build a meta-agent with the shared advanced baseline:
 *   - Compounding intelligence: enhanced (tier-2) memory + skill persistence,
 *     experience-summary learning across runs, self-improvement (strategy
 *     bandit), and background memory consolidation (decay + prune).
 *   - Per-model robustness: auto calibration adapts to the served model's real
 *     tool-calling / context behavior instead of static assumptions.
 *   - Safety: input guardrails — these agents feed UNTRUSTED scraped web /
 *     community text to the LLM, so prompt-injection + PII detection are a live
 *     requirement, not decoration.
 *   - Adaptive required-tool enforcement so the agent actually invokes the tools
 *     a given task needs.
 *   - Provider/model fallback + the standard unattended-operation killswitches.
 *
 * Returns a builder; the caller adds persona / tools / gateway and calls build().
 */
export function createMetaAgentBase(cfg: MetaAgentBaseConfig) {
  const builder = ReactiveAgents.create()
    .withName(cfg.name)
    .withProvider(cfg.provider)
    .withModel(cfg.model)

    // ── Adaptive reasoning (strategy chosen per task complexity) ──
    .withReasoning({ defaultStrategy: "adaptive" })

    // ── Compounding intelligence ──
    .withLearning({ tier: "enhanced" }) // tier-2 memory + skill persistence
    .withExperienceLearning() // ExperienceSummary loop across runs
    .withSelfImprovement() // strategy bandit self-tuning
    .withMemoryConsolidation({
      threshold: 50,
      decayFactor: 0.95,
      pruneThreshold: 0.2,
    })
    .withReactiveIntelligence(true)

    // ── Per-model robustness ──
    .withCalibration("auto")

    // ── Safety: untrusted scraped text in, so screen the input ──
    .withGuardrails({ injection: true, pii: true, toxicity: false })

    // ── Make the agent actually call the tools a task requires ──
    .withRequiredTools({ adaptive: true })

    // ── Resilience for 24/7 unattended operation ──
    .compose(maxIterations({ max: 20, onTrigger: "stop" }))
    .compose(
      budgetLimit({ maxTokens: cfg.maxTokensPerRun ?? 90_000, onTrigger: "stop" }),
    )
    .compose(timeoutAfter({ wallClock: "5m", onTrigger: "stop" }))
    .compose(watchdog({ noProgressFor: "90s", onTrigger: "stop" }))
    .withTimeout(300_000)
    .withRetryPolicy({ maxRetries: 2, backoffMs: 1000 });

  return cfg.fallbackModels && cfg.fallbackModels.length > 0
    ? builder.withFallbacks({ models: [...cfg.fallbackModels] })
    : builder;
}
