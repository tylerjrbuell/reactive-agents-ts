import { spawnSync } from "node:child_process"
import type { BenchmarkTask, DimensionScore, QualityDimension, RunScore, SuccessCriteria } from "./types.js"
// Local mirror of `@reactive-agents/judge-server`'s wire contract. We re-declare
// rather than import because the judge-server package's `exports` map only
// surfaces `.` (no `./src/contract.js`), and Task 8 must not modify files outside
// `packages/benchmarks/`. The shape mirrors `packages/judge-server/src/contract.ts`
// — keep in sync if the contract evolves.
interface JudgeRequest {
  taskId: string
  sutResponse: string
  taskInput: unknown
  sutModel: string
  runId: string
  taskCriteria?: string
}

interface JudgeLayerResult {
  layerName: string
  score: number
  passed: boolean
  details?: string
}

interface JudgeResponse {
  taskId: string
  passed: boolean
  overallScore: number
  recommendation: "accept" | "review" | "reject"
  layerResults: ReadonlyArray<JudgeLayerResult>
  reproducibility: {
    judgeModelSha: string
    judgeCodeSha: string
  }
}

/**
 * Default judge-server URL when neither callsite nor env supplies one.
 * Matches the default port the server binds to in `src/index.ts`.
 */
const DEFAULT_JUDGE_URL = "http://127.0.0.1:8910"

/**
 * Options threaded down to the RPC layer. Currently just `judgeUrl`; future
 * tasks (Task 9 Rule-4 guard, Task 10 reproducibility metadata) will extend
 * this struct.
 */
export interface JudgeRpcOptions {
  /**
   * Base URL of the judge-server (e.g. "http://127.0.0.1:8910").
   * If omitted, falls back to `process.env.JUDGE_URL`, then to
   * `DEFAULT_JUDGE_URL`.
   */
  judgeUrl?: string
}

function resolveJudgeUrl(opts?: JudgeRpcOptions): string {
  return opts?.judgeUrl ?? process.env["JUDGE_URL"] ?? DEFAULT_JUDGE_URL
}

// ── Pure utility functions (testable without LLM) ────────────────────────────

/**
 * Reliability = 1 - 2*stddev of accuracy scores across runs.
 * 1.0 = perfectly consistent, 0.0 = completely random.
 */
export function computeReliability(runs: ReadonlyArray<RunScore>): number {
  if (runs.length < 2) return 1
  const scores = runs.map(r => r.dimensions.find(d => d.dimension === "accuracy")?.score ?? 0)
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length
  return Math.max(0, 1 - 2 * Math.sqrt(variance))
}

/**
 * Test a regex SuccessCriteria against output — returns 1.0 (pass) or 0.0 (fail).
 */
export function matchSuccessCriteria(output: string, criteria: SuccessCriteria): number {
  if (criteria.type !== "regex") return 0
  try {
    return new RegExp(criteria.pattern, "i").test(output) ? 1.0 : 0.0
  } catch {
    return output.toLowerCase().includes(criteria.pattern.toLowerCase()) ? 1.0 : 0.0
  }
}

/**
 * Parse bun test / jest-style output to extract a partial credit ratio.
 * Looks for patterns like "3 pass" and "1 fail".
 */
export function parsePartialCreditScore(output: string): number {
  const passMatch = output.match(/(\d+)\s+pass/i)
  const failMatch = output.match(/(\d+)\s+fail/i)
  if (!passMatch) return 0.0
  const pass = parseInt(passMatch[1]!, 10)
  const fail = parseInt(failMatch?.[1] ?? "0", 10)
  const total = pass + fail
  return total === 0 ? 0.0 : pass / total
}

// ── Verifiable scoring — runs a command in tmpDir ────────────────────────────

export async function scoreVerifiable(
  command: string,
  tmpDir: string,
  partialCredit = false,
): Promise<DimensionScore> {
  const [cmd, ...args] = command.split(" ")
  const result = spawnSync(cmd!, args, { cwd: tmpDir, encoding: "utf8", timeout: 30_000 })

  if (result.status === 0) {
    return { dimension: "accuracy", score: 1.0 }
  }

  if (partialCredit) {
    const combined = (result.stdout ?? "") + (result.stderr ?? "")
    const score = parsePartialCreditScore(combined)
    return { dimension: "accuracy", score, evidence: `exit ${result.status}: ${combined.slice(0, 200)}` }
  }

  const err = (result.stderr ?? "").slice(0, 300)
  return { dimension: "accuracy", score: 0.0, evidence: `exit ${result.status}: ${err}` }
}

// ── LLM-as-judge — routed through judge-server RPC (Task 8) ──────────────────

