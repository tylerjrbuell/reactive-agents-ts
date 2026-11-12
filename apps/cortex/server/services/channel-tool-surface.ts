/**
 * Build-time tool narrowing for agents that answer channel senders.
 *
 * A route's non-owner sender gets an agent built with a SMALLER tool surface than the owner's, decided
 * here before the agent is built (never a per-turn filter, never a prompt line). Fails closed: a
 * built-in counts as read-only only when the framework positively says so (`isReadOnlyTool`:
 * `mutatesExternalState === false` and no approval needed). Everything the framework cannot classify
 * is removed from a `ReadOnly` surface: MCP servers, sub-agent tools, host tools, meta-tools, the
 * shell, and saved memory (a stranger must not read the owner's memory).
 *
 * This is the Cortex-side twin of the runtime's `narrowToolSurface` (`packages/runtime/src/agent/
 * channel-tool-narrowing.ts`), which works on a builder and is not exported from the runtime's
 * public index. Cortex builds from `AgentConfig` params, so it narrows the params; {@link
 * surfaceViolations} then checks the BUILT config, so a hop that re-opens a tool (a `rawConfig`
 * override, an overlay) fails the build instead of reaching a stranger. Framework gap reported:
 * export `narrowToolSurface` so there is one narrowing, not two.
 */
import { builtinTools, isReadOnlyTool } from "@reactive-agents/tools";
import type { ToolDefinition } from "@reactive-agents/tools";
import type { ToolExposure } from "@reactive-agents/channels";
import type { AgentConfig } from "@reactive-agents/runtime";
import type { BuildCortexAgentParams } from "./build-cortex-agent.js";
import { mergeCortexUiToolNames } from "./cortex-agent-config.js";
import { shellExecuteRequested } from "./cortex-to-agent-config.js";

/** Tools every Cortex agent carries so the kernel can finish a turn; they are never sender-facing capability. */
const KERNEL_REQUIRED = ["final-answer", "task-complete", "context-status"] as const;

const BUILTIN_DEFINITIONS: ReadonlyMap<string, ToolDefinition> = new Map(
  builtinTools.map((t) => [t.definition.name, t.definition] as const),
);

/** `rawConfig` keys that could re-open a removed capability once the curated fields are gone. */
const RAW_CONFIG_REOPENERS = ["tools", "mcpServers", "agentTools", "metaTools", "memory", "dynamicSubAgents", "gateway", "channels"] as const;

/** Whether `exposure` lets a tool named `name` through. */
const permitted = (name: string, exposure: ToolExposure): boolean => {
  if (exposure._tag === "AgentDefault") return true;
  if (exposure._tag === "Allowlist") return exposure.tools.includes(name);
  const def = BUILTIN_DEFINITIONS.get(name);
  return def !== undefined && isReadOnlyTool(def);
};

/** The tool names the agent's params select today (the user's pick, plus the shell when requested). */
export const selectedToolNames = (params: BuildCortexAgentParams): string[] => {
  const names = mergeCortexUiToolNames(params.tools, params.additionalToolNames);
  if (shellExecuteRequested(params) && !names.includes("shell-execute")) names.push("shell-execute");
  return names;
};

/**
 * The params for the agent that answers a sender with `exposure`. `AgentDefault` returns `params`
 * unchanged. `ReadOnly` keeps the selected built-ins that are read-only; `Allowlist` keeps the
 * selected tools it names (it never adds a tool the agent did not already have).
 */
export const narrowCortexParams = (params: BuildCortexAgentParams, exposure: ToolExposure): BuildCortexAgentParams => {
  if (exposure._tag === "AgentDefault") return params;
  const selected = selectedToolNames(params);
  const kept = selected.filter((n) => permitted(n, exposure));
  const keepsShell = kept.includes("shell-execute");
  const rawConfig = params.rawConfig
    ? Object.fromEntries(Object.entries(params.rawConfig).filter(([k]) => !(RAW_CONFIG_REOPENERS as readonly string[]).includes(k)))
    : undefined;
  const {
    additionalToolNames: _additional,
    extraTools: _extra,
    agentTools: _agentTools,
    dynamicSubAgents: _subAgents,
    terminalTools: _terminal,
    terminalShellAdditionalCommands: _shellAdd,
    terminalShellAllowedCommands: _shellAllow,
    terminalShellOptions: _shellOptions,
    rawConfig: _raw,
    ...rest
  } = params;
  return {
    ...rest,
    tools: kept,
    mcpConfigs: [],
    // Cortex builds WITH memory unless the params say all tiers are off (an explicit choice, no layer).
    // Memory is keyed on the agent id, so a stranger's agent would read and write the owner's memory.
    memory: { working: false, episodic: false, semantic: false },
    metaTools: { ...(params.metaTools ?? {}), enabled: false },
    // Shell settings survive only when an Allowlist names the shell; the approval gate still applies to it.
    ...(keepsShell
      ? {
          terminalTools: true as const,
          ...(params.terminalShellAdditionalCommands ? { terminalShellAdditionalCommands: params.terminalShellAdditionalCommands } : {}),
          ...(params.terminalShellAllowedCommands ? { terminalShellAllowedCommands: params.terminalShellAllowedCommands } : {}),
          ...(params.terminalShellOptions ? { terminalShellOptions: params.terminalShellOptions } : {}),
        }
      : {}),
    ...(rawConfig && Object.keys(rawConfig).length > 0 ? { rawConfig } : {}),
  };
};

const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v)) : undefined;

/**
 * What a BUILT agent config still exposes beyond `exposure`. Empty means the surface holds. A
 * non-empty list is a hard failure for the resolver: the agent is not built, the turn fails closed.
 */
export const surfaceViolations = (config: AgentConfig, exposure: ToolExposure): string[] => {
  if (exposure._tag === "AgentDefault") return [];
  const c = obj(config) ?? {};
  const out: string[] = [];
  const tools = obj(c.tools);
  const allowed = Array.isArray(tools?.allowedTools) ? tools.allowedTools.filter((t): t is string => typeof t === "string") : [];
  for (const name of allowed) {
    if (!(KERNEL_REQUIRED as readonly string[]).includes(name) && !permitted(name, exposure)) out.push(`tool ${name}`);
  }
  if (tools?.terminal && !(exposure._tag === "Allowlist" && exposure.tools.includes("shell-execute"))) out.push("shell terminal");
  if (Array.isArray(c.mcpServers) && c.mcpServers.length > 0) out.push("mcp servers");
  if (Array.isArray(c.agentTools) && c.agentTools.length > 0) out.push("sub-agent tools");
  if (obj(c.dynamicSubAgents)?.enabled === true) out.push("dynamic sub-agents");
  if (obj(c.metaTools)?.enabled === true) out.push("meta-tools");
  const memory = obj(c.memory);
  if (memory && Object.keys(memory).length > 0) out.push("memory");
  return out;
};
