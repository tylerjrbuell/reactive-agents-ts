import { Data, type Effect, Schema } from "effect";

/**
 * Calibrated typed-judgment primitive types.
 *
 * RA-side question specs mirror TypeSafe's Choice/Score/Noul primitives
 * (docs.typesafe.ai/primitives) but stay backend-agnostic — `translate.ts`
 * in each backend maps them to that backend's wire shape. A future
 * open-source System One model, or a second judgment vendor, implements
 * `JudgmentBackend` against these same spec/answer types with zero change
 * to `JudgmentService` or any consumer.
 */

/**
 * A JSON-compatible value — recursively so the object/array branches below
 * type-check. Index signature is intentionally mutable (not `readonly`),
 * matching the SDK's own `JsonValue`: a readonly-indexed object is not
 * structurally assignable to that mutable-indexed target.
 */
type JudgmentJsonValue = string | number | boolean | null | JudgmentJsonValue[] | { [key: string]: JudgmentJsonValue };

/**
 * Text, a JSON-compatible value, or `null` — structurally identical to the
 * SDK's `EntryType`, so `translate.ts`'s `toSdkEntry` is a same-shape rename,
 * not a widening cast.
 */
export type JudgmentEntry = string | { [key: string]: JudgmentJsonValue } | JudgmentJsonValue[] | null;

/** A yes/no question. Noul answers carry a probability only — no confidence. */
export interface NoulSpec {
  readonly type: "noul";
  readonly instructions?: JudgmentEntry;
  readonly criteria?: {
    readonly true?: JudgmentEntry;
    readonly false?: JudgmentEntry;
  };
}

/** Labels mapped to descriptions; `null` leaves a label undescribed. TypeSafe caps this at 255 options. */
export type ChoiceCriteria = Readonly<Record<string, JudgmentEntry>>;

/** A question that selects between named alternatives. */
export interface ChoiceSpec<T extends ChoiceCriteria = ChoiceCriteria> {
  readonly type: "choice";
  readonly instructions?: JudgmentEntry;
  readonly criteria: T;
}

/** At least two, at most ten level descriptions indexed from zero (TypeSafe Score limit). */
export type ScoreCriteria = readonly [JudgmentEntry, JudgmentEntry, ...JudgmentEntry[]];

/** A question that assigns a score using an ordered rubric. */
export interface ScoreSpec<T extends ScoreCriteria = ScoreCriteria> {
  readonly type: "score";
  readonly instructions?: JudgmentEntry;
  readonly criteria: T;
}

export type QuestionSpec = NoulSpec | ChoiceSpec | ScoreSpec;

/** Named questions for one batched `ask()` request. */
export type QuestionSpecs = Readonly<Record<string, QuestionSpec>>;

/**
 * Answer shapes are decoded, in-process response data (constructed by
 * `translate.ts` from a backend's reply) — `Schema.Struct`, matching the
 * project's response-side convention (e.g. `CompletionResponseSchema` in
 * `@reactive-agents/llm-provider`). Question *specs* below stay plain types:
 * they are outbound, generically-typed request shapes we construct in-process
 * (matching that same package's plain `CompletionRequest` type), not decoded
 * wire data.
 */

/** A yes/no answer — probability only, no confidence (see docs.typesafe.ai/confidence). */
export const NoulAnswerSchema = Schema.Struct({
  kind: Schema.Literal("noul"),
  probability: Schema.Number,
});
export type NoulAnswer = Schema.Schema.Type<typeof NoulAnswerSchema>;

/**
 * A Choice answer. `confidence` reflects distribution concentration — 1.0 when
 * all probability sits on one option, lower as it spreads (docs.typesafe.ai/confidence).
 * Backends that cannot calibrate (e.g. the `llm` emulation backend) MUST still
 * populate this shape but set `calibrated: false`.
 */
export const ChoiceAnswerSchema = Schema.Struct({
  kind: Schema.Literal("choice"),
  value: Schema.String,
  probabilities: Schema.Record({ key: Schema.String, value: Schema.Number }),
  confidence: Schema.Number,
  calibrated: Schema.Boolean,
});
export type ChoiceAnswer = Schema.Schema.Type<typeof ChoiceAnswerSchema>;

