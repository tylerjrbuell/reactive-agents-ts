import { Effect } from "effect";

import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";

import { webSearchTool, webSearchHandler } from "./web-search.js";
import { cryptoPriceTool, cryptoPriceHandler } from "./crypto-price.js";
import { httpGetTool, httpGetHandler } from "./http-client.js";
import { fileReadTool, fileReadHandler } from "./file-operations.js";
import { fileWriteTool, fileWriteHandler } from "./file-operations.js";
import { fileEditTool, fileEditHandler } from "./file-operations.js";
import { listDirectoryTool, listDirectoryHandler } from "./file-operations.js";
import { grepTool, grepHandler } from "./grep.js";
import { codeExecuteTool, codeExecuteHandler } from "./code-execution.js";
import { BUILTIN_SHELL_PRESETS, DEPRECATED_CLI_TOOLS, REMOVED_BUILTIN_NAMES } from "./scoped-shell.js";
import {
  scratchpadWriteTool,
  scratchpadReadTool,
  makeScratchpadWriteHandler,
  makeScratchpadReadHandler,
} from "./scratchpad.js";
import { contextStatusTool, makeContextStatusHandler } from "./context-status.js";
import { finalAnswerTool } from "./final-answer.js";
import type { RagMemoryStore } from "./rag-ingest.js";
import { recallTool, makeRecallHandler, type RecallConfig } from "./recall.js";
import { relateTool, makeRelateHandler, type RelateState } from "./relate.js";
import { findTool, makeFindHandler, type FindConfig, type FindState } from "./find.js";
import { checkpointTool, makeCheckpointHandler, type CheckpointConfig } from "./checkpoint.js";
import { briefTool, buildBriefResponse, computeEntropyGrade, type BriefInput } from "./brief.js";
import { pulseTool, buildPulseResponse, type PulseInput } from "./pulse.js";
import {
  discoverToolsTool,
  makeDiscoverToolsHandler,
  type DiscoverToolsState,
} from "./discover-tools.js";
import { shellExecuteTool } from "./shell-execute-definition.js";
import {
  shellExecuteHandler,
  DEFAULT_ALLOWED_COMMANDS,
  OPT_IN_COMMANDS,
  type ShellExecuteConfig,
  type ShellAuditEntry,
} from "./shell-execution.js";
import { defaultDocumentStore } from "./document-store.js";

// Re-export meta-tool factories and types so callers can wire up dynamic state
export {
  contextStatusTool,
  makeContextStatusHandler,
  type ContextStatusState,
} from "./context-status.js";
export {
  finalAnswerTool,
  makeFinalAnswerHandler,
  shouldShowFinalAnswer,
  type FinalAnswerState,
  type FinalAnswerVisibility,
  type FinalAnswerCapture,
} from "./final-answer.js";
export {
  ragIngestTool,
  makeRagIngestHandler,
  makeInMemoryStoreCallback,
  type RagStoreCallback,
  type RagMemoryStore,
} from "./rag-ingest.js";
export {
  makeInMemorySearchCallback,
  type RagSearchCallback,
  type RagSearchResult,
} from "./rag-search.js";
export {
  recallTool,
  makeRecallHandler,
  type RecallConfig,
} from "./recall.js";
export {
  relateTool,
  makeRelateHandler,
  type RelateState,
  type RelateEntry,
} from "./relate.js";
export {
  findTool,
  findToolFor,
  findDescriptionFor,
  makeFindHandler,
  type FindDescriptionOptions,
  type FindConfig,
  type FindState,
} from "./find.js";
export {
  checkpointTool,
  makeCheckpointHandler,
  type CheckpointConfig,
} from "./checkpoint.js";
export {
  briefTool,
  buildBriefResponse,
  computeEntropyGrade,
  type BriefInput,
} from "./brief.js";
export {
  pulseTool,
  buildPulseResponse,
  type PulseInput,
} from "./pulse.js";
export {
  discoverToolsTool,
  makeDiscoverToolsHandler,
  type DiscoverToolsState,
} from "./discover-tools.js";
export { shellExecuteTool } from "./shell-execute-definition.js";
export {
  shellExecuteHandler,
  DEFAULT_ALLOWED_COMMANDS,
  OPT_IN_COMMANDS,
  isCommandAllowed,
  isCommandBlocked,
  sanitizeCommand,
  type ShellExecuteConfig,
  type ShellAuditEntry,
} from "./shell-execution.js";

