import type { HealingAction } from "../drivers/tool-calling-driver.js"
import { editDistance } from "./edit-distance.js"

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

interface HealParamResult {
  readonly healed: Record<string, unknown>
  readonly actions: readonly HealingAction[]
}

export function healParamNames(
  toolName: string,
  attempted: Record<string, unknown>,
  schema: ToolSchema,
  knownParamAliases: Record<string, Record<string, string>>,
): HealParamResult {
  const toolAliases = knownParamAliases[toolName] ?? {}
  const schemaParamNames = schema.parameters.map((p) => p.name)
  const healed: Record<string, unknown> = {}
  const actions: HealingAction[] = []

  for (const [attemptedKey, value] of Object.entries(attempted)) {
    // 1. Exact match
    if (schemaParamNames.includes(attemptedKey)) {
      if (!(attemptedKey in healed)) healed[attemptedKey] = value
      continue
    }

    // 2. Alias map
    const aliased = toolAliases[attemptedKey]
    if (aliased !== undefined && schemaParamNames.includes(aliased)) {
      if (!(aliased in healed)) {
        healed[aliased] = value
        actions.push({ stage: "param-name", from: attemptedKey, to: aliased })
      }
      continue
    }

    // 3. Edit distance (≤ 2)
    let bestParam: string | null = null
    let bestDist = Infinity
    for (const schemaParam of schemaParamNames) {
      const dist = editDistance(attemptedKey.toLowerCase(), schemaParam.toLowerCase())
      if (dist < bestDist) {
        bestDist = dist
        bestParam = schemaParam
      }
    }
    if (bestDist <= 2 && bestParam !== null && !(bestParam in healed)) {
      healed[bestParam] = value
      actions.push({ stage: "param-name", from: attemptedKey, to: bestParam })
      continue
    }

    // 4. Unknown — preserve as-is
    healed[attemptedKey] = value
  }

  return { healed, actions }
}
