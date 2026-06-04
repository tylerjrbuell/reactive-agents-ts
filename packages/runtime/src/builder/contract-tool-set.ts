/**
 * Compute the statically-knowable set of tool names a built agent will expose
 * to the LLM, for build-time TaskContract validation (realization-plan P2 /
 * Drift S7). Pure function over the builder's tool-related fields.
 *
 * MIRRORS the runtime's real base-schema assembly at
 * `engine/phases/agent-loop/setup/tool-schemas.ts` (`prepareReasoningToolSchemas`,
 * the builtins-opt-in + allowedTools filter steps). Specifically: built-ins are
 * registered but excluded from the base schema UNLESS opted in via `builtins`,
 * OR named in `allowedTools` / `requiredTools` (those always pass — see
 * tool-schemas.ts:99-102). Custom tools and the terminal `shell-execute` tool
 * are always in the base schema. Then `allowedTools`, when set, restricts the
 * surviving set to that allowlist (tool-schemas.ts:148-152). `focusedTools` is
 * prompt-soft-guidance only and does not change the exposed set.
 *
 * Statically-knowable sources:
 *   - custom tools: `toolsOptions.tools[].definition.name`
 *   - opted-in builtins: `toolsOptions.builtins` (`true` → all canonical
 *     `BUILTIN_TOOL_NAMES`; `string[]` → that subset) ∪ any builtin named in
 *     `allowedTools` / `requiredTools`
 *   - the `shell-execute` terminal tool when `toolsOptions.terminal` is set
 *
 * KNOWN HOLE / conservative approximation: MCP-server tools are NOT included —
 * their names are discovered when buildEffect connects, after build-time
 * validation runs. Callers pass `hasMcpServers` to `validateTaskContract` so a
 * missing `required` tool is downgraded to a warning when MCP is configured
 * (cannot verify statically). The set may also UNDER-count meta/conductor
 * tools (`recall`, `find`, `final-answer`, `spawn-agent`), which task contracts
 * do not declare. The builtins×allowedTools interaction is mirrored exactly to
 * avoid spurious "required tool missing" failures on valid non-MCP agents.
 */

import { BUILTIN_TOOL_NAMES, shellExecuteTool } from "@reactive-agents/tools";
import type { TaskContract } from "@reactive-agents/core";
import type { ToolsOptions } from "./types.js";

export function computeExposedToolNames(
  toolsOptions: ToolsOptions | undefined,
  requiredTools?: readonly string[],
): string[] {
  const names = new Set<string>();

  // Custom tools — always in the base schema.
  for (const t of toolsOptions?.tools ?? []) {
    if (t.definition?.name) names.add(t.definition.name);
  }

  // Built-ins opt-in (mirrors tool-schemas.ts:91-108). allowedTools and
  // requiredTools entries always opt a built-in in, even without `builtins`.
  const allowed = toolsOptions?.allowedTools;
  const builtins = toolsOptions?.builtins;
  const optedInBuiltins = new Set<string>();
  if (builtins === true) {
    for (const n of BUILTIN_TOOL_NAMES) optedInBuiltins.add(n);
  } else if (Array.isArray(builtins)) {
    for (const n of builtins) optedInBuiltins.add(n);
  }
  for (const n of allowed ?? []) optedInBuiltins.add(n);
  for (const n of requiredTools ?? []) optedInBuiltins.add(n);
  for (const n of optedInBuiltins) {
    if (BUILTIN_TOOL_NAMES.has(n)) names.add(n);
  }

  // Terminal shell-execute tool — always in the base schema when enabled.
  if (toolsOptions?.terminal) names.add(shellExecuteTool.name);

  // allowedTools, when set, restricts the surviving set to the allowlist
  // (mirrors tool-schemas.ts:148-152). Names in allowedTools that survived the
  // builtins step (or are custom/terminal) stay; everything else is removed.
  if (allowed && allowed.length > 0) {
    const allowSet = new Set(allowed);
    for (const n of [...names]) {
      if (!allowSet.has(n)) names.delete(n);
    }
  }

  return [...names];
}

