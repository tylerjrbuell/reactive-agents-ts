// packages/testing/src/harness/scenario.ts

import { ReactiveAgents } from "@reactive-agents/runtime"
import { loadTrace } from "@reactive-agents/trace"
import type { Trace } from "@reactive-agents/trace"

// ─── Config & Result Types ───────────────────────────────────────────────────

export interface ScenarioConfig {
  readonly name: string
  readonly task: string
  readonly provider?: string
  readonly model?: string
  readonly withReactiveIntelligence?: boolean
  readonly tracingDir?: string
  readonly maxIterations?: number
  /** Test scenario turns for the mock LLM (used when no provider is set). */
  readonly testTurns?: import("@reactive-agents/llm-provider").TestTurn[]
}

export interface ScenarioResult {
  readonly runId: string
  readonly output: string
  readonly trace: Trace
  readonly durationMs: number
}

// ─── runScenario ─────────────────────────────────────────────────────────────

/**
 * Build and run a configured agent against a single task, persisting a JSONL
 * trace to `tracingDir`. Returns the parsed trace alongside the agent output.
 *
 * When `provider` is omitted and `testTurns` is supplied, the builder is put
 * into test mode via `.withTestScenario()` — no real LLM is required.
 *
 * @example
 * ```typescript
 * const result = await runScenario({
 *   name: "ping",
 *   task: "ping",
 *   testTurns: [{ text: "pong" }],
 * })
 * expectTrace(result.trace).toHaveCompleted("success")
 * ```
 */
export async function runScenario(config: ScenarioConfig): Promise<ScenarioResult> {
  const dir = config.tracingDir ?? `/tmp/scenarios/${config.name}-${Date.now()}`

  let builder = ReactiveAgents.create().withTracing({ dir })

  if (config.provider && config.model) {
    builder = builder.withProvider(config.provider as Parameters<typeof builder.withProvider>[0]).withModel(config.model)
  } else if (config.testTurns) {
    builder = builder.withTestScenario(config.testTurns)
  }

  if (config.withReactiveIntelligence) {
    builder = builder.withReactiveIntelligence()
  }

  if (config.maxIterations !== undefined) {
    builder = builder.withMaxIterations(config.maxIterations)
  }

  const t0 = Date.now()
  const agent = await builder.build()
  try {
    const result = await agent.run(config.task)
    // The trace recorder keys JSONL files by taskId (which equals the trace runId)
    const trace = await loadTrace(`${dir}/${result.taskId}.jsonl`)
    return {
      runId: result.taskId,
      output: result.output,
      trace,
      durationMs: Date.now() - t0,
    }
  } finally {
    await agent.dispose()
  }
}

// ─── runCounterfactual ───────────────────────────────────────────────────────

export interface CounterfactualResult {
  readonly baseline: ScenarioResult
  readonly variant: ScenarioResult
  readonly diff: {
    readonly interventionsBaselineOnly: readonly string[]
    readonly interventionsVariantOnly: readonly string[]
    readonly outputChanged: boolean
  }
}

/**
 * Run two scenario configurations in parallel and compute a structural diff.
 *
 * The diff captures which `intervention-dispatched` decision types appeared
 * exclusively in each run and whether the final output text changed.
 *
 * @example
 * ```typescript
 * const result = await runCounterfactual(baseConfig, variantConfig)
 * expect(result.diff.outputChanged).toBe(false)
 * ```
 */
export async function runCounterfactual(
  base: ScenarioConfig,
  variant: ScenarioConfig,
): Promise<CounterfactualResult> {
  const [baseline, variantResult] = await Promise.all([
    runScenario(base),
    runScenario(variant),
  ])

  const baseInterventions = baseline.trace.events
    .filter((e) => e.kind === "intervention-dispatched")
    .map((e) => (e as { decisionType: string }).decisionType)

  const variantInterventions = variantResult.trace.events
    .filter((e) => e.kind === "intervention-dispatched")
    .map((e) => (e as { decisionType: string }).decisionType)

  const baseSet = new Set(baseInterventions)
  const varSet = new Set(variantInterventions)

  return {
    baseline,
    variant: variantResult,
    diff: {
      interventionsBaselineOnly: baseInterventions.filter((t) => !varSet.has(t)),
      interventionsVariantOnly: variantInterventions.filter((t) => !baseSet.has(t)),
      outputChanged: baseline.output !== variantResult.output,
    },
  }
}
