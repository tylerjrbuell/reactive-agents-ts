import { spawnSync } from "node:child_process"
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { BenchmarkTask, DimensionScore, QualityDimension, RunScore, SuccessCriteria } from "./types.js"
import type { JudgeLayerResult, JudgeRequest, JudgeResponse } from "@reactive-agents/judge-server"

// ── Deliverable collection (grading-channel fix) ─────────────────────────────
//
// Per-component budgets: the final text and each produced file get their OWN
// budget so a long preamble can never truncate the file off the end (which
// would re-create the very text-only confound this fixes). Total stays bounded
// so the judge prompt can't explode.
const TEXT_CAP = 1500
const PER_FILE_CAP = 3000
const MAX_FILES = 6
const TOTAL_CAP = 8000

// Extensions we never utf8-dump (binary → garbage in the judge prompt).
const BINARY_EXTENSIONS = new Set<string>([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "pdf",
  "zip", "gz", "tar", "wasm", "exe", "bin", "so", "dylib", "woff", "woff2",
])

function isBinaryName(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  return BINARY_EXTENSIONS.has(ext)
}

/**
 * Build the blob the LLM judge actually grades: the agent's final text answer
 * PLUS the contents of every PRODUCED working-dir file (i.e. files present in
 * tmpDir that were NOT declared input fixtures), each clearly labeled so the
 * judge can attribute "report.md is written". This is what a real user
 * receives — text + artifacts — so it is the honest grading target.
 *
 * Pure beyond the shallow tmpDir read. Input fixtures are excluded (they are
 * inputs, not deliverables). Binary files are skipped. Each component is
 * independently budgeted (see caps above). When no produced files exist this
 * returns just the capped final text — byte-identical intent to the prior
 * text-only behavior for pure-synthesis tasks.
 */