export {
  currentRunToolStores,
  currentScratchpadStore,
  currentCheckpointStore,
  currentDiscoveredToolsStore,
  type RunToolStores,
} from "./run-tool-stores.js";

export {
  createDocumentStore,
  defaultDocumentStore,
  currentDocumentStore,
} from "./document-store.js";

/**
 * Process-wide document store (the unbound fallback, the
 * `documentStoreSlot` initial value). NOT per agent: every run that binds no
 * store shares it.
 *
 * @deprecated Use `createDocumentStore()` and bind it at the run entry
 * (`documentStoreSlot`) for per-agent documents. Alias of `defaultDocumentStore`.
 */
export const ragMemoryStore: RagMemoryStore = defaultDocumentStore;

/**
 * Capability tools auto-registered when ToolServiceLive is created.
 *
 * These are the agent's task tools — what it uses to accomplish work.
 * Framework infrastructure tools (recall, find, brief, pulse, final-answer,
 * etc.) are registered separately by the kernel with live state, or are
 * conductor tools injected via .withMetaTools().
 *
 * `find` is the unified retrieval tool — it searches documents (via the
 * in-memory keyword callback), memory, and the web from one surface.
 */
export const builtinTools: ReadonlyArray<{
  definition: ToolDefinition;
  handler: (args: Record<string, unknown>) => Effect.Effect<unknown, ToolExecutionError>;
}> = [
  { definition: webSearchTool, handler: webSearchHandler },
  { definition: cryptoPriceTool, handler: cryptoPriceHandler },
  { definition: httpGetTool, handler: httpGetHandler() },
  { definition: fileReadTool, handler: fileReadHandler },
  { definition: listDirectoryTool, handler: listDirectoryHandler },
  { definition: fileWriteTool, handler: fileWriteHandler },
  { definition: fileEditTool, handler: fileEditHandler },
  { definition: grepTool, handler: grepHandler },
  { definition: codeExecuteTool, handler: codeExecuteHandler() },
];

/**
 * Set of canonical built-in tool names. Used by the runtime to filter
 * built-ins out of the LLM-facing tool schema by default. Built-ins remain
 * registered in the ToolService (so `discover-tools` can surface them at
 * runtime), but are excluded from the base schema unless the consumer
 * explicitly opts in via `withTools({ builtins: ... })`.
 *
 * Rationale: built-in tools (file-write, web-search, code-execute, etc.)
 * have semantic descriptions ("write to file", "search the web") that
 * cause the relevance classifier to surface them as "relevant" for tasks
 * like "write a markdown report" — even when the user never asked for
 * filesystem or network access. Empirical evidence (2026-05-06 cogito:14b
 * T5 trace): model called `file-write` to produce a file then returned
 * the path as the answer, because file-write was visible in the tool
 * roster despite the user only registering `hnTool`.
 */
export const BUILTIN_TOOL_NAMES: ReadonlySet<string> = new Set(
  builtinTools.map((t) => t.definition.name),
);

