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
    promptTemplateId: "default", // TODO: wire when bandit selects variants
    systemPromptTokens: 0, // TODO: wire from kernel state
    contextStrategy: {
      compressionEnabled: false, // TODO: wire from controller config
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
