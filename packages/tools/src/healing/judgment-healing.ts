import { Effect, Either } from "effect"
import { JudgmentService, passes } from "@reactive-agents/judgment"
import type { JudgmentAnswer, JudgmentEntry, QuestionSpecs } from "@reactive-agents/judgment"
import type { ToolCallSpec } from "../tool-calling/types.js"
import type { HealingAction, HealingResult } from "../drivers/tool-calling-driver.js"
import { healToolName } from "./tool-name-healer.js"
import { healParamNames } from "./param-name-healer.js"
import { editDistance } from "./edit-distance.js"
import { unwrapWrappedArgs, remapSingleMissingRequired } from "./param-structure-healer.js"
import { resolvePaths, coerceTypes } from "./path-resolver.js"
import { runHealingPipeline } from "./healing-pipeline.js"

/**
 * judgment-healing.ts — Task 12 ("Healing stage 3 — ADD, lowest leverage,
 * Jev on distance miss"). An ADDITIONAL escalation over the existing
 * synchronous pipeline (`healing-pipeline.ts`), never a rewrite of it.
 *
 * Fires ONLY when the sync `healToolName()` stage (edit distance ≤ 2, alias
 * map, exact match) misses — i.e. `runHealingPipeline` would otherwise return
 * `succeeded: false`. On a miss, this batches one `JudgmentService.ask()`
 * request: a Choice over the closest-by-edit-distance candidate tool names
 * (criteria = each candidate's own description) plus one Noul per parameter
 * of the top-scoring candidate (`arg_present::<paramName>`), asking whether
 * one of the attempted argument keys represents that parameter under a
 * different name.
 *
 * Backend-agnostic (`JudgmentService` is resolved by the caller, exactly like
 * `runJudgmentBattery` in `@reactive-agents/guardrails`) and degrade-never-fail:
 * any backend error, or an answer that doesn't clear `passes(..., { minProbability: 0.8 })`,
 * returns the original call unchanged (`succeeded: false`) — the exact same
 * shape the sync pipeline already returns on an unresolved miss.
 */

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

/** Confidence floor below which a judgment answer is treated as "no heal" — matches Task 11's guardrail-battery floor. */
const MIN_PROBABILITY = 0.8

/** How many closest-by-edit-distance registered tools to offer as Choice candidates. */
const MAX_CANDIDATES = 5

interface CandidateShortlist {
  /** Candidates ordered by ascending edit distance to the attempted name. */
  readonly candidates: readonly ToolSchema[]
  /** The single closest candidate — its parameters get `arg_present::<paramName>` Nouls. */
  readonly topScoring: ToolSchema
}

/** Ranks every registered tool by edit distance to `attempted`, ascending, capped at `MAX_CANDIDATES`. */
function buildCandidateShortlist(
  attempted: string,
  registeredTools: readonly ToolSchema[],
): CandidateShortlist | null {
  if (registeredTools.length === 0) return null
  const attemptedLower = attempted.toLowerCase()
  const withDistance = registeredTools.map((t) => ({
    tool: t,
    distance: editDistance(attemptedLower, t.name.toLowerCase()),
  }))
  withDistance.sort((a, b) => a.distance - b.distance)
  const candidates = withDistance.slice(0, MAX_CANDIDATES).map((d) => d.tool)
  return { candidates, topScoring: candidates[0]! }
}

/** Named state for the batched `ask()` — the attempted tool name plus the attempted argument keys (no values — keeps the state JSON-safe and minimal). */
export const buildJudgmentHealingState = (
  attemptedToolName: string,
  attemptedArguments: Record<string, unknown>,
): JudgmentEntry => ({
  attemptedToolName,
  attemptedArgumentKeys: Object.keys(attemptedArguments),
})

