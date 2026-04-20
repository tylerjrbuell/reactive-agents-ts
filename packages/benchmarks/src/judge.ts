import { spawnSync } from "node:child_process"
import type { BenchmarkTask, DimensionScore, QualityDimension, RunScore, SuccessCriteria } from "./types.js"
import { ReactiveAgents } from "@reactive-agents/runtime"

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

// ── LLM-as-judge ─────────────────────────────────────────────────────────────

const judgeModel = process.env["BENCH_JUDGE_MODEL"] ?? "claude-haiku-4-5"
const judgeProvider = (process.env["BENCH_JUDGE_PROVIDER"] ?? "anthropic") as "anthropic" | "openai"

async function callJudge(prompt: string): Promise<string> {
  const agent = await ReactiveAgents.create()
    .withName("bench-judge")
    .withProvider(judgeProvider)
    .withModel(judgeModel)
    .withMaxIterations(1)
    .build()
  try {
    const result = await agent.run(prompt)
    return result.output
  } finally {
    await agent.dispose()
  }
}

function buildJudgePrompt(
  taskPrompt: string,
  output: string,
  dimension: QualityDimension,
  rubric: string,
): string {
  return `You are evaluating an AI agent's performance on a benchmark task.

TASK PROMPT:
${taskPrompt.slice(0, 800)}

AGENT OUTPUT (truncated to 1500 chars):
${output.slice(0, 1500)}

DIMENSION: ${dimension}
RUBRIC: ${rubric}

Score the agent's performance on this single dimension from 0.0 to 1.0.
- 1.0 = excellent, fully meets the rubric
- 0.5 = partially meets the rubric
- 0.0 = fails the rubric entirely

Reply with ONLY a JSON object on one line:
{"score": <0.0-1.0>, "evidence": "<one sentence explaining the score>"}`
}

async function scoreWithJudge(
  taskPrompt: string,
  output: string,
  dimension: QualityDimension,
  rubric: string,
): Promise<DimensionScore> {
  const prompt = buildJudgePrompt(taskPrompt, output, dimension, rubric)
  try {
    const raw = await callJudge(prompt)
    const match = raw.match(/\{[^}]+\}/)
    if (!match) throw new Error("No JSON in judge response")
    const parsed = JSON.parse(match[0]) as { score: number; evidence?: string }
    const score = Math.max(0, Math.min(1, Number(parsed.score) || 0))
    return { dimension, score, evidence: parsed.evidence }
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
  runIterations: number,
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
          task.prompt, output, "accuracy", task.successCriteria.rubric,
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
      scores.push(await scoreWithJudge(task.prompt, output, rubric.dimension, rubric.rubric))
    }
  }

  return scores
}
