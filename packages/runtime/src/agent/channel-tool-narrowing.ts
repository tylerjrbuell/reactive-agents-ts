/**
 * Build-time tool narrowing for channel-routed agents.
 *
 * A route sender's agent is built with a SMALLER tool surface than the owner's; the surface is
 * decided here, before `build()`, never filtered per turn and never by prompt. Fails closed:
 * a tool counts as read-only only when positively declared so (`isReadOnlyTool`), so custom,
 * sub-agent and MCP tools (which omit `mutatesExternalState`) are removed from a `ReadOnly` surface.
 */
import { builtinTools, isReadOnlyTool } from "@reactive-agents/tools";
import type { ToolDefinition } from "@reactive-agents/tools";
import type { ToolExposure } from "@reactive-agents/channels";
import type { ReactiveAgentBuilder } from "../builder.js";
import { asBuilderState } from "../builder/withers/_state.js";
import { computeExposedToolNames } from "../builder/contract-tool-set.js";
import type { ToolsOptions } from "../builder/types.js";

const BUILTIN_DEFINITIONS: ReadonlyMap<string, ToolDefinition> = new Map(
  builtinTools.map((t) => [t.definition.name, t.definition] as const),
);

/**
 * Narrow `builder`'s tool surface in place to what `exposure` allows and return the resulting
 * exposed tool names. `AgentDefault` leaves the builder untouched.
 *
 * `ReadOnly` keeps only tools declared read-only; `Allowlist` keeps only the named tools the agent
 * already had (it never widens). Both drop MCP servers (names unknown until connect), sub-agent
 * tools and required-tool config that could re-opt a removed built-in in.
 */
export const narrowToolSurface = (
  builder: ReactiveAgentBuilder,
  exposure: ToolExposure,
): readonly string[] => {
  const state = asBuilderState(builder);
  if (exposure._tag === "AgentDefault") return computeExposedToolNames(state._toolsOptions);

  const options: ToolsOptions | undefined = state._toolsOptions;
  const custom = options?.tools ?? [];
  const definitionOf = (name: string): ToolDefinition | undefined =>
    custom.find((t) => t.definition.name === name)?.definition ?? BUILTIN_DEFINITIONS.get(name);
  const permitted = (name: string): boolean => {
    if (exposure._tag === "Allowlist") return exposure.tools.includes(name);
    const def = definitionOf(name);
    return def !== undefined && isReadOnlyTool(def);
  };

  const exposed = computeExposedToolNames(options).filter(permitted);
  const customKept = custom.filter((t) => exposed.includes(t.definition.name));
  const builtinKept = exposed.filter((n) => BUILTIN_DEFINITIONS.has(n) && !custom.some((t) => t.definition.name === n));
  const shellKept = exposed.includes("shell-execute");

  const agentToolsKept = state._agentTools.filter(
    (t) => exposure._tag === "Allowlist" && exposure.tools.includes(t.name),
  );
  const allowed = [...exposed, ...agentToolsKept.map((t) => t.name)];

  state._toolsOptions = {
    ...options,
    tools: customKept,
    builtins: builtinKept.length > 0 ? builtinKept : false,
    allowedTools: allowed.length > 0 ? allowed : undefined,
    terminal: shellKept && options?.terminal === true ? true : false,
  };
  state._requiredToolsConfig = undefined;
  state._mcpServers = [];
  state._agentTools = agentToolsKept;
  return computeExposedToolNames(state._toolsOptions);
};