/** A Score answer — the expected score (may fall between integer levels) plus its rubric. */
export const ScoreAnswerSchema = Schema.Struct({
  kind: Schema.Literal("score"),
  value: Schema.Number,
  probabilities: Schema.Record({ key: Schema.String, value: Schema.Number }),
  confidence: Schema.Number,
  calibrated: Schema.Boolean,
});
export type ScoreAnswer = Schema.Schema.Type<typeof ScoreAnswerSchema>;

export type JudgmentAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

/** Answers keyed by question id, one per `QuestionSpecs` entry supplied. */
export type JudgmentAnswers<Q extends QuestionSpecs = QuestionSpecs> = {
  readonly [K in keyof Q]: JudgmentAnswer;
};

/**
 * Typed judgment failures. No `throw` — every backend failure is caught at
 * its call site and returned as one of these tags. Consumers degrade to
 * their existing heuristic/LLM path on any of them; see Global Constraints
 * in the plan ("degrade, never fail").
 */
export class JudgmentUnauthorized extends Data.TaggedError("JudgmentUnauthorized")<{
  readonly message: string;
}> {}
export class JudgmentRateLimited extends Data.TaggedError("JudgmentRateLimited")<{
  readonly message: string;
  readonly retryAfterMs?: number;
}> {}
export class JudgmentTimeout extends Data.TaggedError("JudgmentTimeout")<{
  readonly message: string;
  readonly timeoutMs: number;
}> {}
export class JudgmentBadResponse extends Data.TaggedError("JudgmentBadResponse")<{
  readonly message: string;
}> {}
export class JudgmentConnectionError extends Data.TaggedError("JudgmentConnectionError")<{
  readonly message: string;
}> {}
/** A backend was asked to do something it doesn't implement (e.g. `listModels` on the llm-emulation backend). */
export class JudgmentUnsupported extends Data.TaggedError("JudgmentUnsupported")<{
  readonly message: string;
}> {}

export type JudgmentError =
  | JudgmentUnauthorized
  | JudgmentRateLimited
  | JudgmentTimeout
  | JudgmentBadResponse
  | JudgmentConnectionError
  | JudgmentUnsupported;

/** Explicit config — no hidden globals. `apiKey` falls back to `TYPESAFE_API_KEY` only inside the `jev` backend. */
export const JudgmentConfig = Schema.Struct({
  apiKey: Schema.optional(Schema.String),
  baseUrl: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  timeoutMs: Schema.optional(Schema.Number),
  defaultConfidenceFloor: Schema.optional(Schema.Number),
});
export type JudgmentConfig = Schema.Schema.Type<typeof JudgmentConfig>;

export const DEFAULT_TIMEOUT_MS = 3000;

/**
 * One HTTP/inference round trip over a batch of questions sharing one state.
 * The ONLY interface a judgment provider implements — `translate.ts` in each
 * backend is the sole module allowed to touch that provider's own SDK/wire
 * types (Global Constraints: `packages/judgment` deps are `core` + SDK only).
 */
/** One entry from a backend's model catalog (docs.typesafe.ai/models#listing-models). */
export type JudgmentModel = {
  readonly name: string;
  readonly description: string;
  readonly releaseDate: string;
};

export interface JudgmentBackend {
  readonly name: string;
  readonly evaluate: (input: {
    readonly state: JudgmentEntry;
    readonly questions: QuestionSpecs;
    readonly model?: string;
  }) => Effect.Effect<JudgmentAnswers, JudgmentError>;
  /**
   * List the models/aliases this backend's account can send in `model`.
   * Optional — not every backend has a catalog endpoint (e.g. llm-emulation).
   * `JudgmentService.listModels` fails `JudgmentUnsupported` when absent.
   */
  readonly listModels?: () => Effect.Effect<ReadonlyArray<JudgmentModel>, JudgmentError>;
}

/** Gate a Choice/Score answer on both probability and confidence; Noul has probability only. */
export const passes = (
  answer: JudgmentAnswer,
  opts: { readonly minProbability?: number; readonly minConfidence?: number } = {},
): boolean => {
  if (answer.kind === "noul") {
    return opts.minProbability === undefined || answer.probability >= opts.minProbability;
  }
  const probOk =
    opts.minProbability === undefined ||
    (answer.probabilities[answer.value] ?? 0) >= opts.minProbability;
  const confOk = opts.minConfidence === undefined || answer.confidence >= opts.minConfidence;
  return probOk && confOk;
};
