import type { ToolCallSpec } from "../tool-calling/types.js"
import type { HealingAction, HealingResult } from "../drivers/tool-calling-driver.js"
import { healToolName } from "./tool-name-healer.js"
import { healParamNames } from "./param-name-healer.js"
import { unwrapWrappedArgs, remapSingleMissingRequired } from "./param-structure-healer.js"
import { resolvePaths, coerceTypes } from "./path-resolver.js"

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

export function runHealingPipeline(
  call: ToolCallSpec,
  registeredTools: readonly ToolSchema[],
  fileToolNames: ReadonlySet<string>,
  workingDir: string,
  knownToolAliases: Record<string, string>,
  knownParamAliases: Record<string, Record<string, string>>,
): HealingResult {
  const actions: HealingAction[] = []
  let currentName = call.name
  let currentArgs = { ...call.arguments }

  // Stage 1 — ToolNameHealer
  const registeredNames = registeredTools.map((t) => t.name)
  const nameResult = healToolName(currentName, registeredNames, knownToolAliases)
  if (nameResult.resolved === null) {
    return { call, actions: actions as readonly HealingAction[], succeeded: false }
  }
  if (nameResult.action) actions.push(nameResult.action)
  currentName = nameResult.resolved

  // Stage 2a — StructureHealer: unwrap args nested under a wrapper key
  // (e.g. `{ input: { path, content } }`) BEFORE name healing so the inner
  // keys are visible to alias/typo resolution.
  const schema = registeredTools.find((t) => t.name === currentName)
  if (schema) {
    const unwrapResult = unwrapWrappedArgs(currentArgs, schema)
    actions.push(...unwrapResult.actions)
    currentArgs = unwrapResult.healed as Record<string, unknown>
  }

  // Stage 2b — ParamNameHealer
  if (schema) {
    const paramResult = healParamNames(currentName, currentArgs, schema, knownParamAliases)
    actions.push(...paramResult.actions)
    currentArgs = paramResult.healed as Record<string, unknown>
  }

  // Stage 2c — StructureHealer: exactly-one-missing-required remap, AFTER
  // name healing so aliases/typos don't count as unknowns, and BEFORE path
  // resolution so a remapped `path` still gets resolved.
  if (schema) {
    const remapResult = remapSingleMissingRequired(currentArgs, schema)
    actions.push(...remapResult.actions)
    currentArgs = remapResult.healed as Record<string, unknown>
  }

  // Stage 3 — PathResolver
  if (schema) {
    const pathResult = resolvePaths(currentName, currentArgs, fileToolNames, workingDir)
    actions.push(...pathResult.actions)
    currentArgs = pathResult.healed as Record<string, unknown>
  }

  // Stage 4 — TypeCoercer
  if (schema) {
    const typeResult = coerceTypes(currentArgs, schema)
    actions.push(...typeResult.actions)
    currentArgs = typeResult.healed as Record<string, unknown>
  }

  const healedCall: ToolCallSpec = { ...call, name: currentName, arguments: currentArgs }
  return { call: healedCall, actions: actions as readonly HealingAction[], succeeded: true }
}
