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
  // Local providers honor num_ctx; their own default (Ollama 2048) commonly
  // breaks tool-calling once the system prompt + tool schema overflow the window.
  // When the user leaves numCtx unset on a local provider, default to 8192 (best
  // practice — see wiki/Research/Audit-Reports-2026-06-09/cortex-agent-quality-parity-audit.md).
  // No-op for cloud providers, which ignore num_ctx.
  const LOCAL_PROVIDERS = new Set(["ollama", "litellm"]);
  if (typeof params.numCtx === "number" && params.numCtx > 0) {
    draft.numCtx = params.numCtx;
  } else if (LOCAL_PROVIDERS.has(provider)) {
    draft.numCtx = 8192;
  }

  // No model sentinel needed: agentConfigToBuilder applies temperature/maxTokens/
  // numCtx/thinking independently of `model` (framework fix, audit C1/C2).

  if (params.systemPrompt?.trim()) draft.systemPrompt = params.systemPrompt.trim();

  const reasoning: Record<string, unknown> = {};
  if (params.strategy) {
    reasoning.defaultStrategy = params.strategy;
  }
  if (params.strategySwitching === true) reasoning.enableStrategySwitching = true;
  if (params.auditRationale === true) reasoning.auditRationale = true;
  if (Object.keys(reasoning).length > 0) draft.reasoning = reasoning;

  // Cortex agents run the full reasoning kernel by DEFAULT — calibration,
  // 4-stage tool-call healing, strategy selection/switching, and the durable
  // checkpoint + HITL approval gate all live there. The desk can opt into the
  // lighter inline-think path via `useReasoning: false`. Durable runs always
  // force reasoning on (their seam + gate exist only in the kernel).
  const enableReasoning = params.useReasoning !== false || !!params.durableRuns?.enabled;
  const prevFeatures =
    draft.features && typeof draft.features === "object" && !Array.isArray(draft.features)
      ? (draft.features as Record<string, unknown>)
      : {};
  draft.features = { ...prevFeatures, reasoning: enableReasoning };

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
