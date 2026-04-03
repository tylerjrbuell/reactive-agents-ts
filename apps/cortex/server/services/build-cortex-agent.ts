/**
 * Shared agent builder for Cortex.
 *
 * Both `runner-service` (ad-hoc POST /api/runs) and `gateway-process-manager`
 * (scheduled/gateway runs) go through this single function so the builder chain
 * is never duplicated.
 */
import { ReactiveAgents, type ProviderName, type ModelParams, type ObservabilityOptions, type MCPServerConfig } from "@reactive-agents/runtime";
import type { ReasoningOptions } from "@reactive-agents/runtime";
import { ensureParentDirForFile } from "./ensure-log-path.js";
import {
  mergeCortexAllowedTools,
  type CortexAgentToolEntry,
  type CortexDynamicSubAgentsConfig,
  type CortexMetaToolsConfig,
  type CortexSkillsConfig,
} from "./cortex-agent-config.js";

export interface BuildCortexAgentParams {
  readonly agentName?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly strategy?: string;
  readonly maxIterations?: number;
  readonly minIterations?: number;
  readonly systemPrompt?: string;
  readonly taskContext?: Record<string, string>;
  readonly healthCheck?: boolean;
  readonly skills?: CortexSkillsConfig;
  /** Resolved MCP server configs (caller resolves IDs → configs before calling). */
  readonly mcpConfigs?: MCPServerConfig[];
  readonly tools?: string[];
  readonly agentTools?: CortexAgentToolEntry[];
  readonly dynamicSubAgents?: CortexDynamicSubAgentsConfig;
  readonly metaTools?: CortexMetaToolsConfig;
  readonly timeout?: number;
  readonly retryPolicy?: { enabled?: boolean; maxRetries: number; backoffMs?: number };
  readonly cacheTimeout?: number;
  readonly progressCheckpoint?: number;
  readonly fallbacks?: { enabled?: boolean; providers?: string[]; errorThreshold?: number };
  readonly verificationStep?: string;
  readonly observabilityVerbosity?: "off" | "minimal" | "normal" | "verbose";
  // ── Five previously dead-end fields ──────────────────────────────────────
  /** When true, enables automatic strategy switching on loop detection. */
  readonly strategySwitching?: boolean;
  /** Memory tier selection. All false/undefined = working only (standard). episodic or semantic = enhanced. */
  readonly memory?: {
    readonly working?: boolean;
    readonly episodic?: boolean;
    readonly semantic?: boolean;
  };
  /**
   * Context synthesis mode.
   * Maps to ReasoningOptions.synthesis:
   *   "auto"     → "auto"
   *   "template" → "fast"
   *   "llm"      → "deep"
   *   "none"     → "off"
   */
  readonly contextSynthesis?: "auto" | "template" | "llm" | "none";
  /**
   * Guardrails config. When enabled, wires .withGuardrails().
   * injectionThreshold / piiThreshold / toxicityThreshold are currently
   * not exposed by the framework's GuardrailsOptions (which uses boolean
   * flags only), so the presence of a non-zero threshold is treated as
   * enabling that detector.
   */
  readonly guardrails?: {
    readonly enabled?: boolean;
    readonly injectionThreshold?: number;
    readonly piiThreshold?: number;
    readonly toxicityThreshold?: number;
  };
  /** Persona config. Mapped to builder .withPersona() when enabled. */
  readonly persona?: {
    readonly enabled?: boolean;
    readonly role?: string;
    readonly tone?: string;
    readonly traits?: string;
    readonly responseStyle?: string;
  };
}

/**
 * Build a configured ReactiveAgent from the Cortex params.
 * Returns the built agent (result of `.build()`).
 */
