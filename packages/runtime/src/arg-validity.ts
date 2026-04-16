export interface ToolCallForValidity {
  readonly toolName: string;
  readonly arguments: unknown;
}

/**
 * Fraction of tool calls whose `arguments` look like a real value dict
 * (not a JSON-schema fragment, not empty, is a plain object).
 */
export function computeArgValidityRate(calls: readonly ToolCallForValidity[]): number {
  if (calls.length === 0) return 0;
  const valid = calls.filter((c) => isPlausibleArgs(c.arguments)).length;
  return valid / calls.length;
}

function isPlausibleArgs(args: unknown): boolean {
  if (!args || typeof args !== "object" || Array.isArray(args)) return false;
  const dict = args as Record<string, unknown>;
  const keys = Object.keys(dict);
  if (keys.length === 0) return false;
  // Schema-fragment leak: only key is "type" with value "object" / "string" / etc.
  if (keys.length === 1 && keys[0] === "type" && typeof dict["type"] === "string") return false;
  return true;
}
