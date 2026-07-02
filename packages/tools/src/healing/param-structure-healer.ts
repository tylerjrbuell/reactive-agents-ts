import type { HealingAction } from "../drivers/tool-calling-driver.js"

interface ToolSchema {
  readonly name: string
  readonly description: string
  readonly parameters: readonly {
    readonly name: string
    readonly type: string
    readonly description?: string
    readonly required?: boolean
  }[]
}

interface HealStructureResult {
  readonly healed: Record<string, unknown>
  readonly actions: readonly HealingAction[]
}

/** Wrapper keys weak models use to nest the real arguments one level deep. */
const WRAPPER_KEYS = ["input", "args", "params", "arguments"] as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Shape A — args nested under a wrapper key (live-bench evidence 2026-07-02:
 * qwen3:14b emitted `file-write({ input: { path, content } })`).
 *
 * Unwraps when there is EXACTLY ONE wrapper-named key that:
 *   - is not itself a schema parameter,
 *   - holds a non-empty plain object,
 *   - whose every key is a valid schema parameter name.
 * Inner keys never overwrite existing top-level keys. Anything ambiguous
 * (two qualifying wrappers) or non-matching is left untouched.
 */
export function unwrapWrappedArgs(
  args: Record<string, unknown>,
  schema: ToolSchema,
): HealStructureResult {
  const schemaParamNames = new Set(schema.parameters.map((p) => p.name))

  const candidates: { key: string; inner: Record<string, unknown> }[] = []
  for (const key of WRAPPER_KEYS) {
    if (!(key in args) || schemaParamNames.has(key)) continue
    const value = args[key]
    if (!isPlainObject(value)) continue
    const innerKeys = Object.keys(value)
    if (innerKeys.length === 0) continue
    if (!innerKeys.every((k) => schemaParamNames.has(k))) continue
    candidates.push({ key, inner: value })
  }

  if (candidates.length !== 1) return { healed: { ...args }, actions: [] }

  const { key: wrapperKey, inner } = candidates[0]!
  const healed: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args)) {
    if (k !== wrapperKey) healed[k] = v
  }
  for (const [k, v] of Object.entries(inner)) {
    if (!(k in healed)) healed[k] = v
  }

  const action: HealingAction = {
    stage: "param-structure",
    from: wrapperKey,
    to: Object.keys(inner).join(","),
  }
  return { healed, actions: [action] }
}

function typeCompatible(value: unknown, paramType: string): boolean {
  switch (paramType) {
    case "string":
      return typeof value === "string"
    case "number":
    case "integer":
      return typeof value === "number"
    case "boolean":
      return typeof value === "boolean"
    case "object":
      return isPlainObject(value)
    case "array":
      return Array.isArray(value)
    default:
      // Unrecognised schema type — the exactly-one/exactly-one gate below is
      // the real safety rail, so don't block on an unknown type string.
      return true
  }
}

/**
 * Shape B — exactly one required parameter missing AND exactly one unknown
 * parameter of a compatible type present → deterministically remap it
 * (e.g. `{ filename, content }` → `{ path, content }` for file-write).
 * Runs AFTER healParamNames so aliases/typos are resolved first; anything
 * ambiguous (multiple missing, multiple unknowns, type mismatch) is untouched.
 */
export function remapSingleMissingRequired(
  args: Record<string, unknown>,
  schema: ToolSchema,
): HealStructureResult {
  const schemaParamNames = new Set(schema.parameters.map((p) => p.name))

  const missingRequired = schema.parameters.filter(
    (p) => p.required === true && !(p.name in args),
  )
  const unknownKeys = Object.keys(args).filter((k) => !schemaParamNames.has(k))

  if (missingRequired.length !== 1 || unknownKeys.length !== 1) {
    return { healed: { ...args }, actions: [] }
  }

  const target = missingRequired[0]!
  const sourceKey = unknownKeys[0]!
  const value = args[sourceKey]
  if (!typeCompatible(value, target.type)) {
    return { healed: { ...args }, actions: [] }
  }

  const healed: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args)) {
    if (k !== sourceKey) healed[k] = v
  }
  healed[target.name] = value

  const action: HealingAction = { stage: "param-name", from: sourceKey, to: target.name }
  return { healed, actions: [action] }
}
