/**
 * Tools wither-body extractions (WS-6 Phase 1 — tools bucket).
 *
 * Hosts mutation bodies for the tools-layer wither family:
 * `.withTools()` (terminal access is `.withTools({ terminal })`),
 * `.withDocuments()`, `.withRequiredTools()`, `.withMCP()`, `.withMetaTools()`.
 */
import type { ReactiveAgentBuilder } from "../../builder.js";
import type { ToolsOptions } from "../../builder.js";
import type { RequiredToolsOptions } from "../types.js";
import type { MCPServerConfig } from "../../runtime.js";
import type { DocumentSpec } from "../../context-ingestion.js";
import type { MetaToolsConfig } from "../../types.js";
import { asBuilderState, type BuilderState } from "./_state.js";

/**
 * Merge a required-tools config fragment into `_requiredToolsConfig` — the
 * SINGLE state slot behind both `.withRequiredTools()` and
 * `.withTools({ required })` (wither-surface consolidation, 2026-07-11).
 *
 * Conflict rule (documented on both public entry points):
 * - `tools` lists are UNIONED (deduped, first-seen order) across calls.
 * - Scalar fields (`adaptive`, `maxRetries`) are last-call-wins.
 */
const mergeRequiredToolsConfig = (
  s: BuilderState,
  incoming: RequiredToolsOptions,
): void => {
  const previous = s._requiredToolsConfig;
  const unionTools = [
    ...new Set([...(previous?.tools ?? []), ...(incoming.tools ?? [])]),
  ];
  s._requiredToolsConfig = {
    ...previous,
    ...(incoming.adaptive !== undefined ? { adaptive: incoming.adaptive } : {}),
    ...(incoming.maxRetries !== undefined
      ? { maxRetries: incoming.maxRetries }
      : {}),
    ...(unionTools.length > 0 || previous?.tools || incoming.tools
      ? { tools: unionTools }
      : {}),
  };
};

/** Normalize the `required` shorthand (`string[]` ≡ `{ tools: [...] }`). */
const normalizeRequired = (
  required: readonly string[] | RequiredToolsOptions,
): RequiredToolsOptions =>
  Array.isArray(required)
    ? { tools: required as readonly string[] }
    : (required as RequiredToolsOptions);

/**
 * Apply `.withTools(options)` — enable the tools layer, merge custom tool
 * definitions with previous registrations, and surface `resultCompression`
 * to the dedicated runtime field.
 *
 * The `required` option is routed to the same `_requiredToolsConfig` state
 * as `.withRequiredTools()` (NOT stored in `_toolsOptions` — one state slot,
 * one serialization path via `toConfig().requiredTools`).
 */
export const applyWithTools = (
  builder: ReactiveAgentBuilder,
  options?: ToolsOptions,
): void => {
  const s = asBuilderState(builder);
  s._enableTools = true;
  if (options) {
    const { required, ...rest } = options;
    const previous = s._toolsOptions;
    s._toolsOptions = {
      ...previous,
      ...rest,
      tools: rest.tools
        ? [...(previous?.tools ?? []), ...rest.tools]
        : previous?.tools,
    };
    if (required !== undefined) {
      mergeRequiredToolsConfig(s, normalizeRequired(required));
    }
  }
  if (options?.resultCompression) {
    s._resultCompression = options.resultCompression;
  }
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
 * Apply `.withRequiredTools(config)` — merge the required-tools enforcement
 * configuration consulted by the arbitrator's pre-termination guard.
 *
 * Delegates to the same merge as `.withTools({ required })`: tool lists
 * union across calls; `adaptive` / `maxRetries` are last-call-wins.
 */
export const applyWithRequiredTools = (
  builder: ReactiveAgentBuilder,
  config: {
    tools?: readonly string[];
    adaptive?: boolean;
    maxRetries?: number;
  },
): void => {
  mergeRequiredToolsConfig(asBuilderState(builder), config);
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

