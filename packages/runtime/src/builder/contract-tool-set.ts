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
