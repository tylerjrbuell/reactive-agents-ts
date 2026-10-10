import type { JudgmentAnswer, JudgmentAnswers, QuestionSpecs } from "../src/types.js";

/**
 * Narrow a dynamic test answer map to the question-keyed response type after
 * verifying it contains exactly one answer for each requested question.
 */
export function hasExactJudgmentAnswerKeys<Q extends QuestionSpecs>(
  questions: Q,
  answers: Readonly<Record<string, JudgmentAnswer>>,
): answers is JudgmentAnswers<Q> {
  const questionIds = Object.keys(questions);
  const answerIds = Object.keys(answers);
  return (
    questionIds.length === answerIds.length &&
    questionIds.every((id) => Object.hasOwn(answers, id))
  );
}