/** One Choice over the candidate tool names plus one Noul per top-scoring candidate's parameter, batched into a single `ask()`. */
export function buildJudgmentHealingQuestions(shortlist: CandidateShortlist): QuestionSpecs {
  const toolNameChoice: QuestionSpecs = {
    tool_name: {
      type: "choice" as const,
      instructions:
        "Which registered tool did the caller most likely intend, given the attempted tool name and argument keys in the state?",
      criteria: Object.fromEntries(shortlist.candidates.map((c) => [c.name, c.description])),
    },
  }
  const paramNouls: QuestionSpecs = Object.fromEntries(
    shortlist.topScoring.parameters.map((p) => [
      `arg_present::${p.name}`,
      {
        type: "noul" as const,
        instructions: `Does one of the attempted argument keys represent the parameter '${p.name}'${
          p.description ? ` (${p.description})` : ""
        }, even if named differently?`,
      },
    ]),
  )
  return { ...toolNameChoice, ...paramNouls }
}

/** Extracts the resolved tool name from the Choice answer, gated on `passes(..., { minProbability: MIN_PROBABILITY })`. `null` on any miss/low-confidence/malformed answer. */
function resolvedToolNameFrom(answer: JudgmentAnswer | undefined): string | null {
  if (!answer || answer.kind !== "choice") return null
  return passes(answer, { minProbability: MIN_PROBABILITY }) ? answer.value : null
}

/** Names of the top-scoring candidate's parameters whose `arg_present::<paramName>` Noul passed the confidence floor. */
function presentParamNamesFrom(
  answers: Readonly<Record<string, JudgmentAnswer>>,
  topScoring: ToolSchema,
): readonly string[] {
  return topScoring.parameters
    .filter((p) => {
      const answer = answers[`arg_present::${p.name}`]
      return answer !== undefined && answer.kind === "noul" && passes(answer, { minProbability: MIN_PROBABILITY })
    })
    .map((p) => p.name)
}

/**
 * Renames leftover (unmatched) attempted argument keys onto judgment-confirmed
 * parameter names. Deliberately conservative: only remaps when exactly one
 * unclaimed attempted key remains for a given confirmed-but-missing parameter,
 * mirroring the sync pipeline's `remapSingleMissingRequired` heuristic.
 */
function remapArgsByJudgment(
  currentArgs: Record<string, unknown>,
  presentParamNames: readonly string[],
  schema: ToolSchema,
): { readonly healed: Record<string, unknown>; readonly actions: readonly HealingAction[] } {
  const schemaParamNames = new Set(schema.parameters.map((p) => p.name))
  let unclaimedKeys = Object.keys(currentArgs).filter((k) => !schemaParamNames.has(k))
  const healed = { ...currentArgs }
  const actions: HealingAction[] = []

  for (const paramName of presentParamNames) {
    if (paramName in healed) continue
    if (unclaimedKeys.length !== 1) continue
    const [key] = unclaimedKeys
    if (key === undefined) continue
    healed[paramName] = healed[key]
    delete healed[key]
    actions.push({ stage: "judgment", from: key, to: paramName })
    unclaimedKeys = unclaimedKeys.filter((k) => k !== key)
  }

  return { healed, actions }
}

/** Runs every remaining sync stage (param-name/structure/path/type) against the judgment-resolved tool name — mirrors stages 2b/2c/3/4 of `runHealingPipeline`. */
function finishSyncStages(
  resolvedName: string,
  currentArgs: Record<string, unknown>,
  schema: ToolSchema,
  fileToolNames: ReadonlySet<string>,
  workingDir: string,
  knownParamAliases: Record<string, Record<string, string>>,
): { readonly args: Record<string, unknown>; readonly actions: readonly HealingAction[] } {
  const actions: HealingAction[] = []
  let args = currentArgs

  const paramNameResult = healParamNames(resolvedName, args, schema, knownParamAliases)
  actions.push(...paramNameResult.actions)
  args = paramNameResult.healed as Record<string, unknown>

  const remapResult = remapSingleMissingRequired(args, schema)
  actions.push(...remapResult.actions)
  args = remapResult.healed as Record<string, unknown>

  const pathResult = resolvePaths(resolvedName, args, fileToolNames, workingDir)
  actions.push(...pathResult.actions)
  args = pathResult.healed as Record<string, unknown>

  const typeResult = coerceTypes(args, schema)
  actions.push(...typeResult.actions)
  args = typeResult.healed as Record<string, unknown>

  return { args, actions }
}

