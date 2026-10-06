/**
 * System One wire protocol: backend-agnostic RA question specs ↔ JSON body.
 *
 * This file deliberately mirrors `translate.ts`'s `toSdkEntry` / `toSdkQuestions`
 * logic and must stay **SDK-free** (no `@typesafe-ai/sdk` import). Conversely,
 * `translate.ts` must stay SDK-bound. Keep the two files in sync by hand; do not
 * try to share helpers across the isolation boundary.
 *
 * Encoding rules are spec §2.2: `state` and `instructions` are always required on
 * the wire, null/undefined/blank become `{}`, choice `null` criteria are preserved,
 * score `null` criteria become `""`, and noul sides default by omission.
 */

import { Effect, ParseResult, Schema } from "effect";
import { pipe } from "effect/Function";
import {
  type JudgmentAnswer,
  JudgmentBadResponse,
  type JudgmentAnswers,
  type JudgmentEntry,
  type QuestionSpecs,
} from "../../types.js";

/** Wire `state` shape: a nonempty string, an object, or an array — never `null`. */
export type SystemOneContent = string | Record<string, unknown> | readonly unknown[];

/** System One `POST /v1/systemone` request body after RA-side encoding. */
export interface SystemOneRequestBody {
  readonly model: string;
  readonly state: SystemOneContent;
  readonly questions: Record<string, unknown>;
  readonly images?: readonly string[];
}

const isNonBlankString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Shared entry normalizer for `state` and `instructions`.
 * Non-blank strings, objects, and arrays pass through; everything else becomes `{}`.
 */
const toContent = (entry: JudgmentEntry | undefined): SystemOneContent => {
  if (entry === undefined || entry === null) {
    return {};
  }
  if (isNonBlankString(entry)) {
    return entry;
  }
  if (Array.isArray(entry)) {
    return entry;
  }
  if (isObject(entry)) {
    return entry;
  }
  return {};
};

const toChoiceCriteria = (criteria: Readonly<Record<string, JudgmentEntry>>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [label, value] of Object.entries(criteria)) {
    if (typeof value === "string" || value === null) {
      out[label] = value;
    } else {
      out[label] = JSON.stringify(value);
    }
  }
  return out;
};

const toScoreCriteria = (criteria: ReadonlyArray<JudgmentEntry>): readonly string[] =>
  criteria.map((value) => {
    if (typeof value === "string") {
      return value;
    }
    if (value === null) {
      return "";
    }
    return JSON.stringify(value);
  });

const toNoulSide = (value: JudgmentEntry | undefined): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
};

const toNoulCriteria = (
  criteria: { readonly true?: JudgmentEntry; readonly false?: JudgmentEntry } | undefined,
): Record<string, string> => {
  const out: Record<string, string> = {};
  if (criteria === undefined) {
    return out;
  }
  const trueSide = toNoulSide(criteria.true);
  if (trueSide !== undefined) {
    out.true = trueSide;
  }
  const falseSide = toNoulSide(criteria.false);
  if (falseSide !== undefined) {
    out.false = falseSide;
  }
  return out;
};

/**
 * Encode a backend-agnostic `ask()` call into a System One request body.
 *
 * `state` and every question's `instructions` are guaranteed to be present and
 * non-null on the wire. Images are included only when the array is non-empty.
 */
export const encodeSystemOneRequest = (input: {
  readonly model: string;
  readonly state: JudgmentEntry;
  readonly questions: QuestionSpecs;
  readonly images?: readonly string[];
}): SystemOneRequestBody => {
  const questions: Record<string, unknown> = Object.create(null);

  for (const [id, spec] of Object.entries(input.questions)) {
    switch (spec.type) {
      case "noul": {
        questions[id] = {
          type: "noul",
          instructions: toContent(spec.instructions),
          criteria: toNoulCriteria(spec.criteria),
        };
        break;
      }
      case "choice": {
        questions[id] = {
          type: "choice",
          instructions: toContent(spec.instructions),
          criteria: toChoiceCriteria(spec.criteria),
        };
        break;
      }
      case "score": {
        questions[id] = {
          type: "score",
          instructions: toContent(spec.instructions),
          criteria: toScoreCriteria(spec.criteria),
        };
        break;
      }
    }
  }

  return {
    model: input.model,
    state: toContent(input.state),
    questions,
    ...(input.images?.length ? { images: input.images } : {}),
  } satisfies SystemOneRequestBody;
};

const ChoiceWireAnswerSchema = Schema.Struct({
  type: Schema.Literal("choice"),
  choice: Schema.String,
  probabilities: Schema.Record({ key: Schema.String, value: Schema.Number }),
  confidence: Schema.Number,
});

const ScoreWireAnswerSchema = Schema.Struct({
  type: Schema.Literal("score"),
  score: Schema.Number,
  probabilities: Schema.Record({ key: Schema.String, value: Schema.Number }),
  confidence: Schema.Number,
});

const NoulWireAnswerSchema = Schema.Struct({
  type: Schema.Literal("noul"),
  noul: Schema.Number,
});

const WireAnswerSchema = Schema.Union(
  ChoiceWireAnswerSchema,
  ScoreWireAnswerSchema,
  NoulWireAnswerSchema,
);

const SystemOneResponseSchema = Schema.Struct({
  answers: Schema.Record({ key: Schema.String, value: WireAnswerSchema }),
});

type WireAnswer = Schema.Schema.Type<typeof WireAnswerSchema>;

const wireAnswerToJudgmentAnswer = (answer: WireAnswer): JudgmentAnswer => {
  switch (answer.type) {
    case "choice":
      return {
        kind: "choice",
        value: answer.choice,
        probabilities: answer.probabilities,
        confidence: answer.confidence,
        calibrated: true,
      };
    case "score":
      return {
        kind: "score",
        value: answer.score,
        probabilities: answer.probabilities,
        confidence: answer.confidence,
        calibrated: true,
      };
    case "noul":
      return { kind: "noul", probability: answer.noul };
  }
};

/**
 * Decode a System One response into `JudgmentAnswers`.
 *
 * Every question id in `specs` must be present and its wire `type` must equal the
 * spec's `type`. Unknown wire types, missing answers, and schema violations all
 * become `JudgmentBadResponse` (no raw throw). Response `model` and `usage` are
 * ignored.
 */
export const decodeSystemOneAnswers = (
  raw: unknown,
  specs: QuestionSpecs,
): Effect.Effect<JudgmentAnswers, JudgmentBadResponse> =>
  pipe(
    Schema.decodeUnknown(SystemOneResponseSchema)(raw),
    Effect.mapError(
      (error) =>
        new JudgmentBadResponse({
          message: `System One response decode failed: ${ParseResult.TreeFormatter.formatErrorSync(error)}`,
        }),
    ),
    Effect.flatMap((response) => {
      const out: Record<string, JudgmentAnswer> = {};

      for (const [id, spec] of Object.entries(specs)) {
        const answer = response.answers[id];
        if (answer === undefined) {
          return Effect.fail(
            new JudgmentBadResponse({ message: `missing answer for question "${id}"` }),
          );
        }
        if (answer.type !== spec.type) {
          return Effect.fail(
            new JudgmentBadResponse({
              message: `type mismatch for question "${id}": expected ${spec.type}, got ${answer.type}`,
            }),
          );
        }
        out[id] = wireAnswerToJudgmentAnswer(answer);
      }

      return Effect.succeed(out);
    }),
  );
