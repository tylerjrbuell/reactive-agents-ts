import { CONTEXT_PROFILES } from "../context/context-profile.js";
import { resolveHarnessConfig, type ResolvedHarness } from "../harness-config.js";

export type Tier = "local" | "mid" | "large" | "frontier";

export interface CapabilityInput {
  window: number;
  outputBudget: number;
  dialect: "native-fc" | "text-parse" | "none";
  tier: Tier;
  /** Resolved harness config; absent ⇒ env/default resolution (see Task 3 fallback rule). */
  readonly harness?: ResolvedHarness;
}

export interface ResolvedCapability {
  readonly window: number;
  readonly outputBudget: number;
  readonly dialect: CapabilityInput["dialect"];
  readonly tier: Tier;
  /**
   * Generous per-result preservation cap (chars) applied ONLY to the LATEST
   * tool result (`projectResultsStage`), so verbatim/recall tasks keep the most
   * recent payload in full. OLDER results use the tighter `toolResultPreserveBudget`.
   * Derived as `window × 0.35 × 4` chars (≈35% of the window in tokens);
   * env override `RA_RECENCY_BUDGET_CHARS`.
   *
   * NOTE: this does NOT drive compaction. The whole-thread bulk-truncate
   * threshold is separate — `compactHistoryStage` fires at the full window
   * (`window × 4` chars) as a last-resort safety valve. Proactive earlier
   * compaction is a behavioral change tracked for the Wave-5 bench, not here.
   */
  readonly recencyBudgetChars: number;
  /**
   * Per-tool-result preservation cap (chars). Above this, `projectResultsStage`
   * replaces the raw payload with a structural preview+ref (full content
   * stays recoverable via `ResultStore`). Mirrors the empirically-tuned
   * legacy `CONTEXT_PROFILES[tier].toolResultMaxChars` table:
   *   local 4000 / mid 1200 / large 800 / frontier 600
   * Phase-A (2026-06-02) measured 27% mean token bloat when project() reused
   * `recencyBudgetChars` (window×0.35×4) as the per-result gate — that's
   * 38× more permissive than the legacy curator on mid tier (45875 vs 1200),
   * so any tool result under one third of window stayed FULL and stacked
   * linearly across iters. Separating "total recency" from "per-result cap"
   * recovers the legacy compression invariant without re-introducing the
   * legacy code path. Env override: `RA_TOOL_RESULT_BUDGET_CHARS`.
   */
  readonly toolResultPreserveBudget: number;
}

const BUCKETS = [8192, 16384, 32768, 65536, 131072] as const;

/**
 * Demand-driven Ollama num_ctx. Monotone within a run: Ollama reloads the model
 * when num_ctx changes, so the window only ever GROWS (highWater), and never
 * past the model's ceiling. Opt-in via HarnessConfig.numCtxPolicy = "demand"
 * (see kernel/capabilities/reason/think.ts, D-2026-07-30-I).
 */
export function nextNumCtx(
  assembledPromptTokens: number,
  outputBudget: number,
  highWater: number | undefined,
  ceiling: number | undefined,
): number {
  const need = assembledPromptTokens + outputBudget + 1024; // headroom
  const bucket = BUCKETS.find((b) => b >= need) ?? BUCKETS[BUCKETS.length - 1];
  const grown = Math.max(bucket, highWater ?? 0);
  return ceiling !== undefined ? Math.min(grown, ceiling) : grown;
}

// Phase 1b (2026-07-07): single source of truth — derive from CONTEXT_PROFILES
// instead of maintaining a mirror table that can drift (sweep report 02, F4).
// Wave 2a (2026-10-13): fallback literals below are DEAD defaults kept in sync
// with the table by tests/context/context-profile-ratchet.test.ts — the D-H
// fix moved local 4000 → 1200; update mirrors here AND in
// @reactive-agents/core TIER_TOOL_RESULT_PRESERVE together, or the ratchet fails.
const TIER_TOOL_RESULT_PRESERVE: Record<Tier, number> = {
  local: CONTEXT_PROFILES.local.toolResultMaxChars ?? 1200,
  mid: CONTEXT_PROFILES.mid.toolResultMaxChars ?? 1200,
  large: CONTEXT_PROFILES.large.toolResultMaxChars ?? 800,
  frontier: CONTEXT_PROFILES.frontier.toolResultMaxChars ?? 600,
};

export function resolveCapability(input: CapabilityInput): ResolvedCapability {
  const h = input.harness ?? resolveHarnessConfig();

  // Test knob (mirrors the legacy RA_OVERFLOW_BUDGET): force the recency budget
  // low so a normal-sized tool result deterministically exercises the
  // summary+ref overflow branch. Unset in production → derived budget stands.
  const envRecency = h.recencyBudgetChars;
  const recencyBudgetChars =
    envRecency !== undefined && Number.isFinite(envRecency) && envRecency > 0
      ? envRecency
      : Math.floor(input.window * 0.35 * 4);

  // Per-result preservation cap. Env override for ablation; default mirrors
  // the legacy CONTEXT_PROFILES tier table so canonical project() collapses
  // raw tool results at the same threshold legacy curate() did.
  const envPreserve = h.toolResultBudgetChars;
  const toolResultPreserveBudget =
    envPreserve !== undefined && Number.isFinite(envPreserve) && envPreserve > 0
      ? envPreserve
      : TIER_TOOL_RESULT_PRESERVE[input.tier];

  return {
    ...input,
    recencyBudgetChars,
    toolResultPreserveBudget,
  };
}
