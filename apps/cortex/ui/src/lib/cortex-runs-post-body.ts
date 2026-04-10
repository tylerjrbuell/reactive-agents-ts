/**
 * JSON body for `POST /api/runs` — shared by Lab builder and Beacon stage store
 * so desk runs match server expectations (including `taskContext` → `withTaskContext`).
 */
import type { AgentConfig } from "./types/agent-config.js";

function shellExecuteActive(cfg: AgentConfig): boolean {
  return cfg.terminalTools === true || cfg.tools.includes("shell-execute");
}

/** Build the object passed to `JSON.stringify` for Cortex run creation. */
export function cortexRunsPostBody(prompt: string, cfg: AgentConfig): Record<string, unknown> {
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
    timeout: cfg.timeout || undefined,
    retryPolicy: cfg.retryPolicy.enabled ? cfg.retryPolicy : undefined,
    cacheTimeout: cfg.cacheTimeout || undefined,
    progressCheckpoint: cfg.progressCheckpoint || undefined,
    fallbacks: cfg.fallbacks.enabled ? cfg.fallbacks : undefined,
    metaTools: cfg.metaTools.enabled ? cfg.metaTools : undefined,
    verificationStep: cfg.verificationStep !== "none" ? cfg.verificationStep : undefined,
    ...(cfg.runtimeVerification ? { runtimeVerification: true as const } : {}),
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
    ...(cfg.memory ? { memory: cfg.memory } : {}),
    ...(cfg.contextSynthesis ? { contextSynthesis: cfg.contextSynthesis } : {}),
    ...(cfg.guardrails?.enabled ? { guardrails: cfg.guardrails } : {}),
    ...(cfg.persona?.enabled ? { persona: cfg.persona } : {}),
  };
}
