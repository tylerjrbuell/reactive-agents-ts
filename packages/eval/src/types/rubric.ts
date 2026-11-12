import { Schema } from "effect";

/**
 * Rubric graders: a case whose pass/fail is a calibrated judgment instead of
 * a data check. A rubric asks one `JudgmentService` question (Noul yes/no,
 * Choice, or Score) about the agent's output and states what answer passes.
 * Use `structured` for anything data can decide; a rubric is the fallback
 * for what only a judge can read.
 */

type RubricJsonValue = string | number | boolean | null | RubricJsonValue[] | { [key: string]: RubricJsonValue };

const RubricJsonValueSchema: Schema.Schema<RubricJsonValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    Schema.mutable(Schema.Array(RubricJsonValueSchema)),
    Schema.mutable(Schema.Record({ key: Schema.String, value: RubricJsonValueSchema })),
  ),
);

/** Instructions or a level description: text or JSON, as `JudgmentEntry`. */
const EntrySchema = Schema.Union(
  Schema.String,
  Schema.Null,
  Schema.mutable(Schema.Array(RubricJsonValueSchema)),
  Schema.mutable(Schema.Record({ key: Schema.String, value: RubricJsonValueSchema })),
);

const NoulQuestionSchema = Schema.Struct({
  type: Schema.Literal("noul"),
  instructions: Schema.optional(EntrySchema),
  criteria: Schema.optional(Schema.Struct({ true: Schema.optional(EntrySchema), false: Schema.optional(EntrySchema) })),
});

const ChoiceQuestionSchema = Schema.Struct({
  type: Schema.Literal("choice"),
  instructions: Schema.optional(EntrySchema),
  criteria: Schema.Record({ key: Schema.String, value: EntrySchema }),
});

const ScoreQuestionSchema = Schema.Struct({
  type: Schema.Literal("score"),
  instructions: Schema.optional(EntrySchema),
  /** At least two level descriptions, indexed from zero. */
  criteria: Schema.Tuple([EntrySchema, EntrySchema], EntrySchema),
});

const minConfidence = Schema.optional(Schema.Number);

/**
 * A rubric. `passWhen` depends on the question kind:
 * - noul: `minProbability` (default 0.5), the P(true) at or above which the case passes.
 * - choice: `accept`, the labels that pass.
 * - score: `minScore`, the expected score at or above which the case passes (levels index from 0).
 *
 * `minConfidence` is the least confidence a verdict needs (default 0.6). Noul
 * answers carry a probability only, so their confidence is how decisive the
 * probability is, `max(p, 1 - p)`. An uncalibrated backend (the `llm`
 * emulation) must clear `max(minConfidence, 0.8)`; below that the verdict is
 * `inconclusive`, never a guessed pass.
 */
export const RubricSchema = Schema.Union(
  Schema.Struct({
    question: NoulQuestionSchema,
    passWhen: Schema.Struct({ minProbability: Schema.optional(Schema.Number) }),
    minConfidence,
  }),
  Schema.Struct({
    question: ChoiceQuestionSchema,
    passWhen: Schema.Struct({ accept: Schema.Array(Schema.String) }),
    minConfidence,
  }),
  Schema.Struct({
    question: ScoreQuestionSchema,
    passWhen: Schema.Struct({ minScore: Schema.Number }),
    minConfidence,
  }),
);
export type Rubric = typeof RubricSchema.Type;

/** Outcome of one check or of a whole case. `inconclusive` is never a pass. */
export const CaseVerdictSchema = Schema.Literal("pass", "fail", "inconclusive");
export type CaseVerdict = typeof CaseVerdictSchema.Type;

/** What the judge said and how the rubric read it. */
export const RubricVerdictSchema = Schema.Struct({
  verdict: CaseVerdictSchema,
  kind: Schema.Literal("noul", "choice", "score"),
  /** Raw answer: P(true) for noul, the chosen label for choice, the expected score for score. */
  answer: Schema.optional(Schema.Union(Schema.Number, Schema.String)),
  /** Answer normalised to 0..1 (noul: P(true); choice: probability on accepted labels; score: value over the top level). */
  score: Schema.optional(Schema.Number),
  /** Reported confidence (noul: `max(p, 1 - p)`). */
  confidence: Schema.optional(Schema.Number),
  /** False for an uncalibrated backend such as the `llm` emulation. */
  calibrated: Schema.optional(Schema.Boolean),
  /** Backend that answered, when the service names it. */
  backend: Schema.optional(Schema.String),
  /** The confidence the verdict had to clear. */
  requiredConfidence: Schema.optional(Schema.Number),
  reason: Schema.String,
});
export type RubricVerdict = typeof RubricVerdictSchema.Type;

/** One check's line in a case's breakdown. */
export const CheckBreakdownSchema = Schema.Struct({
  check: Schema.Literal("structured", "rubric"),
  verdict: CaseVerdictSchema,
  detail: Schema.optional(Schema.String),
});
export type CheckBreakdown = typeof CheckBreakdownSchema.Type;
