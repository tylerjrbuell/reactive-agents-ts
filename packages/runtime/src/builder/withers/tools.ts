/**
 * Tools wither-body extractions (WS-6 Phase 1 — tools bucket).
 *
 * Hosts mutation bodies for the tools-layer wither family:
 * `.withTools()`, `.withTerminalTools()`, `.withDocuments()`,
 * `.withRequiredTools()`, `.withMCP()`, `.withMetaTools()`.
 */
import type { ReactiveAgentBuilder } from "../../builder.js";
import type { ToolsOptions } from "../../builder.js";
import type { MCPServerConfig } from "../../runtime.js";
import type { ShellExecuteConfig } from "@reactive-agents/tools";
import type { DocumentSpec } from "../../context-ingestion.js";
import type { MetaToolsConfig } from "../../types.js";
import { asBuilderState } from "./_state.js";

/**
 * Apply `.withTools(options)` — enable the tools layer, merge custom tool
 * definitions with previous registrations, and surface `resultCompression`
 * to the dedicated runtime field.
 */
export const applyWithTools = (
  builder: ReactiveAgentBuilder,
  options?: ToolsOptions,
): void => {
  const s = asBuilderState(builder);
  s._enableTools = true;
  if (options) {
    const previous = s._toolsOptions;
    s._toolsOptions = {
      ...previous,
      ...options,
      tools: options.tools
        ? [...(previous?.tools ?? []), ...options.tools]
        : previous?.tools,
    };
  }
  if (options?.resultCompression) {
    s._resultCompression = options.resultCompression;
  }
};

/**
 * Apply `.withTerminalTools(options)` — enable tools + register the
 * shell-execute tool (allowlisted CLI commands with sandbox + timeout).
 */
export const applyWithTerminalTools = (
  builder: ReactiveAgentBuilder,
  options?: ShellExecuteConfig,
): void => {
  const s = asBuilderState(builder);
  s._enableTools = true;
  s._toolsOptions = {
    ...s._toolsOptions,
    terminal: options ?? true,
  };
};

/**
 * Apply `.withDocuments(docs)` — accumulate RAG documents and enable the
 * tools layer (rag-search needs tools enabled).
 */
export const applyWithDocuments = (
  builder: ReactiveAgentBuilder,
  docs: DocumentSpec[],
): void => {
  const s = asBuilderState(builder);
  s._documents = [...s._documents, ...docs];
  s._enableTools = true;
};

/**
 * Apply `.withRequiredTools(config)` — set the required-tools enforcement
 * configuration consulted by the arbitrator's pre-termination guard.
 */
export const applyWithRequiredTools = (
  builder: ReactiveAgentBuilder,
  config: {
    tools?: readonly string[];
    adaptive?: boolean;
    maxRetries?: number;
  },
): void => {
  asBuilderState(builder)._requiredToolsConfig = config;
};

/**
 * Apply `.withMCP(config)` — register one or more MCP server connections
 * and enable the tools layer (MCP tools land in the tool registry).
 */
export const applyWithMCP = (
  builder: ReactiveAgentBuilder,
  config: MCPServerConfig | MCPServerConfig[],
): void => {
  const s = asBuilderState(builder);
  const configs = Array.isArray(config) ? config : [config];
  s._mcpServers.push(...configs);
  s._enableTools = true;
};

/**
 * Apply `.withMetaTools(config)` — register meta-tools + harness skill.
 *
 * Four tiers (2026-07-10 — wire measurement showed the old always-on suite
 * consumed 67% of the tool-schema budget per request with zero calls):
 * - not called        → task-facing default (recall; find only when
 *                       `.withDocuments()` present; brief/pulse OFF) —
 *                       resolved in runtime-construction.ts
 * - `.withMetaTools()`      → the FULL suite (explicit opt-in to all four)
 * - `.withMetaTools({...})` → exactly what you name
 * - `.withMetaTools(false)` → none
 */
export const applyWithMetaTools = (
  builder: ReactiveAgentBuilder,
  config?: MetaToolsConfig | false,
): void => {
  const s = asBuilderState(builder);
  if (config === false) {
    s._metaTools = false;
  } else {
    s._metaTools = config ?? {
      brief: true,
      find: true,
      pulse: true,
      recall: true,
      harnessSkill: true,
    };
  }
};

