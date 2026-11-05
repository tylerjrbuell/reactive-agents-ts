/**
 * Tools wither-body extractions (WS-6 Phase 1 — tools bucket).
 *
 * Hosts mutation bodies for the tools-layer wither family:
 * `.withTools()` (terminal access is `.withTools({ terminal })`),
 * `.withDocuments()`, `.withRequiredTools()`, `.withMCP()`, `.withMetaTools()`.
 */
import { droppedMetaToolsNotice } from "../meta-tools-resolution.js";
import { ToolBuilder, type RagMemoryStore, type ToolDefinition } from '@reactive-agents/tools';
import { Effect } from "effect";
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
 * Every `ToolsOptions` key. Typed as an exhaustive record so adding or
 * removing a field on `ToolsOptions` is a compile error here until this list
 * follows — the unknown-key notice below can never drift from the type.
 */
const TOOLS_OPTION_KEYS: Readonly<Record<keyof ToolsOptions, true>> = {
  tools: true,
  resultCompression: true,
  allowedTools: true,
  focusedTools: true,
  adaptive: true,
  builtins: true,
  terminal: true,
  required: true,
  riskLevels: true,
};

/**
 * Common spellings of a real `ToolsOptions` key. `include` is the one that
 * cost a run (2026-11-04): the builtins never reached the tool surface, the
 * model saw only `recall`, and the run abstained.
 */
const TOOLS_OPTION_SUGGESTIONS: Readonly<Record<string, keyof ToolsOptions>> = {
  include: "builtins",
  builtIns: "builtins",
  builtin: "builtins",
  enable: "builtins",
  allow: "allowedTools",
  allowed: "allowedTools",
  allowlist: "allowedTools",
  focus: "focusedTools",
  focused: "focusedTools",
  requiredTools: "required",
  custom: "tools",
};

/** One unrecognized `.withTools()` key, with the real key it most likely meant. */
export interface UnknownToolsOptionKey {
  readonly key: string;
  readonly suggestion: keyof ToolsOptions | undefined;
}

/**
 * The keys of `options` that are not `ToolsOptions` fields. TypeScript rejects
 * them in an object literal, but an untyped caller (plain JS, a spread config
 * object) reaches the wither with them and they were dropped without a word.
 * Pure — exported for the seam pin.
 */
export const unknownToolsOptionKeys = (
  options: object,
): readonly UnknownToolsOptionKey[] =>
  Object.keys(options)
    .filter((key) => !Object.prototype.hasOwnProperty.call(TOOLS_OPTION_KEYS, key))
    .map((key) => ({ key, suggestion: TOOLS_OPTION_SUGGESTIONS[key] }));

/**
 * Apply `.withTools(options)` — enable the tools layer, merge custom tool
 * definitions with previous registrations, and surface `resultCompression`
 * to the dedicated runtime field.
 *
 * The `required` option is routed to the same `_requiredToolsConfig` state
 * as `.withRequiredTools()` (NOT stored in `_toolsOptions` — one state slot,
 * one serialization path via `toConfig().requiredTools`).
 *
 * `riskLevels` maps merge across calls (later call wins per tool name).
 *
 * Unknown keys are ignored as before, but each one now logs one warning
 * naming the key and, when recognizable, the key it meant.
 */
export const applyWithTools = (
  builder: ReactiveAgentBuilder,
  options?: ToolsOptions,
): void => {
  const s = asBuilderState(builder);
  s._enableTools = true;
  if (options) {
    for (const { key, suggestion } of unknownToolsOptionKeys(options)) {
      Effect.runSync(
        Effect.logWarning(
          `withTools: unknown option '${key}' ignored` +
            (suggestion !== undefined ? ` — did you mean '${suggestion}'?` : "") +
            ` Valid options: ${Object.keys(TOOLS_OPTION_KEYS).join(", ")}.`,
        ),
      );
    }
    const { required, ...rest } = options;
    const previous = s._toolsOptions;
    s._toolsOptions = {
      ...previous,
      ...rest,
      tools: rest.tools
        ? [...(previous?.tools ?? []), ...rest.tools]
        : previous?.tools,
      // Per-tool overrides merge across calls; a later call wins per name.
      ...(rest.riskLevels !== undefined || previous?.riskLevels !== undefined
        ? { riskLevels: { ...previous?.riskLevels, ...rest.riskLevels } }
        : {}),
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
 * Apply `.withDocuments(docs, options)` — accumulate RAG documents and enable
 * the tools layer (the `find` retrieval tool needs tools enabled). A
 * supplied `options.store` replaces the per-agent store created at build, so
 * every agent given the same store searches the same documents.
 */
export const applyWithDocuments = (
  builder: ReactiveAgentBuilder,
  docs: DocumentSpec[],
  options?: WithDocumentsOptions,
): void => {
  const s = asBuilderState(builder);
  s._documents = [...s._documents, ...docs];
  s._enableTools = true;
  if (options?.store) s._documentStore = options.store;
};

/** Options for `.withDocuments(docs, options)`. */
export interface WithDocumentsOptions {
  /**
   * Document store to ingest into and search. Default: a fresh store owned by
   * this agent. Pass one `createDocumentStore()` to several builders to let
   * those agents search the same documents.
   */
  readonly store?: RagMemoryStore;
}

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
 * - `.withMetaTools({...})` → exactly what you name. Default-on `recall` is
 *                       DROPPED unless you list it (one notice is logged);
 *                       write `{ todo: true, recall: true }` to keep it.
 *                       `harnessSkill` only has an effect when `brief` or
 *                       `pulse` is on (the kernel injects it only then).
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
    if (config !== undefined) {
      const notice = droppedMetaToolsNotice(config);
      if (notice !== undefined) Effect.runSync(Effect.logWarning(notice));
    }
    s._metaTools = config ?? {
      brief: true,
      find: true,
      pulse: true,
      recall: true,
      harnessSkill: true,
    };
  }
};

/**
 * Convert a `ToolBuilder` instance into a `{ definition, handler }` entry
 * suitable for `.withTools({ tools: [...] })`.
 *
 * Wraps the `ToolBuilder` handler (which receives `...args` and returns a
 * plain value) in the Effect-returning form expected by the tool registry.
 * Throws if the builder has no `.handler()` configured.
 *
 * @example
 * ```typescript
 * import { ToolBuilder } from '@reactive-agents/tools';
 * import { toolBuilderToEntry } from '@reactive-agents/runtime';
 *
 * agent.withTools({
 *   tools: [
 *     toolBuilderToEntry(
 *       ToolBuilder.create("ping")
 *         .description("Echo back the input")
 *         .param("message", "string", "Message to echo", { required: true })
 *         .handler(({ message }) => `pong: ${message}`),
 *     ),
 *   ],
 * });
 * ```
 */
export function toolBuilderToEntry(
  tb: ToolBuilder,
): { readonly definition: ToolDefinition; readonly handler: (args: Record<string, unknown>) => Effect.Effect<unknown, any> } {
  const built = tb.build();
  const handler = built.handler;
  if (!handler) {
    throw new Error(
      `ToolBuilder "${built.definition.name}" has no handler — call .handler(fn) before passing to .withTools()`,
    );
  }
  return {
    definition: built.definition,
    handler: (args: Record<string, unknown>) => Effect.succeed(handler(args)),
  };
}

