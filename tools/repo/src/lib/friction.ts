/** Friction budget (zero-friction law): rule modes, message budget, log helpers. */

/** `deny` blocks the call; `warn` allows it and emits the same text as advice. */
export type RuleMode = "deny" | "warn"

/** Message budget: a rendered deny/warn text may not exceed this. */
export const MAX_LINES = 4
export const MAX_CHARS = 400

/** Parse an optional manifest `mode`; absent means `deny`, anything else throws. */
export function parseMode(v: unknown, what: string): RuleMode {
  if (v === undefined) return "deny"
  if (v === "deny" || v === "warn") return v
  throw new Error(`${what}.mode must be "deny" or "warn"`)
}

/** Why `text` busts the message budget, or undefined when it fits. */
export function budgetProblem(text: string): string | undefined {
  const lines = text.split("\n").length
  if (lines > MAX_LINES) return `${lines} lines (max ${MAX_LINES})`
  if (text.length > MAX_CHARS) return `${text.length} chars (max ${MAX_CHARS})`
  return undefined
}

/** True when `s` names a command or tool in backticks. */
export function namesCommand(s: string): boolean {
  return /`[^`\s][^`]*`/.test(s)
}

/** Replace `{base}` with the basename of `path` in a placement `nextHint`. */
export function fillBase(template: string, path: string): string {
  return template.replace(/\{base\}/g, path.slice(path.lastIndexOf("/") + 1))
}
