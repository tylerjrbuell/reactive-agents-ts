/**
 * Shared agent builder for Cortex.
 *
 * Both `runner-service` (ad-hoc POST /api/runs) and `gateway-process-manager`
 * (scheduled/gateway runs) go through this single function so the builder chain
 * is never duplicated.
 *
 * Architecture: cortexParamsToAgentConfig() maps Cortex UI fields → AgentConfig,
 * then agentConfigToBuilder() handles all schema-covered fields. A thin overlay
 * applies Cortex-specific fields that have no AgentConfig representation.
 */
import type { TestTurn } from "@reactive-agents/llm-provider";
import type { ShellExecuteConfig } from "@reactive-agents/tools";
import {
  agentConfigToBuilder,
  ReactiveAgents,
  type MCPServerConfig,
} from "@reactive-agents/runtime";
import type { ReasoningOptions } from "@reactive-agents/runtime";
import { ensureParentDirForFile } from "./ensure-log-path.js";
import {
  mergeCortexAllowedTools,
  mergeCortexUiToolNames,
  splitCortexListInput,
  type CortexAgentToolEntry,
  type CortexDynamicSubAgentsConfig,
  type CortexMetaToolsConfig,
  type CortexSkillsConfig,
} from "./cortex-agent-config.js";
import { cortexParamsToAgentConfig } from "./cortex-to-agent-config.js";

export interface BuildCortexAgentParams {
  readonly agentName?: string;
  /**
   * Stable agent identity to use for this build.
   * When set, the framework uses this instead of generating a name-timestamp ID.
   * All memory keyed on agentId accumulates across server restarts.
   */
  readonly agentId?: string;
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
  /** Comma or newline separated tool IDs merged into {@link tools} for `allowedTools` (e.g. Lab custom tools). */
  readonly additionalToolNames?: string;
  readonly agentTools?: CortexAgentToolEntry[];
  readonly dynamicSubAgents?: CortexDynamicSubAgentsConfig;
  readonly metaTools?: CortexMetaToolsConfig;
  readonly timeout?: number;
  readonly retryPolicy?: { enabled?: boolean; maxRetries: number; backoffMs?: number };
  readonly cacheTimeout?: number;
  readonly progressCheckpoint?: number;
  readonly fallbacks?: { enabled?: boolean; providers?: string[]; errorThreshold?: number };
  readonly verificationStep?: string;
  /** Enables `@reactive-agents/verification` (semantic checks, etc.). Separate from `verificationStep: "reflect"`. */
  readonly runtimeVerification?: boolean;
  /**
   * Registers host `shell-execute` with framework defaults (allowlist/blocklist). Caller assumes risk.
   * When true, `shell-execute` is merged into allowed tools if not already listed.
   */
  readonly terminalTools?: boolean;
  /**
   * First executable token names added to shell-execute via `ShellExecuteConfig.additionalCommands`
   * (e.g. `node`, `bun`, `gh`). Only applied when host shell is active.
   */
  readonly terminalShellAdditionalCommands?: string;
  /**
   * When non-empty, sets `ShellExecuteConfig.allowedCommands` to this list only (replaces framework defaults).
   * Use with care — omit helpers like `echo` if you replace the whole list.
   */
  readonly terminalShellAllowedCommands?: string;
  readonly observabilityVerbosity?: "off" | "minimal" | "normal" | "verbose";
  /** When true, enables automatic strategy switching on loop detection. */
  readonly strategySwitching?: boolean;
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
   *   "none"     → off (omitted)
   */
  readonly contextSynthesis?: "auto" | "template" | "llm" | "none";
  readonly guardrails?: {
    readonly enabled?: boolean;
    readonly injectionThreshold?: number;
    readonly piiThreshold?: number;
    readonly toxicityThreshold?: number;
  };
  readonly persona?: {
    readonly enabled?: boolean;
    readonly role?: string;
    readonly tone?: string;
    readonly traits?: string;
    readonly responseStyle?: string;
  };
  /** When set (e.g. desk chat with `provider: "test"`), wires `withTestScenario` on the builder. */
  readonly testScenario?: readonly TestTurn[];
  /** When true, enables streaming mode for TextDelta event emission. */
  readonly streaming?: boolean;
}

/**
 * Build a configured ReactiveAgent from Cortex params.
 *
 * Step 1: cortexParamsToAgentConfig() → AgentConfig (schema-shaped)
 * Step 2: agentConfigToBuilder() → ReactiveAgentBuilder (framework handles AgentConfig fields)
 * Step 3: Cortex overlay → fields not covered by AgentConfig
 */
