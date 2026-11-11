/**
 * Turns a structured grade into the `EvalResult` fields `EvalService` records
 * for a case that declares `structured` expectations instead of a judge.
 */
import type { DimensionScore } from "../types/eval-result.js";
import type { GradeFieldResult, StructuredExpectation } from "../types/structured-expectation.js";
import { gradeOutput } from "./structured.js";

/** Dimension name a structured case's score is recorded under. */
export const STRUCTURED_DIMENSION = "structured";

/** The case-level outcome of a structured grade. */
export interface StructuredCaseGrade {
  /** One `structured` score, or none when the grade is inconclusive. */
  readonly scores: DimensionScore[];
  readonly overallScore: number;
  /** True only when every check passed. Partial credit shows in the score, not here. */
  readonly passed: boolean;
  readonly fieldResults: readonly GradeFieldResult[];
  /** Set when the grade is inconclusive (nothing to check, or an invalid check). */
  readonly error?: string;
}

const describeFailures = (fields: readonly GradeFieldResult[]): string =>
  fields
    .filter((f) => f.outcome !== "pass")
    .map((f) => `${f.path || "(root)"}: ${f.reason}`)
    .join("; ");

/** Grade one case's output deterministically. No LLM is called. */
export const gradeStructuredCase = (
  expectation: StructuredExpectation,
  actualOutput: string,
  structuredOutput?: unknown,
): StructuredCaseGrade => {
  const grade = gradeOutput(expectation, actualOutput, structuredOutput);

  if (grade.verdict === "inconclusive") {
    const why = grade.invalid > 0 ? describeFailures(grade.fields) : "the expectation declares no fields or checks";
    return {
      scores: [],
      overallScore: 0,
      passed: false,
      fieldResults: grade.fields,
      error: `structured grade inconclusive: ${why}`,
    };
  }

  const summary = `${grade.passed}/${grade.passed + grade.failed} checks passed`;
  const failures = describeFailures(grade.fields);
  return {
    scores: [{ dimension: STRUCTURED_DIMENSION, score: grade.score, details: failures ? `${summary}; ${failures}` : summary }],
    overallScore: grade.score,
    passed: grade.verdict === "pass",
    fieldResults: grade.fields,
  };
};