/**
 * Named toolset shortcuts for `.withTools({ builtins: [...] })` — lets a
 * caller ask for a curated group instead of enumerating tool names one by
 * one, while keeping the framework's core policy (nothing built-in is on
 * the wire unless a caller explicitly asks) unchanged: an alias expands to a
 * subset of `BUILTIN_TOOL_NAMES`, or (shell presets) to `shell-execute`
 * scoped to the programs in `BUILTIN_SHELL_PRESETS`, resolved once at build
 * time, so declaring `["research"]` costs exactly what declaring
 * `["web-search", "http-get", "grep"]` would have. Matched case-insensitively;
 * an unmatched token is treated as a literal tool name (unchanged behavior).
 *
 * Builtin presets share this one namespace: `builtins: "read"` means the same
 * as `builtins: ["read"]`.
 *
 * Aliases and their members:
 * - `research`  — `web-search`, `http-get`, `grep`
 * - `web`       — `web-search`, `http-get`
 * - `file`      — `file-read`, `file-write`, `file-edit`, `list-directory`, `grep`
 * - `read`      — `file-read`, `list-directory`, `grep` (read-only filesystem)
 * - `code`      — `code-execute`
 * - `git`       — `shell-execute` running only `git` and `gh`
 *
 * `workspace` (gws) was removed 2026-11-10: it now selects nothing and logs a
 * deprecation (see `REMOVED_BUILTIN_NAMES`).
 */