export async function buildCortexAgent(
  params: BuildCortexAgentParams,
  agentNameFallback?: string,
): ReturnType<ReturnType<typeof ReactiveAgents.create>["build"]> {
  const agentConfig = cortexParamsToAgentConfig(params, agentNameFallback);

  let b = await agentConfigToBuilder(agentConfig);

  if (params.agentId) b = b.withAgentId(params.agentId);

  if (params.testScenario && params.testScenario.length > 0) {
    b = b.withTestScenario([...params.testScenario]);
  }

  // Legacy parity: always enable the memory layer when the desk did not map memory tiers.
  if (!agentConfig.memory) {
    b = b.withMemory();
  }

  if (params.observabilityVerbosity && params.observabilityVerbosity !== "off") {
    const agentLogFile = process.env.CORTEX_AGENT_LOG_FILE ?? ".cortex/logs/agent-debug.log";
    ensureParentDirForFile(agentLogFile);
  }

  // Builder replaces `_reasoningOptions` on each `withReasoning` call — merge schema-derived
  // reasoning with ICS synthesis so we do not drop defaultStrategy / strategy switching.
  if (params.contextSynthesis && params.contextSynthesis !== "none") {
    const synthesisMap: Record<string, ReasoningOptions["synthesis"]> = {
      auto: "auto",
      template: "fast",
      llm: "deep",
    };
    const synthesis = synthesisMap[params.contextSynthesis] ?? "auto";
    const r = agentConfig.reasoning;
    b = b.withReasoning({
      ...(r?.defaultStrategy ? { defaultStrategy: r.defaultStrategy } : {}),
      ...(r?.enableStrategySwitching !== undefined
        ? { enableStrategySwitching: r.enableStrategySwitching }
        : {}),
      ...(r?.maxStrategySwitches !== undefined ? { maxStrategySwitches: r.maxStrategySwitches } : {}),
      ...(r?.fallbackStrategy ? { fallbackStrategy: r.fallbackStrategy } : {}),
      synthesis,
    } as ReasoningOptions);
  }

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

  const allowExtras = {
    spawnAgent: params.dynamicSubAgents?.enabled === true,
    agentToolNames: params.agentTools?.map((t) => t.toolName) ?? [],
  };
  /** Host shell config counts as shell intent even if `shell-execute` is missing from `tools` (e.g. stale client JSON). */
  const hasShellTerminalConfig =
    splitCortexListInput(params.terminalShellAdditionalCommands).length > 0 ||
    splitCortexListInput(params.terminalShellAllowedCommands).length > 0;
  const shellRequested =
    params.terminalTools === true ||
    mergeCortexUiToolNames(params.tools, params.additionalToolNames).includes("shell-execute") ||
    hasShellTerminalConfig;
  let userTools = mergeCortexUiToolNames(params.tools, params.additionalToolNames);
  if (shellRequested && !userTools.includes("shell-execute")) {
    userTools.push("shell-execute");
  }
  const mergedAllowed = mergeCortexAllowedTools(userTools, params.metaTools, allowExtras);
  const needsToolLayer =
    (params.mcpConfigs?.length ?? 0) > 0 ||
    (params.agentTools && params.agentTools.length > 0) ||
    params.dynamicSubAgents?.enabled === true ||
    userTools.length > 0 ||
    params.metaTools?.enabled === true ||
    shellRequested;
  if (needsToolLayer) {
    // Register allowedTools first; apply shell **only** via `withTerminalTools()` so
    // `ShellExecuteConfig` (additionalCommands / allowedCommands) is merged on
    // `_toolsOptions.terminal` reliably. Passing a config object through a second
    // `withTools({ terminal: {...} })` merge can lose nested config in some chains.
    b = b.withTools({ allowedTools: mergedAllowed });
    if (shellRequested) {
      const addl = splitCortexListInput(params.terminalShellAdditionalCommands);
      const allowOnly = splitCortexListInput(params.terminalShellAllowedCommands);
      if (allowOnly.length === 0 && addl.length === 0) {
        b = b.withTerminalTools();
      } else {
        b = b.withTerminalTools({
          ...(allowOnly.length > 0 ? { allowedCommands: allowOnly } : {}),
          ...(addl.length > 0 ? { additionalCommands: addl } : {}),
        } as ShellExecuteConfig);
      }
    }
  } else if (shellRequested) {
    const addl = splitCortexListInput(params.terminalShellAdditionalCommands);
    const allowOnly = splitCortexListInput(params.terminalShellAllowedCommands);
    b =
      allowOnly.length === 0 && addl.length === 0
        ? b.withTerminalTools()
        : b.withTerminalTools({
            ...(allowOnly.length > 0 ? { allowedCommands: allowOnly } : {}),
            ...(addl.length > 0 ? { additionalCommands: addl } : {}),
          } as ShellExecuteConfig);
  }

  const tc = params.taskContext;
  if (tc && Object.keys(tc).length > 0) b = b.withTaskContext(tc);

  if (params.skills?.paths?.length) {
    b = b.withSkills({
      paths: [...params.skills.paths],
      ...(params.skills.evolution ? { evolution: { ...params.skills.evolution } } : {}),
    });
  }

  if (params.minIterations && params.minIterations > 0) b = b.withMinIterations(params.minIterations);
  if (params.progressCheckpoint && params.progressCheckpoint > 0) {
    b = b.withProgressCheckpoint(params.progressCheckpoint);
  }
  if (params.verificationStep === "reflect") b = b.withVerificationStep({ mode: "reflect" });

  if (params.runtimeVerification === true) {
    b = b.withVerification();
  }

  if (params.metaTools?.enabled) {
    b = b.withMetaTools({
      brief: params.metaTools.brief ?? false,
      find: params.metaTools.find ?? false,
      pulse: params.metaTools.pulse ?? false,
      recall: params.metaTools.recall ?? false,
      harnessSkill: params.metaTools.harnessSkill ?? false,
    });
  }

  if (params.streaming === true) {
    b = b.withStreaming();
  }

  // Desk / runner pause, resume, and stop call ReactiveAgent.pause|resume|stop (KillSwitchService).
  b = b.withKillSwitch();

  return b.build();
}
