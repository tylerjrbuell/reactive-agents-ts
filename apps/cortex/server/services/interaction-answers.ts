/**
 * Answers to a structured `request_user_input` (several typed questions): the id-keyed
 * map is checked against the asked questions BEFORE it reaches the waiting run, with the
 * framework's own rules (`validateAnswers`, `@reactive-agents/tools`). A rejected map goes
 * back to the person with what to fix, instead of failing inside the run where only the
 * agent would see it. A legacy `kind` + `schema` ask has no questions and is not checked.
 */
import { Either } from "effect";
import type { InteractionQuestion } from "@reactive-agents/core";
import { validateAnswers, type AnswerError } from "@reactive-agents/tools";

/** The slice of a pending interaction these rules read. */
export interface PendingQuestionsLike {
  readonly questions?: readonly InteractionQuestion[] | undefined;
  readonly schema?: unknown;
}

/**
 * The typed questions of a pending interaction: its `questions`, else the persisted
 * `schema.questions` (a durable pause stores them there). Empty for a legacy ask.
 */
export function questionsOfPending(p: PendingQuestionsLike): readonly InteractionQuestion[] {
  if (p.questions !== undefined && p.questions.length > 0) return p.questions;
  const schema = p.schema;
  if (schema !== null && typeof schema === "object" && !Array.isArray(schema)) {
    const q = (schema as { questions?: unknown }).questions;
    if (Array.isArray(q)) return q as readonly InteractionQuestion[];
  }
  return [];
}

/** What a rejected answer map tells the person: one line per question, by id and prompt. */
export function describeAnswerErrors(questions: readonly InteractionQuestion[], errors: readonly AnswerError[]): string {
  const prompts = new Map(questions.map((q) => [q.id, q.prompt]));
  return errors
    .map((e) => {
      const prompt = prompts.get(e.id);
      return prompt === undefined ? e.message : `${prompt}: ${e.message}`;
    })
    .join("; ");
}

/**
 * Check `value` against the asked `questions`. No questions means nothing to check
 * (`ok`). Otherwise `value` must be an id-keyed map whose answers pass; the error text
 * is meant for the person.
 */
export function checkInteractionAnswer(
  questions: readonly InteractionQuestion[],
  value: unknown,
): { readonly ok: true } | { readonly ok: false; readonly error: string } {
  if (questions.length === 0) return { ok: true };
  const checked = validateAnswers({ questions }, value);
  return Either.isRight(checked) ? { ok: true } : { ok: false, error: `The answers need a change. ${describeAnswerErrors(questions, checked.left)}` };
}
