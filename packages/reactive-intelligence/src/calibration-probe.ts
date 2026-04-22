interface ToolParamSchema {
  readonly name: string
  readonly type: string
  readonly description?: string
  readonly required?: boolean
}

interface ToolSchema {
  readonly name: string
  readonly description: string
  readonly parameters: readonly ToolParamSchema[]
}

export interface FCDimensionScore {
  toolNameAccuracy: number
  paramNameAccuracy: number
  typeCompliance: number
  requiredParamCompleteness: number
  multiToolSelection: number
}

const WEIGHTS: Record<keyof FCDimensionScore, number> = {
  toolNameAccuracy: 0.25,
  paramNameAccuracy: 0.30,
  typeCompliance: 0.15,
  requiredParamCompleteness: 0.15,
  multiToolSelection: 0.15,
}

export function scoreFCResponse(
  response: { name: string; arguments: Record<string, unknown> },
  expectedSchema: ToolSchema,
  registeredToolNames: readonly string[],
): FCDimensionScore {
  const toolNameAccuracy =
    registeredToolNames.includes(response.name) && response.name === expectedSchema.name ? 1 : 0

  const requiredParams = expectedSchema.parameters.filter((p) => p.required)
  const paramNameAccuracy =
    requiredParams.length === 0
      ? 1
      : requiredParams.every((p) => p.name in response.arguments) &&
          Object.keys(response.arguments).every((k) =>
            expectedSchema.parameters.some((p) => p.name === k),
          )
        ? 1
        : 0

  const typeCompliance =
    requiredParams.every((p) => {
      const val = response.arguments[p.name]
      if (val === undefined) return false
      if (p.type === "string") return typeof val === "string"
      if (p.type === "number") return typeof val === "number"
      if (p.type === "boolean") return typeof val === "boolean"
      return true
    })
      ? 1
      : 0

  const requiredParamCompleteness =
    requiredParams.every((p) => p.name in response.arguments) ? 1 : 0

  const multiToolSelection = toolNameAccuracy

  return {
    toolNameAccuracy,
    paramNameAccuracy,
    typeCompliance,
    requiredParamCompleteness,
    multiToolSelection,
  }
}

export function computeFCCapabilityScore(scores: FCDimensionScore[]): number {
  if (scores.length === 0) return 0
  const avgDimension = (dim: keyof FCDimensionScore): number =>
    scores.reduce((sum, s) => sum + s[dim], 0) / scores.length
  return (
    avgDimension("toolNameAccuracy") * WEIGHTS.toolNameAccuracy +
    avgDimension("paramNameAccuracy") * WEIGHTS.paramNameAccuracy +
    avgDimension("typeCompliance") * WEIGHTS.typeCompliance +
    avgDimension("requiredParamCompleteness") * WEIGHTS.requiredParamCompleteness +
    avgDimension("multiToolSelection") * WEIGHTS.multiToolSelection
  )
}

export function selectToolCallDialect(score: number): "native-fc" | "text-parse" {
  return score >= 0.8 ? "native-fc" : "text-parse"
}

/** Seed aliases discovered during failed probe calls. */
export function extractProbeAliases(
  responses: Array<{
    attempted: Record<string, unknown>
    schema: ToolSchema
    toolAttempted: string
    toolExpected: string
  }>,
): { toolAliases: Record<string, string>; paramAliases: Record<string, Record<string, string>> } {
  const toolAliases: Record<string, string> = {}
  const paramAliases: Record<string, Record<string, string>> = {}

  for (const { attempted, schema, toolAttempted, toolExpected } of responses) {
    if (toolAttempted !== toolExpected) toolAliases[toolAttempted] = toolExpected

    const toolParamAliases: Record<string, string> = {}
    for (const attemptedKey of Object.keys(attempted)) {
      if (!schema.parameters.some((p) => p.name === attemptedKey)) {
        const schemaParam = schema.parameters.find(
          (p) => !Object.keys(attempted).includes(p.name),
        )
        if (schemaParam) toolParamAliases[attemptedKey] = schemaParam.name
      }
    }
    if (Object.keys(toolParamAliases).length > 0) {
      paramAliases[toolExpected] = { ...(paramAliases[toolExpected] ?? {}), ...toolParamAliases }
    }
  }

  return { toolAliases, paramAliases }
}
