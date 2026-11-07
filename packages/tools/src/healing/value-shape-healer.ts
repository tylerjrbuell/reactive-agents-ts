import type { HealingAction } from "../drivers/tool-calling-driver.js"

/**
 * value-shape-healer.ts — healing stage for values whose SHAPE is wrong for
 * what the parameter means, keyed by the parameter's declared `semantic`
 * (types.ts `ToolParameter.semantic`), never by tool name.
 *
 * `"file-content"`: the value is the text saved to a file. A model writing a
 * `.json` document as a JSON string nested inside the JSON tool arguments must
 * double-escape it, and small models get that wrong: bench lh-1 (qwen3:4b,
 * 2026-11-06) had 40 of 123 `.json` writes refused, nearly all
 * `Expecting ',' delimiter` from an unescaped quote. Sending the JSON value
 * itself avoids the nesting. This stage serializes such a value as
 * `JSON.stringify(value, null, 2)` plus a newline, so the tool only ever sees
 * text.
 *
 * A string sent to a `file-content` parameter whose sibling path ends in a
 * JSON extension, and that does not parse, gets one repair: the quote repair
 * of `json-repair.ts` (backslashes before inner double quotes, only when that
 * makes the text parse unambiguously). Leverage scan 2026-11-07: 41 of 46
 * refused `.json` contents carried a quote copied from the task text. Any
 * other invalid string is left as written, so file-write still refuses it.
 *
 * A string sent to a `file-content` parameter whose sibling path ends in a
 * prose extension (`.md`, `.txt`, ...) and that is one line with literal `\n`
 * sequences gets those unescaped (`literal-newlines.ts`). Tool-result budget
 * spike 2026-11-07: 5 of 5 gpt-4o-mini lh-1 failures wrote such a file.
 */
import { isJsonFilePath, repairJsonQuotes } from "./json-repair.js"
import { isTextFilePath, unescapeLiteralNewlines } from "./literal-newlines.js"
import { PATH_PARAMS } from "./path-resolver.js"

interface ValueShapeSchema {
  readonly parameters: readonly {
    readonly name: string
    readonly semantic?: "file-content"
  }[]
}

/**
 * JSON values a file-content parameter accepts in place of a string. Not
 * `null`: a null content stays a missing-parameter error, never a file
 * containing `null`.
 */
function isJsonValue(value: unknown): boolean {
  return (
    (typeof value === "object" && value !== null) ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
}

/** Short label for the healing action's `from` field. */
function shapeOf(value: unknown): string {
  if (Array.isArray(value)) return "array"
  return typeof value
}

/**
 * Serialize JSON values sent to `file-content` parameters. Must run BEFORE
 * the type coercer, which would otherwise turn a number into its bare string.
 */
export function healValueShapes(
  args: Record<string, unknown>,
  schema: ValueShapeSchema,
): { readonly healed: Record<string, unknown>; readonly actions: readonly HealingAction[] } {
  const healed = { ...args }
  const actions: HealingAction[] = []

  const targetIs = (test: (path: string) => boolean): boolean =>
    Object.entries(healed).some(([key, v]) => PATH_PARAMS.has(key) && typeof v === "string" && test(v))
  const jsonTarget = targetIs(isJsonFilePath)
  const textTarget = targetIs(isTextFilePath)

  for (const param of schema.parameters) {
    if (param.semantic !== "file-content") continue
    if (!(param.name in healed)) continue
    const value = healed[param.name]
    if (typeof value === "string") {
      if (textTarget) {
        const unescaped = unescapeLiteralNewlines(value)
        if (unescaped === undefined) continue
        healed[param.name] = unescaped.text
        actions.push({
          stage: "value-shape",
          from: `${param.name}:literal-newlines`,
          to: `${param.name}:newlines-unescaped(${unescaped.count})`,
        })
        continue
      }
      if (!jsonTarget) continue
      const repair = repairJsonQuotes(value)
      if (!repair.ok || repair.edits.length === 0) continue
      healed[param.name] = repair.text
      actions.push({
        stage: "value-shape",
        from: `${param.name}:invalid-json`,
        to: `${param.name}:json-quotes-escaped(${repair.edits.length})`,
      })
      continue
    }
    if (!isJsonValue(value)) continue
    const json = JSON.stringify(value, null, 2)
    if (json === undefined) continue
    healed[param.name] = `${json}\n`
    actions.push({ stage: "value-shape", from: `${param.name}:${shapeOf(value)}`, to: `${param.name}:json-text` })
  }

  return { healed, actions }
}
