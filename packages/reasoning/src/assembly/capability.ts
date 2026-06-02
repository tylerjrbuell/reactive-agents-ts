export type Tier = "local" | "mid" | "large" | "frontier";

export interface CapabilityInput {
  window: number;
  outputBudget: number;
  dialect: "native-fc" | "text-parse" | "none";
  tier: Tier;
}

export interface ResolvedCapability {
  readonly window: number;
  readonly outputBudget: number;
  readonly dialect: CapabilityInput["dialect"];
  readonly tier: Tier;
  /**
   * Total recency window budget (chars). Governs `compactHistoryStage`'s
   * bulk-truncate threshold across the WHOLE message thread.
   * NOT for per-result preservation — see `toolResultPreserveBudget`.
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
  readonly agedBudgetChars: number;
  predictNumCtx(assembledPromptTokens: number): number;
}

const BUCKETS = [8192, 16384, 32768, 65536, 131072] as const;

const TIER_TOOL_RESULT_PRESERVE: Record<Tier, number> = {
  local: 4000,
  mid: 1200,
  large: 800,
  frontier: 600,
};

export function resolveCapability(input: CapabilityInput): ResolvedCapability {
  // Test knob (mirrors the legacy RA_OVERFLOW_BUDGET): force the recency budget
  // low so a normal-sized tool result deterministically exercises the
  // summary+ref overflow branch. Unset in production → derived budget stands.
  const envRecency = process.env.RA_RECENCY_BUDGET_CHARS
    ? Number(process.env.RA_RECENCY_BUDGET_CHARS)
    : undefined;
  const recencyBudgetChars =
    envRecency !== undefined && Number.isFinite(envRecency) && envRecency > 0
      ? envRecency
      : Math.floor(input.window * 0.35 * 4);

  // Per-result preservation cap. Env override for ablation; default mirrors
  // the legacy CONTEXT_PROFILES tier table so canonical project() collapses
  // raw tool results at the same threshold legacy curate() did.
  const envPreserve = process.env.RA_TOOL_RESULT_BUDGET_CHARS
    ? Number(process.env.RA_TOOL_RESULT_BUDGET_CHARS)
    : undefined;
  const toolResultPreserveBudget =
    envPreserve !== undefined && Number.isFinite(envPreserve) && envPreserve > 0
      ? envPreserve
      : TIER_TOOL_RESULT_PRESERVE[input.tier];

  const agedBudgetChars = Math.max(600, Math.min(4000, Math.floor(input.window * 0.04 * 4)));
  return {
    ...input,
    recencyBudgetChars,
    toolResultPreserveBudget,
    agedBudgetChars,
    predictNumCtx(assembledPromptTokens: number): number {
      const need = assembledPromptTokens + input.outputBudget + 1024; // headroom
      return BUCKETS.find((b) => b >= need) ?? BUCKETS[BUCKETS.length - 1];
    },
  };
}
