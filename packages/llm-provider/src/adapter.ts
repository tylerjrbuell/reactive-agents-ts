/**
 * Provider Behavior Adapters — lightweight hooks that compensate for
 * model-specific behavior differences without polluting the core kernel.
 *
 * The kernel calls adapter methods at well-defined hook points.
 * Frontier models return undefined (no intervention needed).
 * Local models return explicit guidance to help them chain multi-step tasks.
 */

export interface ProviderAdapter {
  /**
   * Generate a continuation hint for the next iteration.
   * Called when the kernel builds the "Continue" user message for iterations 2+.
   * Return undefined to use the default "Continue with the task."
   */
  continuationHint?(context: {
    toolsUsed: ReadonlySet<string>;
    requiredTools: readonly string[];
    missingTools: readonly string[];
    iteration: number;
    maxIterations: number;
    lastToolName?: string;
    lastToolResultPreview?: string;
  }): string | undefined;

  /**
   * Patch the system prompt for model-specific needs.
   * Called once when building the system prompt.
   * Return the modified prompt, or undefined to use as-is.
   */
  systemPromptPatch?(basePrompt: string, tier: string): string | undefined;
}

/** Default adapter — no intervention. Used by frontier models. */
export const defaultAdapter: ProviderAdapter = {};

/** Adapter for local/small models that need explicit step-by-step guidance */
export const localModelAdapter: ProviderAdapter = {
  continuationHint({ toolsUsed, missingTools, iteration, maxIterations, lastToolName }) {
    if (missingTools.length === 0) return undefined;

    const urgency =
      iteration >= maxIterations - 2
        ? " This is urgent — you are running low on iterations."
        : "";

    // If model just searched, tell it to synthesize and write
    if (
      lastToolName &&
      (lastToolName.includes("search") || lastToolName.includes("http"))
    ) {
      const writeTools = missingTools.filter(
        (t) => t.includes("write") || t.includes("file"),
      );
      if (writeTools.length > 0) {
        return `You have gathered research data. Now synthesize the findings and call ${writeTools[0]} to save the output.${urgency} Do NOT search again.`;
      }
    }

    // If model has one missing tool, give explicit next step
    if (missingTools.length === 1) {
      return `Your next step: call ${missingTools[0]}. You have all the information you need from previous tool calls.${urgency}`;
    }

    // Multiple missing tools — list them in order
    return `You still need to complete these steps in order: ${missingTools.join(", ")}.${urgency} Proceed with the first one now.`;
  },

  systemPromptPatch(basePrompt, tier) {
    if (tier !== "local") return undefined;
    // Local models benefit from explicit instruction about multi-step task completion
    return (
      basePrompt +
      "\n\nIMPORTANT: When given a multi-step task, complete ALL steps. After gathering information, always proceed to the next step (such as writing results to a file). Never stop after only searching."
    );
  },
};

/**
 * Select the appropriate adapter based on provider capabilities and model tier.
 */
export function selectAdapter(
  _capabilities: { supportsToolCalling: boolean },
  tier?: string,
): ProviderAdapter {
  // Local tier always gets the local adapter for guidance
  if (tier === "local") return localModelAdapter;
  // All other tiers use the default (no intervention)
  return defaultAdapter;
}

/**
 * Recommend a strategy override based on model tier and task characteristics.
 * Local models perform significantly better with plan-execute-reflect on
 * multi-step tasks because it provides explicit step structure.
 * Returns undefined if no override is recommended (use configured strategy).
 */
export function recommendStrategyForTier(
  tier: string | undefined,
  configuredStrategy: string,
  requiredTools?: readonly string[],
): string | undefined {
  // Only override reactive strategy (plan-execute is already structured)
  if (configuredStrategy !== "reactive") return undefined;
  // Only override when task has multiple required tools (multi-step)
  if (!requiredTools || requiredTools.length < 2) return undefined;
  // Local AND mid tier models benefit from plan-execute scaffolding
  // for multi-step tool tasks. Frontier/large models chain naturally.
  if (tier === "local" || tier === "mid") return "plan-execute-reflect";
  return undefined;
}
