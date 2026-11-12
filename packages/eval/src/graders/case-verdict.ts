/**
 * Grades one case that declares `structured` expectations, a `rubric`, or both.
 *
 * Order (golden rule 5, deterministic before LLM): structured checks run
 * first. The rubric is asked only when they pass or are absent, so a case
 * data already failed costs no judge call. The result is one grade with a
 * per-check breakdown.
 */
import { Effect } from "effect";
import type { JudgmentService } from "@reactive-agents/judgment";
import type { EvalCase } from "../types/eval-case.js";
import type { DimensionScore, EvalResult } from "../types/eval-result.js";
import type { GradeFieldResult } from "../types/structured-expectation.js";
import type { CaseVerdict, CheckBreakdown, RubricVerdict } from "../types/rubric.js";
import { gradeStructuredCase } from "./case-grading.js";
import { gradeRubric } from "./rubric.js";

/** Dimension name a rubric case's score is recorded under. */
export const RUBRIC_DIMENSION = "rubric";

/** The case-level outcome of structured and rubric grading. */
export interface CaseGrade {
  readonly scores: DimensionScore[];
  readonly overallScore: number;
  /** True only when every check passed. An `inconclusive` case is not passed. */
  readonly passed: boolean;
  readonly verdict: CaseVerdict;
  readonly fieldResults?: readonly GradeFieldResult[];
  readonly rubric?: RubricVerdict;
  readonly checks: readonly CheckBreakdown[];
  /** Set when the grade is inconclusive. */
  readonly error?: string;
}

/** Whether a case is graded by data and/or judgment instead of the suite's judge dimensions. */
export const hasCaseGrader = (evalCase: EvalCase): boolean =>
  evalCase.structured !== undefined || evalCase.rubric !== undefined;

/** Build the `EvalResult` for a graded case. */
export const gradedResult = (
  evalCase: EvalCase,
  agentConfig: string,
  grade: CaseGrade,
  actualOutput: string,
  run: { readonly latencyMs: number; readonly costUsd: number; readonly tokensUsed: number; readonly stepsExecuted: number },
): EvalResult => ({
  caseId: evalCase.id,
  timestamp: new Date(),
  agentConfig,
  scores: grade.scores,
  overallScore: grade.overallScore,
  actualOutput,
  ...run,
  passed: grade.passed,
  verdict: grade.verdict,
  checks: grade.checks,
  ...(grade.fieldResults !== undefined ? { fieldResults: grade.fieldResults } : {}),
  ...(grade.rubric !== undefined ? { rubric: grade.rubric } : {}),
  ...(grade.error !== undefined ? { error: grade.error } : {}),
});

const mean = (xs: readonly number[]): number => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Grade a case with `structured` and/or `rubric`. `judgment` is the optional
 * service; without it a rubric is `inconclusive`.
 */
export const gradeCase = (
  evalCase: EvalCase,
  actualOutput: string,
  structuredOutput: unknown,
  judgment: JudgmentService["Type"] | undefined,
): Effect.Effect<CaseGrade> =>
  Effect.gen(function* () {
    const structured =
      evalCase.structured !== undefined ? gradeStructuredCase(evalCase.structured, actualOutput, structuredOutput) : undefined;
    const structuredVerdict: CaseVerdict | undefined =
      structured === undefined ? undefined : structured.error !== undefined ? "inconclusive" : structured.passed ? "pass" : "fail";
    const structuredCheck: CheckBreakdown[] =
      structured === undefined || structuredVerdict === undefined
        ? []
        : [{ check: "structured", verdict: structuredVerdict, ...(structured.error !== undefined ? { detail: structured.error } : {}) }];

    const runRubric = evalCase.rubric !== undefined && structuredVerdict !== "fail" && structuredVerdict !== "inconclusive";
    const rubric =
      runRubric && evalCase.rubric !== undefined
        ? yield* gradeRubric(
            evalCase.rubric,
            {
              input: evalCase.input,
              ...(evalCase.expectedOutput !== undefined ? { expectedOutput: evalCase.expectedOutput } : {}),
              actualOutput,
            },
            judgment,
          )
        : undefined;

    const scores: DimensionScore[] = [
      ...(structured?.scores ?? []),
      ...(rubric !== undefined && rubric.verdict !== "inconclusive" && rubric.score !== undefined
        ? [{
            dimension: RUBRIC_DIMENSION,
            score: rubric.score,
            details: rubric.reason,
            ...(rubric.confidence !== undefined ? { confidence: rubric.confidence } : {}),
          }]
        : []),
    ];
    const checks: CheckBreakdown[] = [
      ...structuredCheck,
      ...(rubric !== undefined ? [{ check: "rubric" as const, verdict: rubric.verdict, detail: rubric.reason }] : []),
    ];

    const verdict: CaseVerdict = checks.some((c) => c.verdict === "inconclusive")
      ? "inconclusive"
      : checks.some((c) => c.verdict === "fail")
        ? "fail"
        : "pass";
    const error =
      structured?.error ?? (rubric?.verdict === "inconclusive" ? `rubric grade inconclusive: ${rubric.reason}` : undefined);

    return {
      scores,
      overallScore: verdict === "inconclusive" ? 0 : mean(scores.map((s) => s.score)),
      passed: verdict === "pass",
      verdict,
      ...(structured !== undefined ? { fieldResults: structured.fieldResults } : {}),
      ...(rubric !== undefined ? { rubric } : {}),
      checks,
      ...(error !== undefined ? { error } : {}),
    };
  });
