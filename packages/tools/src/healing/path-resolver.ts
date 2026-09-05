import { resolve } from "node:path"
import { homedir } from "node:os"
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

interface ResolveResult {
  readonly healed: Record<string, unknown>
  readonly actions: readonly HealingAction[]
}

const PATH_PARAMS = new Set(["path", "filePath", "file", "src", "dest", "destination", "output"])

export function resolvePaths(
  toolName: string,
  args: Record<string, unknown>,
  fileToolNames: ReadonlySet<string>,
  workingDir: string,
): ResolveResult {
  if (!fileToolNames.has(toolName)) return { healed: { ...args }, actions: [] }

  const healed = { ...args }
  const actions: HealingAction[] = []

  for (const [key, value] of Object.entries(healed)) {
    if (!PATH_PARAMS.has(key) || typeof value !== "string") continue

    let resolved = value

    // Tilde expansion
    if (resolved.startsWith("~/")) resolved = resolve(homedir(), resolved.slice(2))

    // Relative path → working dir
    if (!resolved.startsWith("/")) {
      resolved = resolve(workingDir, resolved)
      healed[key] = resolved
      actions.push({ stage: "path", from: value, to: resolved })
      continue
    }

    // An out-of-root absolute path is deliberately left unmodified here.
    // file-operations.ts's `Path traversal detected:` throw is the sole
    // confinement authority (09-UNIFIED-PROGRAM.md §6.6 / F9) — this used to
    // silently remap the argument to `<workingDir>/<basename>`, which let the
    // write/read succeed at a path the model never asked for while terminal
    // verification (checking the model's original path) reported the run
    // FAILED next to a file that was actually written correctly. Passing the
    // out-of-root path through unchanged lets the tool's own throw fire, so
    // the model sees a legible, recoverable error instead of a silent rescue.

    if (resolved !== value) {
      healed[key] = resolved
      actions.push({ stage: "path", from: value, to: resolved })
    }
  }

  return { healed, actions }
}

export function coerceTypes(
  args: Record<string, unknown>,
  schema: ToolSchema,
): ResolveResult {
  const healed = { ...args }
  const actions: HealingAction[] = []

  for (const param of schema.parameters) {
    const value = healed[param.name]
    if (value === undefined) continue

    if (param.type === "number" && typeof value === "string") {
      const num = Number(value)
      if (!isNaN(num)) {
        healed[param.name] = num
        actions.push({ stage: "type-coerce", from: `string(${value})`, to: `number(${num})` })
      }
    } else if (param.type === "boolean" && typeof value === "string") {
      if (value === "true") {
        healed[param.name] = true
        actions.push({ stage: "type-coerce", from: value, to: "true" })
      } else if (value === "false") {
        healed[param.name] = false
        actions.push({ stage: "type-coerce", from: value, to: "false" })
      }
    }
  }

  return { healed, actions }
}
