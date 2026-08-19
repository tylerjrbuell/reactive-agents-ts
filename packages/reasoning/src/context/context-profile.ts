// File: src/context/context-profile.ts
import { Schema } from "effect";
import { ModelTierSchema, resolveCapability, type ModelTier as CapabilityModelTier } from "@reactive-agents/llm-provider";

// ─── Model Tier ───
//
// Phase 1 Sprint 2 S2.2 — G-2 structurally closed.
// ModelTier is now re-exported from @reactive-agents/llm-provider (where
// it's defined as `Capability.tier`'s literal union). Before S2.2 this file
// declared its own `Schema.Literal(...)` with the same 4 literals — equal
// by value but a separate Schema AST node, which made it possible for the
// two definitions to drift independently. Re-exporting forces them to
// stay identical by construction.
//
// Test pin: packages/reasoning/tests/context/tier-source-of-truth.test.ts
// Gate scenario: cf-NN-tier-derived-from-capability

export const ModelTier = ModelTierSchema;
export type ModelTier = CapabilityModelTier;

// ─── Context Profile ───

export const ContextProfileSchema = Schema.Struct({
  tier: ModelTier,
  /**
   * Tier default for max characters per compressed tool result. Used as the
   * fallback for `KernelInput.resultCompression.budget` (the per-input override).
   * Resolution order: input.resultCompression.budget → profile.toolResultMaxChars
   * → hard-coded 800. See runner.ts:509 + tool-execution.ts:571.
   */
  toolResultMaxChars: Schema.Number,
  /**
   * Tier default for preview-item count in compressed tool results. Fallback for
   * `KernelInput.resultCompression.previewItems` (per-input override). Resolution
   * order mirrors `toolResultMaxChars`.
   */
  toolResultPreviewItems: Schema.Number,
  /** Tool schema verbosity in the system prompt. */
  toolSchemaDetail: Schema.Literal("names-only", "names-and-types", "full"),
  /** Maximum kernel iterations before failing. */
  maxIterations: Schema.optional(Schema.Number),
  /** LLM sampling temperature. */
  temperature: Schema.optional(Schema.Number),
  /** Maximum context window tokens for this tier. Used by pressure gates and message compaction. */
  maxTokens: Schema.optional(Schema.Number),
  /**
   * S2.5 Slice C — opt-in production wiring for the curator's trust-aware
   * "Recent tool observations:" section. When > 0, the kernel asks
   * defaultContextCurator to append the last N observation steps (untrusted
   * wrapped in <tool_output>, trusted plain) to the system prompt.
   *
   * Default 0 across all tiers — preserves byte-identical Slice A/B behavior.
   * Agents enable per-run via profileOverrides: { recentObservationsLimit: 5 }.
   * Tier defaults stay at 0 deliberately — turning this on globally would
   * change every prompt's token budget, which is a per-agent decision, not
   * a per-tier one.
   */
  recentObservationsLimit: Schema.optional(Schema.Number),
  /**
   * B2 (2026-07-07) — true when the resolved model runs a thinking/reasoning
   * mode (capability.supportsThinkingMode). The kernel widens its per-turn
   * output budget for these models: thinking tokens count against num_predict,
   * so a flat tier cap starves the visible answer (empty-content max_tokens
   * turns → escalation thrash → timeout).
   */
  thinkingModel: Schema.optional(Schema.Boolean),
  /**
   * Tool-disclosure mode (2026-08-19 — counters 09-UNIFIED-PROGRAM.md §5.2's
   * unconditional discover-tools removal ruling with a per-tier policy
   * instead). See
   * wiki/Planning/Implementation-Plans/2026-08-19-lightweight-tool-index-progressive-disclosure.md
   * for the full case analysis this taxonomy is derived from.
   *
   *   "full"     — no lazy pruning (RA_LAZY_TOOLS=0 equivalent). Best when the
   *                catalog is small enough that pruning is pure overhead.
   *   "discover" — today's default: lazy pruning + the discover-tools meta-tool,
   *                no index. Kept for back-compat / explicit choice.
   *   "index"    — lazy pruning + an always-visible name+one-line index of
   *                hidden tools (RA_TOOL_INDEX), no discover-tools registered.
   *                Avoids the round-trip cost discovery pays, at the cost of a
   *                small recurring per-iteration text block.
   *   "hybrid"   — lazy pruning + a CAPPED index (see `toolIndexMaxEntries`)
   *                AND discover-tools registered as the fallback for anything
   *                beyond the cap. For catalogs too large for an unbounded
   *                index to stay cheap.
   *
   * Unset ⇒ resolves from the per-tier default in CONTEXT_PROFILES (§4 of the
   * plan doc's design — a PROPOSED default pending ablation-warden
   * confirmation, not yet empirically validated). Explicit
   * `.withReasoning({ contextProfile: { toolDisclosureMode } })` or a
   * `profileOverrides` entry always wins over the tier default.
   */
  toolDisclosureMode: Schema.optional(Schema.Literal("full", "discover", "index", "hybrid")),
  /**
   * Cap on hidden-tool index entries before `"hybrid"` mode truncates and
   * defers the remainder to discover-tools' query search. Ignored outside
   * `"hybrid"` mode (`"index"` always renders the full hidden set — no
   * catalog this project has measured yet is large enough for that to matter,
   * but `"hybrid"` exists for the case where it does).
   */
  toolIndexMaxEntries: Schema.optional(Schema.Number),
});
export type ContextProfile = typeof ContextProfileSchema.Type;