export async function buildCortexAgent(
  params: BuildCortexAgentParams,
  agentNameFallback?: string,
): ReturnType<ReturnType<typeof ReactiveAgents.create>["build"]> {
  const agentName = params.agentName?.trim() || agentNameFallback || `cortex-desk-${Date.now()}`;
  const providerRaw = params.provider ?? process.env.CORTEX_RUNNER_PROVIDER ?? "test";

  let b = ReactiveAgents.create()
    .withName(agentName)
    .withProvider(providerRaw as ProviderName);

  // ── Model / inference ──────────────────────────────────────────────────
  // ModelParams.model is required; fall back to "" when only temperature/maxTokens
  // are set (no dedicated withTemperature/withMaxTokens setters exist on the builder).
  if (params.model?.trim() || params.temperature != null || params.maxTokens) {
    const mp: ModelParams = {
      model: params.model?.trim() ?? "",
      ...(params.temperature != null ? { temperature: params.temperature } : {}),
      ...(params.maxTokens ? { maxTokens: params.maxTokens } : {}),
    };
    b = b.withModel(mp);
  }

  // ── Reasoning ──────────────────────────────────────────────────────────
  const reasoningOptsRaw: Record<string, unknown> = {};
  if (params.strategy) reasoningOptsRaw.defaultStrategy = params.strategy;
  if (params.maxIterations && params.maxIterations > 0) {
    reasoningOptsRaw.maxIterations = params.maxIterations;
  }
  if (params.strategySwitching === true) {
    reasoningOptsRaw.enableStrategySwitching = true;
  }
  if (params.contextSynthesis && params.contextSynthesis !== "none") {
    const synthesisMap: Record<string, "auto" | "fast" | "deep" | "custom" | "off"> = {
      auto: "auto",
      template: "fast",
      llm: "deep",
    };
    reasoningOptsRaw.synthesis = synthesisMap[params.contextSynthesis] ?? "auto";
  }
  if (Object.keys(reasoningOptsRaw).length > 0) {
    b = b.withReasoning(reasoningOptsRaw as ReasoningOptions);
  }

  // ── Memory ─────────────────────────────────────────────────────────────
  // episodic or semantic → enhanced tier; otherwise standard (no-args = tier "1")
  const needsEnhancedMemory = params.memory?.episodic === true || params.memory?.semantic === true;
  if (needsEnhancedMemory) {
    b = b.withMemory({ tier: "enhanced" });
  } else {
    b = b.withMemory();
  }

  // ── MCP servers ────────────────────────────────────────────────────────
  for (const c of params.mcpConfigs ?? []) {
    b = b.withMCP(c);
  }

  // ── Sub-agents / agent tools ───────────────────────────────────────────
  for (const at of params.agentTools ?? []) {
    if (at.kind === "remote") {
      b = b.withRemoteAgent(at.toolName, at.remoteUrl);
    } else {
      b = b.withAgentTool(at.toolName, {
        name: at.agent.name,
        ...(at.agent.description ? { description: at.agent.description } : {}),
        ...(at.agent.provider ? { provider: at.agent.provider } : {}),
        ...(at.agent.model ? { model: at.agent.model } : {}),
        ...(at.agent.tools && at.agent.tools.length > 0 ? { tools: [...at.agent.tools] } : {}),
        ...(at.agent.maxIterations ? { maxIterations: at.agent.maxIterations } : {}),
        ...(at.agent.systemPrompt ? { systemPrompt: at.agent.systemPrompt } : {}),
      });
    }
  }
  if (params.dynamicSubAgents?.enabled) {
    b = b.withDynamicSubAgents(
      params.dynamicSubAgents.maxIterations
        ? { maxIterations: params.dynamicSubAgents.maxIterations }
        : undefined,
    );
  }

  // ── Tool allowlist / tool layer ────────────────────────────────────────
  const allowExtras = {
    spawnAgent: params.dynamicSubAgents?.enabled === true,
    agentToolNames: params.agentTools?.map((t) => t.toolName) ?? [],
  };
  const userTools = params.tools ?? [];
  const mergedAllowed = mergeCortexAllowedTools(userTools, params.metaTools, allowExtras);
  const needsToolLayer =
    (params.mcpConfigs?.length ?? 0) > 0 ||
    (params.agentTools && params.agentTools.length > 0) ||
    params.dynamicSubAgents?.enabled === true ||
    (params.tools && params.tools.length > 0) ||
    params.metaTools?.enabled === true;
  if (needsToolLayer) {
    b = b.withTools({ allowedTools: mergedAllowed });
  }

  // ── System prompt ──────────────────────────────────────────────────────
  if (params.systemPrompt?.trim()) b = b.withSystemPrompt(params.systemPrompt.trim());

  // ── Task context / health check ────────────────────────────────────────
  const tc = params.taskContext;
  if (tc && Object.keys(tc).length > 0) b = b.withTaskContext(tc);
  if (params.healthCheck === true) b = b.withHealthCheck();

  // ── Skills ─────────────────────────────────────────────────────────────
  if (params.skills?.paths?.length) {
    b = b.withSkills({
      paths: [...params.skills.paths],
      ...(params.skills.evolution ? { evolution: { ...params.skills.evolution } } : {}),
    });
  }

  // ── Execution controls ─────────────────────────────────────────────────
  if (params.timeout && params.timeout > 0) b = b.withTimeout(params.timeout);
  if (params.retryPolicy?.enabled && params.retryPolicy.maxRetries) {
    b = b.withRetryPolicy({
      maxRetries: params.retryPolicy.maxRetries,
      backoffMs: params.retryPolicy.backoffMs ?? 1000,
    });
  }
  if (params.cacheTimeout && params.cacheTimeout > 0) b = b.withCacheTimeout(params.cacheTimeout);
  if (params.progressCheckpoint && params.progressCheckpoint > 0) {
    b = b.withProgressCheckpoint(params.progressCheckpoint);
  }
  if (params.minIterations && params.minIterations > 0) b = b.withMinIterations(params.minIterations);
  if (params.verificationStep === "reflect") b = b.withVerificationStep({ mode: "reflect" });

  // ── Fallbacks ──────────────────────────────────────────────────────────
  if (params.fallbacks?.enabled && params.fallbacks.providers?.length) {
    b = b.withFallbacks({
      providers: params.fallbacks.providers,
      errorThreshold: params.fallbacks.errorThreshold ?? 3,
    });
  }

  // ── Meta tools (Conductor's Suite) ────────────────────────────────────
  if (params.metaTools?.enabled) {
    b = b.withMetaTools({
      brief: params.metaTools.brief ?? false,
      find: params.metaTools.find ?? false,
      pulse: params.metaTools.pulse ?? false,
      recall: params.metaTools.recall ?? false,
      harnessSkill: params.metaTools.harnessSkill ?? false,
    });
  }

  // ── Guardrails ─────────────────────────────────────────────────────────
  // The framework's GuardrailsOptions uses boolean flags (injection/pii/toxicity).
  // Cortex UI has threshold numbers; treat any non-zero threshold as enabling
  // that detector. If guardrails.enabled is false we skip entirely.
  if (params.guardrails?.enabled === true) {
    b = b.withGuardrails({
      injection: params.guardrails.injectionThreshold != null
        ? params.guardrails.injectionThreshold > 0
        : true,
      pii: params.guardrails.piiThreshold != null
        ? params.guardrails.piiThreshold > 0
        : true,
      toxicity: params.guardrails.toxicityThreshold != null
        ? params.guardrails.toxicityThreshold > 0
        : true,
    });
  }

  // ── Persona ────────────────────────────────────────────────────────────
  if (params.persona?.enabled === true) {
    const p = params.persona;
    // traits → instructions; responseStyle appended to instructions if provided
    const instructionParts: string[] = [];
    if (p.traits) instructionParts.push(p.traits);
    if (p.responseStyle) instructionParts.push(`Response style: ${p.responseStyle}`);
    b = b.withPersona({
      ...(p.role ? { role: p.role } : {}),
      ...(p.tone ? { tone: p.tone } : {}),
      ...(instructionParts.length > 0 ? { instructions: instructionParts.join("\n") } : {}),
    });
  }

  // ── Observability / logging ────────────────────────────────────────────
  if (params.observabilityVerbosity && params.observabilityVerbosity !== "off") {
    const obsOpts: ObservabilityOptions = {
      verbosity: params.observabilityVerbosity,
      live: true,
    };
    b = b.withObservability(obsOpts);
    const agentLogFile = process.env.CORTEX_AGENT_LOG_FILE ?? ".cortex/logs/agent-debug.log";
    ensureParentDirForFile(agentLogFile);
    b = b.withLogging({
      level: params.observabilityVerbosity === "verbose" ? "debug" : "info",
      format: "json",
      output: "file",
      filePath: agentLogFile,
    });
  }

  return b.build();
}
