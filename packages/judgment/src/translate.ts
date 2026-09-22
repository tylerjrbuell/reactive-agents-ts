/**
 * The ONLY module allowed to touch `@typesafe-ai/sdk` types (Global
 * Constraints: `packages/judgment` isolates the vendor SDK behind
 * `JudgmentBackend`). Converts RA's backend-agnostic question specs to the
 * SDK's `Questions` shape and the SDK's `SystemOneResult` back to
 * `JudgmentAnswers`.
 */
import { choice, noul, score } from "@typesafe-ai/sdk";
import type { EntryType, Question, Questions, SystemOneResult } from "@typesafe-ai/sdk";
import type {
  ChoiceAnswer,
  JudgmentAnswer,
  JudgmentAnswers,
  JudgmentEntry,
  NoulAnswer,
  QuestionSpec,
  QuestionSpecs,
  ScoreAnswer,
} from "./types.js";

/**
 * `JudgmentEntry` mirrors the SDK's `EntryType` field-for-field (text, a
 * JSON object/array, or `null`) — this is a same-shape rename, not a widened
 * type, so the cast is a single explicit boundary conversion, not an
 * `as unknown as` escape hatch.
 */
export const toSdkEntry = (entry: JudgmentEntry | undefined): EntryType =>
  (entry ?? null) as EntryType;

const toSdkQuestion = (spec: QuestionSpec): Question => {
  switch (spec.type) {
    case "noul":
      return noul(toSdkEntry(spec.instructions), spec.criteria);
    case "choice":
      return choice(toSdkEntry(spec.instructions), spec.criteria);
    case "score":
      return score(toSdkEntry(spec.instructions), spec.criteria);
  }
};

export const toSdkQuestions = (specs: QuestionSpecs): Questions => {
  const out: Record<string, Question> = {};
  for (const [id, spec] of Object.entries(specs)) {
    out[id] = toSdkQuestion(spec);
  }
  return out;
};

const fromSdkAnswer = (answer: SystemOneResult<Questions>["answers"][string]): JudgmentAnswer => {
  switch (answer.type) {
    case "noul":
      return { kind: "noul", probability: answer.noul } satisfies NoulAnswer;
    case "choice":
      return {
        kind: "choice",
        value: answer.choice,
        probabilities: answer.probabilities,
        confidence: answer.confidence,
        calibrated: true,
      } satisfies ChoiceAnswer;
    case "score":
      return {
        kind: "score",
        value: answer.score,
        probabilities: answer.probabilities,
        confidence: answer.confidence,
        calibrated: true,
      } satisfies ScoreAnswer;
    default: {
      // Exhaustiveness guard — a future SDK primitive would land here as a
      // compile error at the call site, not a silent runtime miss.
      const _never: never = answer;
      throw new Error(`Unknown TypeSafe answer type: ${JSON.stringify(_never)}`);
    }
  }
};

/** Never partial-trusts a missing/malformed answer — throws, caught by the backend as `bad-response`. */
export const fromSdkResult = (result: SystemOneResult<Questions>, questionIds: readonly string[]): JudgmentAnswers => {
  const out: Record<string, JudgmentAnswer> = {};
  for (const id of questionIds) {
    const answer = result.answers[id];
    if (answer === undefined) {
      throw new Error(`TypeSafe response missing answer for question "${id}"`);
    }
    out[id] = fromSdkAnswer(answer);
  }
  return out;
};
