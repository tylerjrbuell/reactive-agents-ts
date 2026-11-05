/**
 * User risk-level overrides for registered tools — `.withTools({ riskLevels })`.
 *
 * A tool's `riskLevel` is set by whoever defines it (built-ins ship fixed
 * levels in `@reactive-agents/tools`; `file-read` is "medium"). Consumers of
 * the level include the kernel's text tool-call parser, which executes a call
 * EMBEDDED in prose or code (`const x = fileRead("/abs")`) only for "low"
 * tools. The builder lets users restate a level per tool name; the override is
 * applied at ONE point: the runtime's ToolService view (see
 * {@link withRiskLevelOverrides}), which is where the engine reads tool
 * definitions for a run (`listTools()` → `toKernelToolSchema`). Built-in,
 * custom and MCP tools are covered alike because they are all read through
 * that view.
 *
 * Known limit: `ToolService.execute` consults the optional `ToolApprovalGate`
 * with the REGISTRY definition, so a user-provided approval gate still sees the
 * tool's original level. Closing that needs a registry-level override in
 * `@reactive-agents/tools`.
 */
import { Effect } from "effect";
import type { Context } from "effect";
import { BUILTIN_TOOL_NAMES, shellExecuteTool } from "@reactive-agents/tools";
import type { ToolDefinition, ToolService } from "@reactive-agents/tools";
import { META_TOOLS } from "@reactive-agents/reasoning";

/** A tool risk level — the `ToolDefinition.riskLevel` union. */
export type ToolRiskLevel = ToolDefinition["riskLevel"];

/** Tool name → risk level that replaces the tool's declared level. */
export type ToolRiskLevelOverrides = Readonly<Record<string, ToolRiskLevel>>;

type ToolServiceShape = Context.Tag.Service<typeof ToolService>;

/**
 * Return `def` with its `riskLevel` replaced when `overrides` names the tool.
 * Returns the same object when there is no override (no copy).
 */
export const applyRiskLevelOverride = (
  def: ToolDefinition,
  overrides: ToolRiskLevelOverrides,
): ToolDefinition => {
  const level = Object.prototype.hasOwnProperty.call(overrides, def.name)
    ? overrides[def.name]
    : undefined;
  return level === undefined || level === def.riskLevel ? def : { ...def, riskLevel: level };
};

/**
 * Decorate a ToolService so every definition it hands out carries the user's
 * risk-level overrides: `listTools`, `getTool` and the `riskLevel` filter of
 * `listTools` all see the overridden level. Execution, registration and MCP
 * calls pass through unchanged.
 *
 * Returns `base` itself when `overrides` is empty, so the default path is the
 * undecorated service.
 */
export const withRiskLevelOverrides = (
  base: ToolServiceShape,
  overrides: ToolRiskLevelOverrides | undefined,
): ToolServiceShape => {
  if (!overrides || Object.keys(overrides).length === 0) return base;
  const apply = (def: ToolDefinition) => applyRiskLevelOverride(def, overrides);
  return {
    ...base,
    listTools: (filter) => {
      const { riskLevel, ...rest } = filter ?? {};
      return base.listTools(rest).pipe(
        Effect.map((defs) => {
          const mapped = defs.map(apply);
          return riskLevel === undefined
            ? mapped
            : mapped.filter((d) => d.riskLevel === riskLevel);
        }),
      );
    },
    getTool: (name) => base.getTool(name).pipe(Effect.map(apply)),
  };
};

/** Inputs for {@link unknownRiskLevelToolNames} — all known at build time. */
export interface RiskLevelOverrideCheckInput {
  readonly riskLevels: ToolRiskLevelOverrides | undefined;
  /** Names of custom tools passed to `.withTools({ tools })`. */
  readonly customToolNames: readonly string[];
  /** Names of agent tools (`.withAgentTool`, remote agents). */
  readonly agentToolNames: readonly string[];
  /** Whether `.withTools({ terminal })` registers `shell-execute`. */
  readonly terminal: boolean;
}

/**
 * Names in `riskLevels` that match no tool the agent can statically register:
 * built-ins, framework meta-tools, the spawn tools, custom tools, agent tools
 * and the terminal tool. MCP tool names are only known at connect time, so callers should
 * phrase the warning accordingly when MCP servers are configured.
 */
export const unknownRiskLevelToolNames = (
  input: RiskLevelOverrideCheckInput,
): readonly string[] => {
  const names = Object.keys(input.riskLevels ?? {});
  if (names.length === 0) return [];
  const known = new Set<string>([
    ...BUILTIN_TOOL_NAMES,
    ...META_TOOLS,
    "spawn-agent",
    "spawn-agents",
    ...input.customToolNames,
    ...input.agentToolNames,
    ...(input.terminal ? [shellExecuteTool.name] : []),
  ]);
  return names.filter((name) => !known.has(name));
};

/**
 * Build-time warning text for unknown `riskLevels` names, or `undefined` when
 * every name is known. Never an error: an override for a tool that is not
 * registered has no effect.
 */
export const riskLevelOverrideWarning = (
  unknown: readonly string[],
  hasMcpServers: boolean,
): string | undefined => {
  if (unknown.length === 0) return undefined;
  const list = unknown.map((n) => `"${n}"`).join(", ");
  return hasMcpServers
    ? `withTools({ riskLevels }): ${list} match no built-in or custom tool. ` +
        `If an MCP server provides them they take effect at connect time; otherwise the override is ignored.`
    : `withTools({ riskLevels }): ${list} match no registered tool; the override is ignored. ` +
        `Check the tool name (built-ins use kebab-case, e.g. "file-read").`;
};
