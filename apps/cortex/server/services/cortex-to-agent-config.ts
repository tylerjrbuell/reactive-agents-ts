/**
 * Maps BuildCortexAgentParams → AgentConfig (framework schema).
 *
 * Covers all fields that have a direct AgentConfig representation.
 * Cortex-specific fields with no AgentConfig equivalent (skills, agentTools,
 * metaTools, dynamicSubAgents, taskContext, minIterations, progressCheckpoint,
 * verificationStep, contextSynthesis) are handled as overlays in build-cortex-agent.ts.
 */
import { Schema } from "effect";
import { AgentConfigSchema, type AgentConfig } from "@reactive-agents/runtime";
import type { BuildCortexAgentParams } from "./build-cortex-agent.js";

export function cortexParamsToAgentConfig(
  params: BuildCortexAgentParams,
  nameFallback?: string,
): AgentConfig {
  const name = params.agentName?.trim() || nameFallback || `cortex-desk-${Date.now()}`;
  const provider = (params.provider ?? process.env.CORTEX_RUNNER_PROVIDER ?? "test") as AgentConfig["provider"];

  const draft: Record<string, unknown> = { name, provider };

  const modelStr = params.model?.trim();
  if (modelStr) draft.model = modelStr;

  if (params.temperature != null) draft.temperature = params.temperature;
  if (params.maxTokens) draft.maxTokens = params.maxTokens;

  if (
    (params.temperature != null || (params.maxTokens != null && params.maxTokens > 0)) &&
    !modelStr
  ) {
    draft.model = "";
  }

  if (params.systemPrompt?.trim()) draft.systemPrompt = params.systemPrompt.trim();

  const reasoning: Record<string, unknown> = {};
  if (params.strategy) {
    reasoning.defaultStrategy = params.strategy;
  }
  if (params.strategySwitching === true) reasoning.enableStrategySwitching = true;
  if (Object.keys(reasoning).length > 0) draft.reasoning = reasoning;

  const execution: Record<string, unknown> = {};
  if (params.maxIterations && params.maxIterations > 0) execution.maxIterations = params.maxIterations;
  if (params.timeout && params.timeout > 0) execution.timeoutMs = params.timeout;
  if (params.cacheTimeout && params.cacheTimeout > 0) execution.cacheTimeoutMs = params.cacheTimeout;
  if (params.retryPolicy?.enabled === true && params.retryPolicy.maxRetries > 0) {
    execution.retryPolicy = {
      maxRetries: params.retryPolicy.maxRetries,
      backoffMs: params.retryPolicy.backoffMs ?? 1000,
    };
  }
  if (Object.keys(execution).length > 0) draft.execution = execution;

  if (params.tools && params.tools.length > 0) {
    draft.tools = { allowedTools: [...params.tools] };
  }

  if (params.memory) {
    const tier =
      params.memory.episodic === true || params.memory.semantic === true ? "enhanced" : "standard";
    draft.memory = { tier };
  }

  if (params.guardrails?.enabled === true) {
    draft.guardrails = {
      injection:
        params.guardrails.injectionThreshold != null
          ? params.guardrails.injectionThreshold > 0
          : true,
      pii:
        params.guardrails.piiThreshold != null ? params.guardrails.piiThreshold > 0 : true,
      toxicity:
        params.guardrails.toxicityThreshold != null
          ? params.guardrails.toxicityThreshold > 0
          : true,
    };
  }

  if (params.persona?.enabled === true) {
    const p = params.persona;
    const instructionParts: string[] = [];
    if (p.traits) instructionParts.push(p.traits);
    if (p.responseStyle) instructionParts.push(`Response style: ${p.responseStyle}`);
    draft.persona = {
      ...(p.role ? { role: p.role } : {}),
      ...(p.tone ? { tone: p.tone } : {}),
      ...(instructionParts.length > 0 ? { instructions: instructionParts.join("\n") } : {}),
    };
  }

  if (params.observabilityVerbosity && params.observabilityVerbosity !== "off") {
    draft.observability = {
      verbosity: params.observabilityVerbosity,
      live: true,
    };
    draft.logging = {
      level: params.observabilityVerbosity === "verbose" ? "debug" : "info",
      format: "json",
      output: "file",
      filePath: process.env.CORTEX_AGENT_LOG_FILE ?? ".cortex/logs/agent-debug.log",
    };
  }

  if (params.fallbacks?.enabled === true && params.fallbacks.providers?.length) {
    draft.fallbacks = {
      providers: [...params.fallbacks.providers],
      ...(params.fallbacks.errorThreshold != null ? { errorThreshold: params.fallbacks.errorThreshold } : {}),
    };
  }

  if (params.mcpConfigs && params.mcpConfigs.length > 0) {
    draft.mcpServers = params.mcpConfigs;
  }

  if (params.healthCheck === true) {
    const prev =
      draft.features && typeof draft.features === "object" && !Array.isArray(draft.features)
        ? (draft.features as Record<string, unknown>)
        : {};
    draft.features = { ...prev, healthCheck: true };
  }

  return Schema.decodeUnknownSync(AgentConfigSchema)(draft);
}
