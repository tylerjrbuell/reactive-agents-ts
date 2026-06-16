/**
 * JSON body for `POST /api/runs` — shared by Lab builder and Beacon stage store
 * so desk runs match server expectations (including `taskContext` → `withTaskContext`).
 */
import type { AgentConfig } from "./types/agent-config.js";

function shellExecuteActive(cfg: AgentConfig): boolean {
  return cfg.terminalTools === true || cfg.tools.includes("shell-execute");
}

/** Parse the structured-output schema text → a JSON Schema object, or undefined when blank/invalid. */
function parseOutputSchema(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Build the object passed to `JSON.stringify` for Cortex run creation. */
export function cortexRunsPostBody(
  prompt: string,
  cfg: AgentConfig,
  variableValues?: Record<string, string | number>,
): Record<string, unknown> {
  return {
    prompt: prompt.trim(),
    provider: cfg.provider,
    model: cfg.model || undefined,
    tools: cfg.tools,
    strategy: cfg.strategy,
    temperature: cfg.temperature,
    maxIterations: cfg.maxIterations || undefined,
    minIterations: cfg.minIterations || undefined,
    systemPrompt: cfg.systemPrompt || undefined,
    agentName: cfg.agentName || undefined,
    maxTokens: cfg.maxTokens || undefined,
    numCtx: typeof cfg.numCtx === "number" && cfg.numCtx > 0 ? cfg.numCtx : undefined,
    timeout: cfg.timeout || undefined,
    retryPolicy: cfg.retryPolicy.enabled ? cfg.retryPolicy : undefined,
    cacheTimeout: cfg.cacheTimeout || undefined,
    progressCheckpoint: cfg.progressCheckpoint || undefined,
    fallbacks: cfg.fallbacks.enabled ? cfg.fallbacks : undefined,
    metaTools: cfg.metaTools.enabled ? cfg.metaTools : undefined,
    verificationStep: cfg.verificationStep !== "none" ? cfg.verificationStep : undefined,
    ...(cfg.runtimeVerification ? { runtimeVerification: true as const } : {}),
    ...(cfg.auditRationale ? { auditRationale: true as const } : {}),
    ...(cfg.terminalTools ? { terminalTools: true as const } : {}),
    ...(shellExecuteActive(cfg) && cfg.terminalShellAdditionalCommands.trim() !== ""
      ? { terminalShellAdditionalCommands: cfg.terminalShellAdditionalCommands.trim() }
      : {}),
    ...(shellExecuteActive(cfg) && cfg.terminalShellAllowedCommands.trim() !== ""
      ? { terminalShellAllowedCommands: cfg.terminalShellAllowedCommands.trim() }
      : {}),
    ...(cfg.additionalToolNames.trim() !== ""
      ? { additionalToolNames: cfg.additionalToolNames.trim() }
      : {}),
    observabilityVerbosity: cfg.observabilityVerbosity,
    mcpServerIds: cfg.mcpServerIds?.length ? cfg.mcpServerIds : undefined,
    agentTools: cfg.agentTools?.length ? cfg.agentTools : undefined,
    dynamicSubAgents: cfg.dynamicSubAgents?.enabled ? cfg.dynamicSubAgents : undefined,
    ...(Object.keys(cfg.taskContext ?? {}).length > 0 ? { taskContext: cfg.taskContext } : {}),
    ...(cfg.healthCheck ? { healthCheck: true as const } : {}),
    ...(cfg.skills?.paths?.length
      ? {
          skills: {
            paths: cfg.skills.paths,
            ...(cfg.skills.evolution ? { evolution: { ...cfg.skills.evolution } } : {}),
          },
        }
      : {}),
    ...(cfg.strategySwitching != null ? { strategySwitching: cfg.strategySwitching } : {}),
    // Reasoning kernel is the default; only send when the user opted into inline-think.
    ...(cfg.useReasoning === false ? { useReasoning: false as const } : {}),
    // Typed structured output — send the parsed JSON Schema when valid.
    ...(parseOutputSchema(cfg.outputSchema ?? "") !== undefined
      ? { outputSchema: parseOutputSchema(cfg.outputSchema ?? "") }
      : {}),
    // Budget caps — send when either limit is set.
    ...(cfg.budget && (cfg.budget.tokenLimit > 0 || cfg.budget.costLimit > 0)
      ? {
          budget: {
            ...(cfg.budget.tokenLimit > 0 ? { tokenLimit: cfg.budget.tokenLimit } : {}),
            ...(cfg.budget.costLimit > 0 ? { costLimit: cfg.budget.costLimit } : {}),
          },
        }
      : {}),
    // Numeric grounding — send when enabled.
    ...(cfg.grounding && cfg.grounding.mode !== "off" ? { grounding: { mode: cfg.grounding.mode } } : {}),
    // Durable execution (crash-resume + HITL). approvalTools → approvalPolicy gate.
    ...(cfg.durableRuns?.enabled
      ? {
          durableRuns: {
            enabled: true as const,
            ...(cfg.durableRuns.approvalTools.length
              ? { approvalPolicy: { tools: cfg.durableRuns.approvalTools, mode: "detach" as const } }
              : {}),
          },
        }
      : {}),
    ...(cfg.memory ? { memory: cfg.memory } : {}),
    ...(cfg.contextSynthesis ? { contextSynthesis: cfg.contextSynthesis } : {}),
    ...(cfg.guardrails?.enabled ? { guardrails: cfg.guardrails } : {}),
    ...(cfg.persona?.enabled ? { persona: cfg.persona } : {}),
    ...(cfg.variables?.length ? { variables: cfg.variables } : {}),
    ...(cfg.variables?.length && variableValues && Object.keys(variableValues).length
      ? { variableValues }
      : {}),
  };
}