/**
 * POST a JudgeRequest to the judge-server and return the parsed JudgeResponse.
 * Throws on non-2xx — callers (`scoreWithJudge`) trap and convert to a
 * score-0 DimensionScore so a single judge outage cannot crash a bench run.
 */
async function callJudge(
  req: JudgeRequest,
  opts?: JudgeRpcOptions,
): Promise<JudgeResponse> {
  const baseUrl = resolveJudgeUrl(opts)
  const res = await fetch(`${baseUrl}/judge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => "(no body)")
    throw new Error(`Judge RPC failed: ${res.status} ${detail}`)
  }
  return (await res.json()) as JudgeResponse
}

async function scoreWithJudge(
  taskId: string,
  taskPrompt: string,
  output: string,
  dimension: QualityDimension,
  rubric: string,
  opts?: JudgeRpcOptions,
): Promise<DimensionScore> {
  // Build a JudgeRequest. Bench harness does not yet thread `sutModel` /
  // `runId` down to per-dimension scoring — Task 10 owns that. For now we
  // synthesise a runId so the contract validates and the request is still
  // traceable in judge-server logs.
  const req: JudgeRequest = {
    taskId,
    sutResponse: output.slice(0, 1500),
    taskInput: { prompt: taskPrompt.slice(0, 800), dimension },
    sutModel: process.env["BENCH_SUT_MODEL"] ?? "unknown",
    runId: `bench-${taskId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    taskCriteria: rubric,
  }
  try {
    const verdict = await callJudge(req, opts)
    const score = Math.max(0, Math.min(1, Number(verdict.overallScore) || 0))
    const evidence =
      verdict.layerResults.find(l => l.details)?.details
      ?? `recommendation=${verdict.recommendation} passed=${verdict.passed}`
    return { dimension, score, evidence }
  } catch (e) {
    return { dimension, score: 0, evidence: `Judge error: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ── Main entry: score a task run across all relevant dimensions ───────────────

/**
 * Score a completed task run across all dimensions it exercises.
 * Accuracy is always scored. Other dimensions come from task.dimensionRubrics.
 * Efficiency is computed from token counts. Reliability is session-level (not here).
 */
export async function scoreTask(
  output: string,
  task: BenchmarkTask,
  tmpDir: string,
  runTokens: number,
  _runIterations: number,
  opts?: JudgeRpcOptions,
): Promise<ReadonlyArray<DimensionScore>> {
  const scores: DimensionScore[] = []

  // ── Accuracy ────────────────────────────────────────────────────────────────
  if (task.successCriteria) {
    switch (task.successCriteria.type) {
      case "regex":
        scores.push({ dimension: "accuracy", score: matchSuccessCriteria(output, task.successCriteria) })
        break
      case "verifiable":
        scores.push(await scoreVerifiable(
          task.successCriteria.command,
          tmpDir,
          task.successCriteria.partialCredit,
        ))
        break
      case "llm-judge":
        scores.push(await scoreWithJudge(
          task.id, task.prompt, output, "accuracy", task.successCriteria.rubric, opts,
        ))
        break
      case "schema":
        // Validates JSON parseability only — shape validation against task.successCriteria.schema
        // is not yet implemented and will always score 1.0 for any valid JSON output.
        try {
          JSON.parse(output)
          scores.push({ dimension: "accuracy", score: 1.0 })
        } catch {
          scores.push({ dimension: "accuracy", score: 0.0, evidence: "Output is not valid JSON" })
        }
        break
    }
  } else if (task.expected) {
    // Legacy regex from existing tasks
    const patterns = task.expected.split("|")
    const matched = patterns.some(p => {
      try { return new RegExp(p, "i").test(output) }
      catch { return output.toLowerCase().includes(p.toLowerCase()) }
    })
    scores.push({ dimension: "accuracy", score: matched ? 1.0 : 0.0 })
  }

  // ── Efficiency — normalized token usage ─────────────────────────────────────
  if (task.primaryDimensions?.includes("efficiency")) {
    const baselineTokens = 500 * (task.maxIterations ?? 15)
    const ratio = runTokens / baselineTokens
    const effScore = Math.max(0, 1 - Math.min(1, Math.max(0, ratio - 0.5) / 1.5))
    scores.push({ dimension: "efficiency", score: effScore,
      evidence: `${runTokens} tokens used (baseline ${baselineTokens})` })
  }

  // ── LLM-judged dimensions from task.dimensionRubrics ───────────────────────
  if (task.dimensionRubrics?.length) {
    for (const rubric of task.dimensionRubrics) {
      if (rubric.dimension === "accuracy") continue  // already scored above
      if (rubric.dimension === "efficiency") continue  // computed above
      if (rubric.dimension === "reliability") continue  // session-level aggregation
      scores.push(await scoreWithJudge(task.id, task.prompt, output, rubric.dimension, rubric.rubric, opts))
    }
  }

  return scores
}