/**
 * Task 12: the judgment-backed healing escalation. ONLY invokes
 * `judgment.ask()` when the sync `healToolName()` stage misses (unresolved
 * name — no exact match, no alias, edit distance > 2). An exact/alias/
 * distance-≤2 match delegates straight to the unchanged `runHealingPipeline`
 * with zero `ask()` calls.
 */
export function runJudgmentHealing(
  judgment: JudgmentService["Type"],
  call: ToolCallSpec,
  registeredTools: readonly ToolSchema[],
  fileToolNames: ReadonlySet<string>,
  workingDir: string,
  knownToolAliases: Record<string, string>,
  knownParamAliases: Record<string, Record<string, string>>,
): Effect.Effect<HealingResult, never> {
  const registeredNames = registeredTools.map((t) => t.name)
  const nameResult = healToolName(call.name, registeredNames, knownToolAliases)

  // Sync healer already resolved the name (exact/alias/distance ≤ 2) — not a
  // miss, so delegate to the existing pipeline unchanged and never call ask().
  if (nameResult.resolved !== null) {
    return Effect.succeed(
      runHealingPipeline(call, registeredTools, fileToolNames, workingDir, knownToolAliases, knownParamAliases),
    )
  }

  const shortlist = buildCandidateShortlist(call.name, registeredTools)
  if (shortlist === null) {
    return Effect.succeed({ call, actions: [], succeeded: false })
  }

  const state = buildJudgmentHealingState(call.name, call.arguments)
  const questions = buildJudgmentHealingQuestions(shortlist)

  return judgment.ask({ state, questions }).pipe(
    Effect.either,
    Effect.map((result) => {
      if (Either.isLeft(result)) return { call, actions: [], succeeded: false } as const

      const answers = result.right
      const resolvedName = resolvedToolNameFrom(answers.tool_name)
      if (resolvedName === null) return { call, actions: [], succeeded: false } as const

      const actions: HealingAction[] = [{ stage: "judgment", from: call.name, to: resolvedName }]
      let currentArgs = { ...call.arguments }

      // The Choice's `value` is expected to be constrained to one of the
      // offered criteria keys, but this is untrusted backend output — a
      // resolved name with no matching registered schema is a malformed
      // answer, not a successful heal (degrade-never-fail, never trust a
      // tool name that doesn't resolve to a real schema).
      const resolvedSchema = registeredTools.find((t) => t.name === resolvedName)
      if (!resolvedSchema) return { call, actions: [], succeeded: false } as const

      // Structure-unwrap (mirrors stage 2a) against the resolved schema.
      const unwrapResult = unwrapWrappedArgs(currentArgs, resolvedSchema)
      actions.push(...unwrapResult.actions)
      currentArgs = unwrapResult.healed as Record<string, unknown>

      // Param remap only applies when judgment resolved to the SAME tool whose
      // params the arg_present Nouls were asked about — otherwise the Noul
      // answers don't describe the resolved schema and are skipped.
      if (resolvedName === shortlist.topScoring.name) {
        const presentParamNames = presentParamNamesFrom(answers, shortlist.topScoring)
        const remap = remapArgsByJudgment(currentArgs, presentParamNames, resolvedSchema)
        currentArgs = remap.healed
        actions.push(...remap.actions)
      }

      const finished = finishSyncStages(resolvedName, currentArgs, resolvedSchema, fileToolNames, workingDir, knownParamAliases)
      actions.push(...finished.actions)

      return {
        call: { ...call, name: resolvedName, arguments: finished.args },
        actions,
        succeeded: true,
      } as const
    }),
  )
}
