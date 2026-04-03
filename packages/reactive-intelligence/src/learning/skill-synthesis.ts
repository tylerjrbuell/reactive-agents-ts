import type { ProceduralEntry, MemoryId } from "@reactive-agents/memory";
import type { SkillFragment } from "../telemetry/types.js";

type EntropyEntry = {
  readonly composite: number;
  readonly trajectory: { readonly shape: string };
};

type SynthesisCheckParams = {
  readonly entropyHistory: readonly EntropyEntry[];
  readonly outcome: "success" | "partial" | "failure";
  readonly highEntropyThreshold: number;
};

/**
 * Check whether a completed run qualifies for skill synthesis.
 * Requires: converging trajectory + successful outcome + mean entropy below threshold.
 */
export function shouldSynthesizeSkill(params: SynthesisCheckParams): boolean {
  const { entropyHistory, outcome, highEntropyThreshold } = params;
  if (outcome !== "success") return false;
  if (entropyHistory.length === 0) return false;

  // Check final trajectory is converging
  const last = entropyHistory[entropyHistory.length - 1]!;
  if (last.trajectory.shape !== "converging") return false;

  // Check mean composite entropy is below threshold
  const mean =
    entropyHistory.reduce((sum, e) => sum + e.composite, 0) /
    entropyHistory.length;
  if (mean >= highEntropyThreshold) return false;

  return true;
}

type SkillExtractionParams = {
  readonly strategy: string;
  readonly temperature: number;
  readonly maxIterations: number;
  readonly toolFilteringMode: "adaptive" | "static" | "none";
  readonly requiredToolsCount: number;
  readonly memoryTier: string;
  readonly semanticLines: number;
  readonly episodicLines: number;
  readonly consolidationEnabled: boolean;
  readonly strategySwitchingEnabled: boolean;
  readonly adaptiveEnabled: boolean;
  readonly entropyHistory: readonly EntropyEntry[];
  // optional fields from kernel state
  readonly promptVariantId?: string;      // from bandit selection
  readonly systemPromptTokens?: number;   // from bootstrap token count
  readonly compressionEnabled?: boolean;  // from controller config
};

/**
 * Extract a skill fragment from a high-signal run's configuration.
 * This is the "recipe" that made this run succeed.
 */
export function extractSkillFragment(
  params: SkillExtractionParams,
): SkillFragment {
  const { entropyHistory } = params;
  const composites = entropyHistory.map((e) => e.composite);
  const mean = composites.reduce((s, v) => s + v, 0) / composites.length;

  // Find convergence iteration (first iteration where trajectory is converging)
  const convergenceIdx = entropyHistory.findIndex(
    (e) => e.trajectory.shape === "converging",
  );

  return {
    promptTemplateId: params.promptVariantId ?? "default",
    systemPromptTokens: params.systemPromptTokens ?? 0,
    contextStrategy: {
      compressionEnabled: params.compressionEnabled ?? false,
      maxIterations: params.maxIterations,
      temperature: params.temperature,
      toolFilteringMode: params.toolFilteringMode,
      requiredToolsCount: params.requiredToolsCount,
    },
    memoryConfig: {
      tier: params.memoryTier,
      semanticLines: params.semanticLines,
      episodicLines: params.episodicLines,
      consolidationEnabled: params.consolidationEnabled,
    },
    reasoningConfig: {
      strategy: params.strategy,
      strategySwitchingEnabled: params.strategySwitchingEnabled,
      adaptiveEnabled: params.adaptiveEnabled,
    },
    convergenceIteration: convergenceIdx >= 0 ? convergenceIdx : null,
    finalComposite: composites[composites.length - 1] ?? 0,
    meanComposite: mean,
  };
}

type SkillFragmentToProceduralEntryParams = {
  readonly fragment: SkillFragment;
  readonly agentId: string;
  readonly taskCategory: string;
  readonly modelId: string;
};

/**
 * Convert a SkillFragment (learned configuration from a high-signal run)
 * into a ProceduralEntry suitable for storage in procedural memory.
 *
 * The entry captures the full fragment as its `pattern` (JSON-serialized),
 * and derives human-readable name/description/tags for retrieval.
 */
export function skillFragmentToProceduralEntry(
  params: SkillFragmentToProceduralEntryParams,
): ProceduralEntry {
  const { fragment, agentId, taskCategory, modelId } = params;
  const now = new Date();
  return {
    id: crypto.randomUUID() as MemoryId,
    agentId,
    name: `${taskCategory}:${modelId}`,
    description: `Learned skill for ${taskCategory} tasks on ${modelId} (entropy: ${fragment.meanComposite.toFixed(2)}, convergence at iter ${fragment.convergenceIteration ?? "?"})`,
    pattern: JSON.stringify(fragment),
    successRate: 1.0,
    useCount: 1,
    tags: [taskCategory, modelId, fragment.reasoningConfig.strategy],
    createdAt: now,
    updatedAt: now,
  };
}
