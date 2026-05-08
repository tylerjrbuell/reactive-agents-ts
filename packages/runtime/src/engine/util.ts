/**
 * Shared utilities used across phase modules. Keep this file tiny — only put
 * helpers here that are used by 2+ phases. Single-phase helpers stay in their
 * phase module.
 */

/**
 * Extract a human-readable string from a task input. The input may be:
 * - a plain string (returned as-is)
 * - an object with a `question` field (returned)
 * - anything else (JSON-stringified)
 */
export function extractTaskText(input: unknown): string {
  if (typeof input === "string") return input;
  if (typeof input === "object" && input !== null) {
    const q = (input as Record<string, unknown>).question;
    if (typeof q === "string") return q;
  }
  return JSON.stringify(input);
}

/**
 * Returns `allowedTools` names that don't match any registered tool name.
 *
 * Used at bootstrap to warn when the caller specified tool names that are not
 * actually registered (e.g. a typo or an MCP tool name change). Trims each
 * entry so whitespace typos (" recall") don't produce false positives —
 * mirrors the ToolService filter layer normalization.
 *
 * Hoisted from `execution-engine.ts:298` (W23 step 4); re-exported there for
 * backward compatibility.
 */
export function checkAllowedToolsMismatch(
  allowedTools: readonly string[],
  registeredTools: readonly { name: string }[],
): string[] {
  const registered = new Set(registeredTools.map((t) => t.name));
  return allowedTools.filter((name) => !registered.has(name.trim()));
}
