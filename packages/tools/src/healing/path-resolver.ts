import { resolve, basename } from "node:path"
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

    // Hallucinated absolute path (not within working dir) → remap filename to working dir
    if (!resolved.startsWith(workingDir)) {
      const remapped = resolve(workingDir, basename(resolved))
      healed[key] = remapped
      actions.push({ stage: "path", from: value, to: remapped })
      continue
    }

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
