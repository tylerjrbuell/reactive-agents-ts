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
