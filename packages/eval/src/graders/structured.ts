/**
 * Deterministic graders for typed (structured) agent results.
 *
 * Golden rule 5: a grade that can be computed from data is computed, never
 * judged. These graders call no LLM and are pure: the same value and
 * expectation always grade the same. A grader that cannot decide (no checks,
 * an invalid check) returns `inconclusive`, never a guessed `pass`.
 */
import { Either, ParseResult, Schema } from "effect";
import type { GradeFieldResult, GradeResult, StructuredExpectation } from "../types/structured-expectation.js";
import { matchPartial, runFieldCheck } from "./field-checks.js";
import { toJsonPointer } from "./json.js";

/** Aggregate field results into a verdict and a score (passed / decided checks). */
export const summarizeGrade = (fields: readonly GradeFieldResult[]): GradeResult => {
  const passed = fields.filter((f) => f.outcome === "pass").length;
  const failed = fields.filter((f) => f.outcome === "fail").length;
  const invalid = fields.length - passed - failed;
  const decided = passed + failed;
  const verdict = invalid > 0 || decided === 0 ? "inconclusive" : failed > 0 ? "fail" : "pass";
  return { verdict, score: decided > 0 ? passed / decided : 0, passed, failed, invalid, fields };
};

/**
 * Grade `actual` against a partial expected value. Every leaf of `expected`
 * is checked at its JSON Pointer path; keys the actual value has but
 * `expected` does not are ignored. Arrays compare element by element and must
 * have the same length. Numeric leaves are exact unless `numericTolerance`
 * (absolute) is set.
 */
export const gradeFields = (
  actual: unknown,
  expected: unknown,
  options: { readonly numericTolerance?: number } = {},
): GradeResult => summarizeGrade(matchPartial(actual, expected, options.numericTolerance ?? 0));

/**
 * Validate `actual` against an Effect Schema. A valid value gives one passing
 * result at the root; an invalid one gives a failing result per field error,
 * with the same JSON Pointer paths as `StructuredFieldError`.
 */
export const gradeSchema = <A, I>(schema: Schema.Schema<A, I, never>, actual: unknown): GradeResult => {
  const decoded = Schema.decodeUnknownEither(schema, { errors: "all" })(actual);
  if (Either.isRight(decoded)) {
    return summarizeGrade([{ path: "", check: "schema", outcome: "pass", reason: "matches the schema" }]);
  }
  const issues = ParseResult.ArrayFormatter.formatErrorSync(decoded.left);
  return summarizeGrade(
    issues.map((issue) => ({ path: toJsonPointer(issue.path), check: "schema", outcome: "fail", reason: issue.message })),
  );
};

/**
 * Composite grader: `expectation.fields` (partial match), then
 * `expectation.checks`, then `options.schema` when given, in one grade.
 */
export const gradeStructured = <A, I>(
  actual: unknown,
  expectation: StructuredExpectation,
  options: { readonly schema?: Schema.Schema<A, I, never> } = {},
): GradeResult =>
  summarizeGrade([
    ...(expectation.fields !== undefined ? matchPartial(actual, expectation.fields, expectation.numericTolerance ?? 0) : []),
    ...(expectation.checks ?? []).map((check) => runFieldCheck(actual, check)),
    ...(options.schema !== undefined ? gradeSchema(options.schema, actual).fields : []),
  ]);

/** Structured value to grade, or why there is none. */
export type ParsedStructuredOutput =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

const decodeJson = Schema.decodeUnknownEither(Schema.parseJson());

/**
 * The value a structured grade reads: `structuredOutput` when the runner gave
 * one, otherwise `actualOutput` parsed as JSON.
 */
export const parseStructuredOutput = (actualOutput: string, structuredOutput?: unknown): ParsedStructuredOutput => {
  if (structuredOutput !== undefined) return { ok: true, value: structuredOutput };
  const parsed = decodeJson(actualOutput);
  return Either.isRight(parsed)
    ? { ok: true, value: parsed.right }
    : { ok: false, reason: "output is not valid JSON and the runner gave no structuredOutput" };
};

/**
 * Grade an agent output against an expectation, parsing it first. Output that
 * is not JSON fails (one `json` field result); it is a real failure of a
 * typed result, not an undecidable grade.
 */
export const gradeOutput = (
  expectation: StructuredExpectation,
  actualOutput: string,
  structuredOutput?: unknown,
): GradeResult => {
  const parsed = parseStructuredOutput(actualOutput, structuredOutput);
  return parsed.ok
    ? gradeStructured(parsed.value, expectation)
    : summarizeGrade([{ path: "", check: "json", outcome: "fail", reason: parsed.reason }]);
};
