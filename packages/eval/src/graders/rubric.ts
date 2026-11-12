/**
 * Rubric grader: one calibrated judgment question about an agent output.
 *
 * Honest about uncertainty (invariant 2): a judge that errors, answers the
 * wrong kind, or is not confident enough gives `inconclusive`, never a
 * guessed pass. Deterministic checks belong in `structured`; this runs only
 * for what data cannot decide.
 */
import { Effect } from "effect";
import {
  capabilitiesOf,
  type JudgmentAnswer,
  type JudgmentEntry,
  type JudgmentError,
  type JudgmentService,
  type QuestionSpec,
} from "@reactive-agents/judgment";
import type { Rubric, RubricVerdict } from "../types/rubric.js";

/** Least confidence a verdict needs when the rubric does not say. */
export const DEFAULT_RUBRIC_MIN_CONFIDENCE = 0.6;
/** Least confidence an uncalibrated backend's verdict needs, whatever the rubric asks. */
export const UNCALIBRATED_MIN_CONFIDENCE = 0.8;

/** Question id used in the single-question `ask` batch. */
const QUESTION_ID = "rubric";

const inconclusive = (kind: RubricVerdict["kind"], reason: string, extra: Partial<RubricVerdict> = {}): RubricVerdict => ({
  ...extra,
  verdict: "inconclusive",
  kind,
  reason,
});

type NoulRubric = Extract<Rubric, { readonly question: { readonly type: "noul" } }>;
type ChoiceRubric = Extract<Rubric, { readonly question: { readonly type: "choice" } }>;
type ScoreRubric = Extract<Rubric, { readonly question: { readonly type: "score" } }>;

const isNoul = (r: Rubric): r is NoulRubric => r.question.type === "noul";
const isChoice = (r: Rubric): r is ChoiceRubric => r.question.type === "choice";
const isScore = (r: Rubric): r is ScoreRubric => r.question.type === "score";

/** Why a rubric cannot be asked at all (so no judge call is spent), or undefined when it is well formed. */
export const rubricProblem = (rubric: Rubric): string | undefined => {
  if (rubric.minConfidence !== undefined && !(rubric.minConfidence >= 0 && rubric.minConfidence <= 1)) {
    return "minConfidence must be between 0 and 1";
  }
  if (isNoul(rubric)) {
    const p = rubric.passWhen.minProbability;
    return p !== undefined && !(p > 0 && p <= 1) ? "passWhen.minProbability must be in (0, 1]" : undefined;
  }
  if (isChoice(rubric)) {
    const accept = rubric.passWhen.accept;
    if (accept.length === 0) return "passWhen.accept is empty";
    const unknown = accept.filter((label) => !Object.hasOwn(rubric.question.criteria, label));
    return unknown.length > 0 ? `passWhen.accept names labels not in the question: ${unknown.join(", ")}` : undefined;
  }
  if (isScore(rubric)) {
    const levels = rubric.question.criteria.length;
    const minScore = rubric.passWhen.minScore;
    return levels < 2 || !(minScore >= 0 && minScore <= levels - 1)
      ? `passWhen.minScore must be within the rubric levels 0..${levels - 1}`
      : undefined;
  }
  return "unknown question type";
};

/**
 * Read one judgment answer against a rubric. Pure: no judge is called here.
 * `calibratedFallback` is the backend's declared calibration, used for Noul
 * answers, which do not carry the flag.
 */
export const readRubricAnswer = (
  rubric: Rubric,
  answer: JudgmentAnswer,
  options: { readonly calibratedFallback: boolean; readonly backend?: string },
): RubricVerdict => {
  const kind = rubric.question.type;
  const backend = options.backend !== undefined ? { backend: options.backend } : {};
  if (answer.kind !== kind) {
    return inconclusive(kind, `backend answered a ${answer.kind} for a ${kind} question`, backend);
  }

  let passed = false;
  let raw: number | string = 0;
  let score = 0;
  let confidence = 0;
  let calibrated = false;

  if (answer.kind === "noul" && isNoul(rubric)) {
    passed = answer.probability >= (rubric.passWhen.minProbability ?? 0.5);
    raw = answer.probability;
    score = answer.probability;
    confidence = Math.max(answer.probability, 1 - answer.probability);
    calibrated = options.calibratedFallback;
  } else if (answer.kind === "choice" && isChoice(rubric)) {
    const accept = rubric.passWhen.accept;
    passed = accept.includes(answer.value);
    raw = answer.value;
    const hasDistribution = Object.keys(answer.probabilities).length > 0;
    score = hasDistribution
      ? Math.min(1, accept.reduce((sum, label) => sum + (answer.probabilities[label] ?? 0), 0))
      : passed ? 1 : 0;
    confidence = answer.confidence;
    calibrated = answer.calibrated;
  } else if (answer.kind === "score" && isScore(rubric)) {
    passed = answer.value >= rubric.passWhen.minScore;
    raw = answer.value;
    score = Math.max(0, Math.min(1, answer.value / (rubric.question.criteria.length - 1)));
    confidence = answer.confidence;
    calibrated = answer.calibrated;
  }

  const facts = { answer: raw, score, confidence, calibrated, ...backend };
  if (!Number.isFinite(confidence) || !Number.isFinite(score)) {
    return inconclusive(kind, "backend returned a non-numeric answer", facts);
  }

  const required = Math.max(
    rubric.minConfidence ?? DEFAULT_RUBRIC_MIN_CONFIDENCE,
    calibrated ? 0 : UNCALIBRATED_MIN_CONFIDENCE,
  );
  if (confidence < required) {
    const why = calibrated ? "" : " (uncalibrated backend needs higher agreement)";
    return inconclusive(
      kind,
      `confidence ${confidence.toFixed(2)} is below the required ${required.toFixed(2)}${why}`,
      { ...facts, requiredConfidence: required },
    );
  }
  return {
    ...facts,
    requiredConfidence: required,
    verdict: passed ? "pass" : "fail",
    kind,
    reason: `${passed ? "passed" : "failed"} with ${kind} answer ${String(raw)} at confidence ${confidence.toFixed(2)}`,
  };
};

/**
 * Ask the judgment service the rubric's question about `state` and read the
 * answer. Never fails: a malformed rubric, a missing service or any
 * `JudgmentError` becomes an `inconclusive` verdict naming the cause.
 */
export const gradeRubric = (
  rubric: Rubric,
  state: JudgmentEntry,
  judgment: JudgmentService["Type"] | undefined,
): Effect.Effect<RubricVerdict> => {
  const kind = rubric.question.type;
  const problem = rubricProblem(rubric);
  if (problem !== undefined) return Effect.succeed(inconclusive(kind, `invalid rubric: ${problem}`));
  if (judgment === undefined) {
    return Effect.succeed(inconclusive(kind, "no JudgmentService is wired, so the rubric cannot be judged"));
  }
  return Effect.gen(function* () {
    const caps = yield* capabilitiesOf(judgment);
    // The rubric question is a schema-decoded value; its shape equals QuestionSpec.
    const question: QuestionSpec = rubric.question;
    const answers = yield* judgment.ask({ state, questions: { [QUESTION_ID]: question } });
    const answer = answers[QUESTION_ID];
    return readRubricAnswer(rubric, answer, {
      calibratedFallback: caps.calibrated,
      ...(judgment.backend !== undefined ? { backend: judgment.backend } : {}),
    });
  }).pipe(
    Effect.catchAll((error: JudgmentError) =>
      Effect.succeed(inconclusive(kind, `judgment failed (${error._tag}): ${error.message}`,
        judgment.backend !== undefined ? { backend: judgment.backend } : {})),
    ),
  );
};