// ─── Default Profiles per Tier ───

export const CONTEXT_PROFILES: Record<ModelTier, ContextProfile> = {
  local: {
    tier: "local",
    // Bumped 2000 → 4000 (2026-05-28). Filter tasks ("top N by criterion")
    // need ALL items visible — sort criterion may not be among the first 8.
    // Local models routinely ship 32K+ context (qwen3:14b, cogito:14b), so
    // 4000 chars (~1K tokens) for tool obs is well within budget. The 2000
    // ceiling was tuned for 4K-context models that haven't shipped in a
    // year. Try-fit pattern still compresses to preview when total exceeds.
    toolResultMaxChars: 4000,
    toolResultPreviewItems: 8,
    toolSchemaDetail: "names-and-types",
    maxIterations: 8,
    temperature: 0.3,
    // Modern local models (gemma3+, llama3.x+, qwen2.5+) ship 32K-128K context
    // windows. The dynamic Ollama probe returns 32K+ for almost everything;
    // the 4096 default here forced pressure-narrowing-to-final-answer to fire
    // at ~3K tokens, panicking models on any non-trivial tool result. The
    // probe-resolved capability.recommendedNumCtx should override this when
    // wired (Sprint 1 S1.4 — see runner.ts profile resolution); 32K matches
    // the conservative probe ceiling so the pressure gate doesn't trip
    // prematurely even before that wiring lands.
    maxTokens: 32_768,
  },
  mid: {
    tier: "mid",
    toolResultMaxChars: 1200,
    toolResultPreviewItems: 5,
    toolSchemaDetail: "full",
    maxIterations: 10,
    temperature: 0.5,
    maxTokens: 32_768,
  },
  large: {
    tier: "large",
    toolResultMaxChars: 800,
    toolResultPreviewItems: 5,
    toolSchemaDetail: "full",
    maxIterations: 10,
    temperature: 0.5,
    maxTokens: 32768,
  },
  frontier: {
    tier: "frontier",
    toolResultMaxChars: 600,
    toolResultPreviewItems: 3,
    toolSchemaDetail: "full",
    maxIterations: 12,
    temperature: 0.6,
    maxTokens: 128000,
  },
};

/**
 * Merge partial overrides into a base profile.
 */
export const mergeProfile = (
  base: ContextProfile,
  overrides: Partial<ContextProfile>,
): ContextProfile => ({
  ...base,
  ...overrides,
  tier: overrides.tier ?? base.tier,
});

/**
 * S1.4 — Wire `capability.recommendedNumCtx` into `profile.maxTokens`.
 *
 * Resolution: the caller-supplied `contextProfile.maxTokens` always wins
 * (passed as `callerProvidedMaxTokens`). Otherwise, when both provider and
 * model are known, resolve the Capability and use its `recommendedNumCtx`
 * as the effective context window. With provider or model missing, the
 * profile is returned unchanged (tier default stands).
 *
 * Pure / synchronous — `resolveCapability` is a sync three-tier lookup
 * (cache → static table → conservative fallback 2048).
 */
export function applyCapabilityMaxTokens(
  profile: ContextProfile,
  providerName: string | undefined,
  modelId: string | undefined,
  callerProvidedMaxTokens: number | undefined,
): ContextProfile {
  if (!providerName || !modelId) return profile;
  const cap = resolveCapability(providerName, modelId);
  // thinkingModel threads regardless of the maxTokens resolution — it is
  // orthogonal metadata the kernel needs for its per-turn output budget (B2).
  const withThinking = cap.supportsThinkingMode
    ? { ...profile, thinkingModel: true }
    : profile;
  if (callerProvidedMaxTokens !== undefined) return withThinking;
  return { ...withThinking, maxTokens: cap.recommendedNumCtx };
}
