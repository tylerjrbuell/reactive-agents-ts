/**
 * Provider Behavior Adapters — lightweight hooks that compensate for
 * model-specific behavior differences without polluting the core kernel.
 *
 * The kernel calls adapter methods at well-defined hook points.
 * Frontier models return undefined (no intervention needed).
 * Local/mid models return explicit guidance to improve task completion rates.
 *
 * Hook call sites in the kernel phases (think.ts, context-utils.ts, act.ts):
 *   systemPromptPatch  — once, when building the static system prompt
 *   taskFraming        — once, wrapping the initial user task message
 *   toolGuidance       — once, appended to system prompt after tool schema block
 *   continuationHint   — each iteration, injected as user message after tool results
 *   errorRecovery      — when a tool returns a failed result
 *   synthesisPrompt    — when transitioning from research → produce phase
 *   qualityCheck       — optional self-eval prompt injected before final answer
 */

export interface ProviderAdapter {
  /**
   * Patch the system prompt for model-specific needs.
   * Called once when building the system prompt.
   */
  systemPromptPatch?(basePrompt: string, tier: string): string | undefined;

  /**
   * Wrap or annotate the initial task message.
   * Called once when the first user message is constructed.
   * Return undefined to use the task as-is.
   */
  taskFraming?(context: {
    task: string;
    requiredTools: readonly string[];
    tier: string;
  }): string | undefined;

  /**
   * Append inline tool usage guidance after the tool schema block in the system prompt.
   * Helps local models that ignore JSON schema descriptions.
   * Return undefined to add nothing.
   */
  toolGuidance?(context: {
    toolNames: readonly string[];
    requiredTools: readonly string[];
    tier: string;
  }): string | undefined;

  /**
   * Generate a continuation hint injected as a user message after tool results.
   * Called each iteration when required tools are still pending.
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
   * Generate recovery guidance when a tool call fails or returns an error.
   * Called after a failed tool execution. Return undefined to skip.
   */
  errorRecovery?(context: {
    toolName: string;
    errorContent: string;
    missingTools: readonly string[];
    tier: string;
  }): string | undefined;

  /**
   * Generate a synthesis prompt injected when the model has gathered enough data
   * and needs to transition to producing the output.
   * Called when all research tools are satisfied and only output tools remain.
   * Return undefined to skip.
   */
  synthesisPrompt?(context: {
    toolsUsed: ReadonlySet<string>;
    missingOutputTools: readonly string[];
    observationCount: number;
    tier: string;
  }): string | undefined;

  /**
   * Generate a self-evaluation prompt injected just before the model declares
   * a final answer. Return undefined to skip the quality check.
   */
  qualityCheck?(context: {
    task: string;
    requiredTools: readonly string[];
    toolsUsed: ReadonlySet<string>;
    tier: string;
  }): string | undefined;
}

// ─── Default adapter (all tiers) ─────────────────────────────────────────────

export const defaultAdapter: ProviderAdapter = {
  continuationHint({ missingTools, toolsUsed, iteration, maxIterations }) {
    if (missingTools.length === 0) {
      return toolsUsed.size > 0
        ? "You have completed all required tool calls. Now synthesize the results and provide your FINAL ANSWER."
        : undefined;
    }
    const toolList = missingTools.join(", ");
    const urgency = iteration >= maxIterations - 3
      ? ` You have ${maxIterations - iteration} iterations left.`
      : "";
    return `You must still call: ${toolList}. Call the next required tool now.${urgency}`;
  },

  synthesisPrompt({ missingOutputTools }) {
    if (missingOutputTools.length === 0) return undefined;
    return `Research phase complete. Call ${missingOutputTools[0]} now to produce the deliverable.`;
  },

  qualityCheck({ task, toolsUsed }) {
    // Frontier/large models: lightweight check when tools were used.
    // Ensures the model echoes actual tool output instead of paraphrasing.
    if (toolsUsed.size === 0) return undefined;
    return (
      `Before giving your final answer, verify: (1) your response directly addresses the task ` +
      `"${task.slice(0, 100)}", (2) key data from tool results is included verbatim where appropriate, ` +
      `not just paraphrased, and (3) the output format matches what the user requested. ` +
      `If anything is missing, fix it now.`
    );
  },
};

// ─── Local model adapter ──────────────────────────────────────────────────────