/** The runtime's requiredTools config shape (mirrors `_requiredToolsConfig`). */
export interface RequiredToolsConfig {
  tools?: readonly string[];
  adaptive?: boolean;
  maxRetries?: number;
}

/**
 * Execute-time complement to the build-time TaskContract validation
 * (realization-plan P2b). Derives the contract's `kind === "required"` tool
 * names and UNIONS them into the runtime's existing `requiredTools` config so
 * they reach `KernelInput.requiredTools` and the kernel's required-tools
 * success gate enforces them at run time.
 *
 * The runtime path: `config.requiredTools.tools`
 *   → classifier.ts:73-74 `effectiveRequiredTools`
 *   → pre-loop-dispatch.ts:149 / reasoning-harness-hooks.ts:99 `requiredTools`
 *   → ReasoningExecuteRequest → KernelInput.requiredTools.
 *
 * This is the single seam at which `runtime-construction.ts` assembles the
 * `requiredTools` config; calling this here keeps the union in one place rather
 * than duplicating it at every downstream KernelInput construction site.
 *
 * Semantics mirror the prior inline expression exactly when there is no
 * contract:
 *   `priorConfig ?? (reasoningEnabled && toolsEnabled ? { adaptive: true } : undefined)`
 * A contract with required tools always produces an explicit `tools` list
 * (which, per classifier.ts:95-103, also suppresses adaptive inference — the
 * caller has declared their requirements, matching the existing static-list
 * semantic).
 *
 * NOTE — forbidden tools are handled by the sibling {@link contractForbiddenTools}
 * helper + the schema-exclusion filter in `tool-schemas.ts`, NOT here. They are
 * deliberately not routed through `KernelInput.blockedTools` (not fed
 * runtime → kernel; would mean visible-but-blocked, contradicting the
 * contract's "not visible" definition).
 */
export function mergeContractRequiredTools(
  priorConfig: RequiredToolsConfig | undefined,
  contract: TaskContract | undefined,
  reasoningEnabled: boolean,
  toolsEnabled: boolean,
): RequiredToolsConfig | undefined {
  const contractRequired = (contract?.tools ?? [])
    .filter((t) => t.kind === "required")
    .map((t) => t.name);

  // No contract-required tools → preserve the prior inline default semantics.
  if (contractRequired.length === 0) {
    return (
      priorConfig ??
      (reasoningEnabled && toolsEnabled ? { adaptive: true } : undefined)
    );
  }

  // Union contract-required names into the existing static list, deduped,
  // preserving any other config fields (adaptive / maxRetries).
  const merged = new Set<string>(priorConfig?.tools ?? []);
  for (const name of contractRequired) merged.add(name);
  return { ...priorConfig, tools: [...merged] };
}

/**
 * Sibling to {@link mergeContractRequiredTools} for the forbidden-half
 * (realization-plan P2b part 2). Derives the contract's `kind === "forbidden"`
 * tool names.
 *
 * `task-contract.ts:33-34` (core) DEFINES forbidden tools as those that "MUST
 * NOT be visible to the LLM". The runtime enforces this literal semantic by
 * EXCLUDING these names from the execute-time exposed tool schema in
 * `engine/phases/agent-loop/setup/tool-schemas.ts` (`prepareReasoningToolSchemas`),
 * which runs AFTER MCP/discover-tools discovery — closing the
 * static-approximation hole P2's build-time check could not see (the exclusion
 * applies to discovered/MCP tools too, since the schema-prep input is the
 * post-discovery registry snapshot).
 *
 * `runtime-construction.ts` stores the result on `config.forbiddenTools`; the
 * schema-prep exclusion filter is its sole live consumer (§4.4 — no dead
 * field). Returns `[]` when there is no contract or no forbidden tools so the
 * caller can pass the result straight through without further guarding.
 *
 * Deliberately NOT routed through `KernelInput.blockedTools`: that field is not
 * fed runtime → kernel and would mean visible-but-blocked, contradicting the
 * contract's "not visible" definition. Schema-exclusion is runtime-only AND
 * matches the spec.
 */
export function contractForbiddenTools(
  contract: TaskContract | undefined,
): string[] {
  return (contract?.tools ?? [])
    .filter((t) => t.kind === "forbidden")
    .map((t) => t.name);
}