export const BUILTIN_TOOLSET_ALIASES = {
  research: ["web-search", "http-get", "grep"],
  web: ["web-search", "http-get"],
  file: ["file-read", "file-write", "file-edit", "list-directory", "grep"],
  read: ["file-read", "list-directory", "grep"],
  code: ["code-execute"],
  git: ["shell-execute"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

/** Name of a builtin toolset alias / preset (a key of `BUILTIN_TOOLSET_ALIASES`). */
export type BuiltinToolsetAlias = keyof typeof BUILTIN_TOOLSET_ALIASES;

/**
 * True when `name` (case-insensitive) is an own key of
 * `BUILTIN_TOOLSET_ALIASES`. Inherited `Object.prototype` keys such as
 * `constructor` never match.
 */
export function isBuiltinToolsetAlias(name: string): boolean {
  return isAliasKey(name.toLowerCase());
}

/** Exact own-key check; narrows `key` for typed table lookup. */
function isAliasKey(key: string): key is BuiltinToolsetAlias {
  return Object.hasOwn(BUILTIN_TOOLSET_ALIASES, key);
}

/** Tokens meaning "every canonical built-in" — equivalent to `builtins: true`. */
const ALL_BUILTINS_TOKENS = new Set(["*", "all"]);

/**
 * Expand `builtins: [...]` entries — resolving `"*"`/`"all"` and named
 * aliases (`BUILTIN_TOOLSET_ALIASES`) into concrete tool names, passing any
 * unrecognized token through unchanged as a literal tool name. Shared by
 * every schema-assembly site that reads `config.builtins` (runtime's
 * `tool-schemas.ts` and the build-time `contract-tool-set.ts` mirror) so the
 * two can never drift on what an alias means.
 */
export function resolveBuiltinNames(names: Iterable<string>): Set<string> {
  return new Set(resolveBuiltinSelection(names).names);
}

/** A removed tool name that was requested, and what replaces it. */
export interface BuiltinNameDeprecation {
  /** The requested name, e.g. `gh-cli`. */
  readonly name: string;
  /**
   * The tool that replaces it: `"shell-execute"` (a scoped shell was added),
   * or `null` when the name was removed and now selects no tool (`workspace`,
   * `gws-cli`).
   */
  readonly replacement: "shell-execute" | null;
  /** The program the name ran, e.g. `gh` (scoped shell) or `gws` (removed). */
  readonly program: string;
  /** One-line notice for the caller to surface (log, event, build warning). */
  readonly message: string;
}

/** Result of {@link resolveBuiltinSelection}. */
export interface BuiltinSelection {
  /** Concrete tool names, as {@link resolveBuiltinNames} returns. */
  readonly names: ReadonlySet<string>;
  /**
   * Programs the scoped `shell-execute` must allow, in request order without
   * duplicates. Empty when no shell preset or removed CLI name was requested.
   * Non-empty means: register `scopedShellTool(shellPrograms)`, or add them to
   * the terminal's `additionalCommands` when the full terminal is on.
   */
  readonly shellPrograms: readonly string[];
  /** Removed names that were requested (`gh-cli`, `git-cli`, `gws-cli`, `workspace`). */
  readonly deprecations: readonly BuiltinNameDeprecation[];
}

/** Exact own-key check on the removed CLI tool table. */
function isDeprecatedCliName(name: string): name is keyof typeof DEPRECATED_CLI_TOOLS {
  return Object.hasOwn(DEPRECATED_CLI_TOOLS, name);
}

/** Exact own-key check on the removed-name table. */
function isRemovedBuiltinName(name: string): name is keyof typeof REMOVED_BUILTIN_NAMES {
  return Object.hasOwn(REMOVED_BUILTIN_NAMES, name);
}

/** Exact own-key check on the shell preset table. */
function isShellPresetKey(key: string): key is keyof typeof BUILTIN_SHELL_PRESETS {
  return Object.hasOwn(BUILTIN_SHELL_PRESETS, key);
}

/**
 * Resolve a list of requested built-in names (a `builtins` list, or any other
 * list of tool names such as `allowedTools`) into tool names, the programs a
 * scoped shell must allow, and deprecation notices.
 *
 * `"*"` / `"all"` give the capability built-ins only: a shell is never granted
 * implicitly. A shell preset alias (`git`) gives `shell-execute` plus its
 * programs. A removed CLI name (`gh-cli`) gives `shell-execute` scoped to its
 * program and a deprecation. A removed name with no replacement (`workspace`,
 * `gws-cli`) gives no tool and a deprecation. Anything else passes through.
 */
export function resolveBuiltinSelection(names: Iterable<string>): BuiltinSelection {
  const resolved = new Set<string>();
  const programs = new Set<string>();
  const deprecations: BuiltinNameDeprecation[] = [];
  for (const raw of names) {
    const token = raw.toLowerCase();
    if (ALL_BUILTINS_TOKENS.has(token)) {
      for (const n of BUILTIN_TOOL_NAMES) resolved.add(n);
      continue;
    }
    if (isAliasKey(token)) {
      for (const n of BUILTIN_TOOLSET_ALIASES[token]) resolved.add(n);
      if (isShellPresetKey(token)) for (const p of BUILTIN_SHELL_PRESETS[token]) programs.add(p);
      continue;
    }
    if (isDeprecatedCliName(token)) {
      const program = DEPRECATED_CLI_TOOLS[token];
      resolved.add("shell-execute");
      programs.add(program);
      deprecations.push({
        name: raw,
        replacement: "shell-execute",
        program,
        message:
          `"${raw}" was removed; it now means shell-execute limited to ${program}. ` +
          `The model writes the full command, e.g. "${program} ...".`,
      });
      continue;
    }
    if (isRemovedBuiltinName(token)) {
      const program = REMOVED_BUILTIN_NAMES[token];
      deprecations.push({
        name: raw,
        replacement: null,
        program,
        message:
          `"${raw}" was removed and selects no tool. ${program} is a shell CLI: ` +
          `enable the terminal and allow it, ` +
          `.withTools({ terminal: { additionalCommands: ["${program}"] } }), to let the agent run it.`,
      });
      continue;
    }
    resolved.add(raw);
  }
  return { names: resolved, shellPrograms: [...programs], deprecations };
}

/**
 * Meta-tool definitions (no default handlers — must be wired with live state).
 * Exported for schema inspection, documentation, and dynamic registration.
 */
export const metaToolDefinitions: ReadonlyArray<ToolDefinition> = [
  contextStatusTool,
  finalAnswerTool,
  briefTool,
  findTool,
  pulseTool,
  recallTool,
  relateTool,
  checkpointTool,
  discoverToolsTool,
];