export const localModelAdapter: ProviderAdapter = {
  systemPromptPatch(basePrompt, tier) {
    if (tier !== "local") return undefined;
    return (
      basePrompt +
      "\n\nIMPORTANT: When given a multi-step task, complete ALL steps in sequence. " +
      "After gathering information, immediately proceed to the next step. " +
      "Never stop after only searching — always produce the deliverable."
    );
  },

  taskFraming({ task, requiredTools, tier }) {
    if (tier !== "local" || requiredTools.length === 0) return undefined;
    const steps = requiredTools.map((t, i) => `${i + 1}. Call ${t}`).join("\n");
    return `${task}\n\nComplete these steps in order:\n${steps}\nDo not stop until all steps are done.`;
  },

  toolGuidance({ requiredTools, tier }) {
    if (tier !== "local" || requiredTools.length === 0) return undefined;
    return (
      `\nRequired tools for this task: ${requiredTools.join(", ")}. ` +
      `You MUST call all of them before giving a final answer.`
    );
  },

  continuationHint({ toolsUsed, missingTools, iteration, maxIterations, lastToolName }) {
    if (missingTools.length === 0) return undefined;

    const urgency = iteration >= maxIterations - 2
      ? " This is urgent — you are running low on iterations."
      : "";

    // After a search, tell the model to write
    if (lastToolName && (lastToolName.includes("search") || lastToolName.includes("http"))) {
      const writeTools = missingTools.filter((t) => t.includes("write") || t.includes("file"));
      if (writeTools.length > 0) {
        return `You have gathered research data. Synthesize the findings and call ${writeTools[0]} to save the output.${urgency} Do NOT search again.`;
      }
    }

    if (missingTools.length === 1) {
      return `Your next step: call ${missingTools[0]}. You have all the information you need.${urgency}`;
    }

    return `Complete these steps in order: ${missingTools.join(" → ")}.${urgency} Proceed with the first one now.`;
  },

  errorRecovery({ toolName, errorContent, missingTools, tier }) {
    if (tier !== "local") return undefined;
    const isNotFound = errorContent.includes("404") || errorContent.includes("Not Found");
    const isTimeout = errorContent.toLowerCase().includes("timeout");

    if (isNotFound) {
      return `${toolName} returned 404 — that URL doesn't exist. Try a different URL or use web-search to find the correct one.${missingTools.length > 0 ? ` You still need to call: ${missingTools.join(", ")}.` : ""}`;
    }
    if (isTimeout) {
      return `${toolName} timed out. Try again with a simpler request, or skip this step and proceed with what you have.`;
    }
    return `${toolName} failed. Try an alternative approach or use a different tool to get the information you need.`;
  },

  synthesisPrompt({ missingOutputTools, observationCount, tier }) {
    if (tier !== "local" || missingOutputTools.length === 0) return undefined;
    return (
      `You have gathered ${observationCount} piece${observationCount !== 1 ? "s" : ""} of information. ` +
      `That is enough. Do NOT search again. ` +
      `Now call ${missingOutputTools[0]} to produce the final output. ` +
      `Synthesize everything you have learned into a complete, well-structured response.`
    );
  },

  qualityCheck({ task, requiredTools, toolsUsed, tier }) {
    if (tier !== "local") return undefined;
    const unmet = requiredTools.filter((t) => !toolsUsed.has(t));
    if (unmet.length > 0) {
      return `Before finishing: you have not yet called ${unmet.join(", ")}. Call ${unmet[0]} now.`;
    }
    return (
      `Review your answer: does it fully address the task "${task.slice(0, 120)}"? ` +
      `Include EXACT numbers, prices, and data values from the tool results above — ` +
      `do not say "no data found" if the numbers appear in the results. ` +
      `If the output format doesn't match what was requested, fix it now.`
    );
  },
};

// ─── Mid-tier adapter ─────────────────────────────────────────────────────────
// Mid models (7-30B) need lighter guidance than local but more than frontier.

export const midModelAdapter: ProviderAdapter = {
  continuationHint({ missingTools, toolsUsed, iteration, maxIterations }) {
    if (missingTools.length === 0) {
      return toolsUsed.size > 0
        ? "All required tools called. Synthesize and give your final answer."
        : undefined;
    }
    const urgency = iteration >= maxIterations - 2 ? ` (${maxIterations - iteration} steps left)` : "";
    return `Still needed: ${missingTools.join(", ")}. Call the next one now.${urgency}`;
  },

  synthesisPrompt({ missingOutputTools, tier }) {
    if (tier !== "mid" || missingOutputTools.length === 0) return undefined;
    return `Research complete. Now call ${missingOutputTools[0]} to produce the output.`;
  },

  qualityCheck({ task, toolsUsed, tier }) {
    if (tier !== "mid" || toolsUsed.size === 0) return undefined;
    return (
      `Review your answer: does it fully address "${task.slice(0, 100)}"? ` +
      `Include exact data from tool results — do not summarize or paraphrase numbers, URLs, or key facts. ` +
      `Ensure the output format matches what was requested.`
    );
  },
};

// ─── Adapter selection ────────────────────────────────────────────────────────

/**
 * Select the appropriate ProviderAdapter for a given model.
 *
 * Priority:
 * 1. modelId-based calibration (Phase 6 — future: loads from calibrations/<modelId>.json)
 * 2. Tier-based adapter (current default path)
 *
 * @param _capabilities - provider capabilities (reserved for future use)
 * @param tier - model tier ("local" | "mid" | "large" | "frontier")
 * @param _modelId - specific model identifier (reserved for calibration lookup in Phase 6)
 */
export function selectAdapter(
  _capabilities: { supportsToolCalling: boolean },
  tier?: string,
  _modelId?: string,
): ProviderAdapter {
  // Phase 6: check _modelId against calibration store here
  if (tier === "local") return localModelAdapter;
  if (tier === "mid") return midModelAdapter;
  return defaultAdapter;
}

export function recommendStrategyForTier(
  _tier: string | undefined,
  _configuredStrategy: string,
  _requiredTools?: readonly string[],
): string | undefined {
  return undefined;
}
