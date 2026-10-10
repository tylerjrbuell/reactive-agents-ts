import type { JudgmentAnswer, JudgmentAnswers, QuestionSpecs } from "@reactive-agents/judgment";

/** Check dynamic judgment fixtures before narrowing them to their request keys. */
export function hasExactJudgmentAnswerKeys<Q extends QuestionSpecs>(
  questions: Q,
  answers: Readonly<Record<string, JudgmentAnswer>>,
): answers is JudgmentAnswers<Q> {
  const questionIds = Object.keys(questions);
  const answerIds = Object.keys(answers);
  return questionIds.length === answerIds.length && questionIds.every((id) => Object.hasOwn(answers, id));
}