export function collectJudgeDeliverable(
  finalText: string,
  tmpDir: string,
  fixturePaths: readonly string[],
): string {
  const text = finalText.slice(0, TEXT_CAP)

  const fixtures = new Set(fixturePaths.map((p) => p.split("/").pop() ?? p))
  let entries: string[]
  try {
    entries = readdirSync(tmpDir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((name) => !name.startsWith(".") && !fixtures.has(name) && !isBinaryName(name))
      .sort()
  } catch {
    return text // tmpDir unreadable — fall back to text only
  }

  const blocks: string[] = []
  let budget = TOTAL_CAP - text.length
  for (const name of entries) {
    if (blocks.length >= MAX_FILES || budget <= 0) break
    let raw: string
    try {
      raw = readFileSync(join(tmpDir, name), "utf8")
    } catch {
      continue
    }
    if (raw.includes("\u0000")) continue // binary content guard (NUL byte)
    const body = raw.slice(0, Math.min(PER_FILE_CAP, budget))
    const block = `\n\n--- Produced file: ${name} ---\n${body}`
    blocks.push(block)
    budget -= block.length
  }

  if (blocks.length === 0) return text
  return `${text}${blocks.join("")}`.slice(0, TOTAL_CAP)
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
 * Deterministic abstention scoring (no judge):
 *  - trap task (abstainExpected): correct iff the agent abstained.
 *  - solvable task: correct iff it produced the right answer; a premature
 *    abstain scores 0 (guard against over-abstaining).
 */
export function scoreAbstention(i: {
  abstainExpected: boolean;
  abstained: boolean;
  answerCorrect: boolean;
}): number {
  if (i.abstainExpected) return i.abstained ? 1 : 0;
  return i.abstained ? 0 : i.answerCorrect ? 1 : 0;
}

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

// ── Hidden reference fixtures (anti-reward-hack) ─────────────────────────────

/**
 * Materialize `task.hiddenFixtures` into `tmpDir`. Called by `scoreTask`
 * AFTER the agent run has completed and BEFORE any scoring branch executes,
 * so the agent never sees these files but every verifiable-command path
 * (normal accuracy branch AND the abstention branch) runs against them.
 *
 * Overwrites any same-named agent-written file by design: the reference
 * content must win, otherwise an agent could poison the reference channel.
 */
export function writeHiddenFixtures(task: BenchmarkTask, tmpDir: string): void {
  for (const fixture of task.hiddenFixtures ?? []) {
    const dest = join(tmpDir, fixture.path)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, fixture.content, "utf8")
  }
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
    // `output` here is the pre-budgeted judgeDeliverable (text + produced files,
    // each independently capped). Defensive total cap only — must NOT re-cut to
    // 1500 or it would truncate the produced-file content off the end and
    // re-create the text-only confound this fix closes.
    sutResponse: output.slice(0, TOTAL_CAP),
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
 *
 * @param terminatedBy - How the agent loop terminated (mirrors AgentResult.terminatedBy).
 *   When `"abstained"`, the agent earned abstention; combined with `task.abstainExpected`
 *   to route trap tasks through `scoreAbstention`. Optional for backward compatibility
 *   — omit or pass undefined for non-trap runs; scoring is unchanged.
 */
/**
 * Score a cell that produced NO completed run (timeout or crash).
 *
 * These cells must never reach the LLM judge: judging an empty string yields
 * hallucinated evidence (observed 2026-07-07: a timed-out cell came back
 * "at least one database is fabricated"). The cell still scores 0 on the
 * task's dimensions — an end-to-end bench honestly counts a variant that
 * produced nothing as a failure — but the evidence states the real cause so
 * report readers can separate capability gaps from timeouts.
 */
export function scoreErrorCell(
    task: BenchmarkTask,
    cause: string,
    durationMs: number,
): ReadonlyArray<DimensionScore> {
    const evidence = `no output produced (${cause} after ${Math.round(durationMs / 1000)}s) — cell not judged`
    const dims = new Set<QualityDimension>(["accuracy", ...(task.primaryDimensions ?? [])])
    return [...dims].map((dimension) => ({ dimension, score: 0, evidence }))
}

export async function scoreTask(
  output: string,
  task: BenchmarkTask,
  tmpDir: string,
  runTokens: number,
  _runIterations: number,
  opts?: JudgeRpcOptions,
  terminatedBy?: string,
): Promise<ReadonlyArray<DimensionScore>> {
  const scores: DimensionScore[] = []

  // Hidden reference fixtures FIRST: written post-run/pre-scoring so every
  // scoring branch below (verifiable accuracy, abstention answerCorrect,
  // judge deliverable collection) sees them, while the agent never did.
  writeHiddenFixtures(task, tmpDir)

  // The blob the LLM judge grades: final text + produced working-dir files.
  // Used ONLY for llm-judge dimensions (accuracy llm-judge + dimensionRubrics).
  // The deterministic branches (verifiable runs a command; schema does
  // JSON.parse; regex/expected match) must read the RAW `output` — dumping file
  // contents into those would break JSON.parse and cause false regex matches.
  // Hidden fixtures are excluded alongside declared fixtures — they are
  // scoring apparatus, not agent deliverables, and must not be attributed to
  // the agent in the judge prompt.
  const judgeDeliverable = collectJudgeDeliverable(
    output,
    tmpDir,
    [...(task.fixtures ?? []), ...(task.hiddenFixtures ?? [])].map((f) => f.path),
  )

  // ── Trap-task abstention routing ─────────────────────────────────────────────
  // When the task declares abstainExpected OR the agent terminated with an
  // earned abstention, route accuracy through scoreAbstention (deterministic,
  // no judge). The existing deterministic answer check (successCriteria regex /
  // expected pattern) serves as the answerCorrect signal for solvable-task guard.
  // All non-trap, non-abstained runs fall through to the normal scoring below.
  const abstained = terminatedBy === "abstained";
  if (task.abstainExpected === true || abstained) {
    // Compute answerCorrect using the same deterministic check the normal path
    // would use — so the solvable-task premature-abstain guard is accurate.
    let answerCorrect = false;
    if (task.successCriteria?.type === "regex") {
      answerCorrect = matchSuccessCriteria(output, task.successCriteria) === 1;
    } else if (task.successCriteria?.type === "verifiable") {
      const vs = await scoreVerifiable(
        task.successCriteria.command,
        tmpDir,
        task.successCriteria.partialCredit,
      );
      answerCorrect = vs.score === 1;
    } else if (task.expected) {
      const patterns = task.expected.split("|");
      answerCorrect = patterns.some((p) => {
        try { return new RegExp(p, "i").test(output); }
        catch { return output.toLowerCase().includes(p.toLowerCase()); }
      });
    }
    const score = scoreAbstention({
      abstainExpected: task.abstainExpected === true,
      abstained,
      answerCorrect,
    });
    scores.push({ dimension: "accuracy", score });
    // Skip the normal accuracy block; continue to efficiency + dimensionRubrics below.
  } else {

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
          task.id, task.prompt, judgeDeliverable, "accuracy", task.successCriteria.rubric, opts,
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

  } // end else (non-trap / non-abstained accuracy block)

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
      scores.push(await scoreWithJudge(task.id, task.prompt, judgeDeliverable, rubric.dimension, rubric.rubric, opts))
    }
  }

  return scores
}
