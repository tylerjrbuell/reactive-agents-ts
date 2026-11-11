import { Schema } from "effect";

/**
 * Deterministic expectations for a typed (structured) agent result.
 *
 * Every field here is plain JSON so a suite file (or Cortex "save this result
 * as a test case") can store it. Paths are RFC 6901 JSON Pointers, the same
 * form as `StructuredFieldError.path` in `@reactive-agents/core`: `""` is the
 * root value, `/items/0/name` is the `name` of the first item.
 */

/** JSON value kinds a `type` check can assert. `integer` is a whole finite number. */
export const JsonTypeNameSchema = Schema.Literal("string", "number", "integer", "boolean", "object", "array", "null");
export type JsonTypeName = typeof JsonTypeNameSchema.Type;

const path = Schema.String;

/** One deterministic check against the value at `path`. */
export const FieldCheckSchema = Schema.Union(
  /** Deep equality with `value` (JSON semantics: key order does not matter). */
  Schema.Struct({ kind: Schema.Literal("equals"), path, value: Schema.Unknown }),
  /**
   * Numeric closeness. Passes when `|actual - value| <= tolerance` (absolute,
   * default 0) or `|actual - value| <= relativeTolerance * |value|`. Bounds are
   * inclusive.
   */
  Schema.Struct({
    kind: Schema.Literal("approx"),
    path,
    value: Schema.Number,
    tolerance: Schema.optional(Schema.Number),
    relativeTolerance: Schema.optional(Schema.Number),
  }),
  /** The string at `path` contains `value`. */
  Schema.Struct({
    kind: Schema.Literal("contains"),
    path,
    value: Schema.String,
    caseInsensitive: Schema.optional(Schema.Boolean),
  }),
  /** The string at `path` matches the regular expression `pattern` (with `flags`). */
  Schema.Struct({ kind: Schema.Literal("matches"), path, pattern: Schema.String, flags: Schema.optional(Schema.String) }),
  /**
   * The array at `path` has at least one element matching `value`. Object
   * values match partially (extra keys on the element are ignored), so
   * `{ id: 3 }` finds the element whose `id` is 3.
   */
  Schema.Struct({ kind: Schema.Literal("array-contains"), path, value: Schema.Unknown }),
  /** Length of the array or string at `path`. At least one bound is required. */
  Schema.Struct({
    kind: Schema.Literal("length"),
    path,
    min: Schema.optional(Schema.Number),
    max: Schema.optional(Schema.Number),
    equals: Schema.optional(Schema.Number),
  }),
  /** The value at `path` exists and is of JSON type `type`. */
  Schema.Struct({ kind: Schema.Literal("type"), path, type: JsonTypeNameSchema }),
);
export type FieldCheck = typeof FieldCheckSchema.Type;

/**
 * What a structured case expects. Both parts are optional, but an expectation
 * that declares nothing grades `inconclusive`, never `pass`.
 */
export const StructuredExpectationSchema = Schema.Struct({
  /**
   * Partial expected value. Every leaf in it is checked at its path; keys the
   * actual value has but `fields` does not are ignored. Arrays compare element
   * by element and must have the same length.
   */
  fields: Schema.optional(Schema.Unknown),
  /** Explicit per-path checks (tolerance, contains, regex, length, type, ...). */
  checks: Schema.optional(Schema.Array(FieldCheckSchema)),
  /** Absolute tolerance for numeric leaves in `fields` (default 0: exact). */
  numericTolerance: Schema.optional(Schema.Number),
});
export type StructuredExpectation = typeof StructuredExpectationSchema.Type;

/** What produced a field result: a check kind, `schema` (Effect Schema validation) or `json` (output parse). */
export const GradeCheckKindSchema = Schema.Literal(
  "equals",
  "approx",
  "contains",
  "matches",
  "array-contains",
  "length",
  "type",
  "schema",
  "json",
);
export type GradeCheckKind = typeof GradeCheckKindSchema.Type;

/**
 * Outcome of one field check. `invalid` means the check itself could not be
 * decided (bad regex, bad pointer, length check with no bound): the grader
 * abstains instead of guessing.
 */
export const FieldOutcomeSchema = Schema.Literal("pass", "fail", "invalid");
export type FieldOutcome = typeof FieldOutcomeSchema.Type;

/** Result of one deterministic check at one path. */
export const GradeFieldResultSchema = Schema.Struct({
  /** RFC 6901 JSON Pointer of the checked value. */
  path: Schema.String,
  check: GradeCheckKindSchema,
  outcome: FieldOutcomeSchema,
  /** Why it passed or failed, in plain words. */
  reason: Schema.String,
  expected: Schema.optional(Schema.Unknown),
  actual: Schema.optional(Schema.Unknown),
});
export type GradeFieldResult = typeof GradeFieldResultSchema.Type;

/**
 * Overall grade. `pass`: every check passed. `fail`: at least one check
 * failed and none was invalid. `inconclusive`: a check was invalid or there
 * was nothing to check.
 */
export const GradeVerdictSchema = Schema.Literal("pass", "fail", "inconclusive");
export type GradeVerdict = typeof GradeVerdictSchema.Type;

/** Aggregate of field results. `score` is passed / decided checks (0 when none decided). */
export const GradeResultSchema = Schema.Struct({
  verdict: GradeVerdictSchema,
  score: Schema.Number,
  passed: Schema.Number,
  failed: Schema.Number,
  invalid: Schema.Number,
  fields: Schema.Array(GradeFieldResultSchema),
});
export type GradeResult = typeof GradeResultSchema.Type;
