/**
 * Voice answers for a structured `request_user_input` (several typed questions). Pure.
 *
 * Each REQUIRED question becomes its own step of the existing voice question flow
 * (`voice-question.ts`: read aloud, listen, read back, confirm before it counts), in
 * the order the agent listed them. Spoken choices match option LABELS; the answer map
 * carries option VALUES. Nothing is sent until every required question has an answer;
 * then one id-keyed map goes out. Optional questions are not asked by voice (they stay
 * on the card; the agent applies their defaults), and a choice only takes its listed
 * options by voice. Approvals never reach this module.
 */
import { questionsOf, type StructuredAnswerValue, type StructuredQuestion } from "../structured-questions.js";
import type { VoiceAnswerValue, VoiceQuestionSpec } from "./voice-answer.js";
import type { VoiceQuestion } from "./voice-question.js";

/** The slice of a live interaction these rules read. */
export interface StructuredInteractionLike {
  readonly interactionId: string;
  readonly questions?: unknown;
  readonly schema?: unknown;
}

/** The voice spec for one question. */
export function voiceSpecOfQuestion(q: StructuredQuestion): VoiceQuestionSpec {
  switch (q.type) {
    case "single-choice":
    case "multi-choice": {
      const options = (q.options ?? []).map((o) => o.label);
      if (options.length === 0) return { kind: "text" };
      return q.type === "multi-choice" ? { kind: "choice", options, multi: true } : { kind: "choice", options };
    }
    case "boolean":
      return { kind: "boolean" };
    case "number":
      return { kind: "number", ...(q.min !== undefined ? { min: q.min } : {}), ...(q.max !== undefined ? { max: q.max } : {}) };
    case "text":
      return { kind: "text" };
  }
}

/** A spoken answer (labels) as the answer map's value (option values). */
export function answerValueOf(q: StructuredQuestion, spoken: VoiceAnswerValue): StructuredAnswerValue {
  const valueOf = (label: string): string => (q.options ?? []).find((o) => o.label === label)?.value ?? label;
  if (q.type === "single-choice" && typeof spoken === "string") return valueOf(spoken);
  if (q.type === "multi-choice") return (Array.isArray(spoken) ? (spoken as readonly string[]) : [String(spoken)]).map(valueOf);
  return spoken;
}

/** The answers collected so far, per interaction. */
export interface StructuredVoiceAnswers {
  get(interactionId: string): Readonly<Record<string, StructuredAnswerValue>>;
  record(interactionId: string, questionId: string, value: StructuredAnswerValue): void;
  clear(interactionId?: string): void;
}

/** An empty collection. */
export function createStructuredVoiceAnswers(): StructuredVoiceAnswers {
  const byInteraction = new Map<string, Record<string, StructuredAnswerValue>>();
  return {
    get: (id) => ({ ...(byInteraction.get(id) ?? {}) }),
    record(id, qid, value) {
      byInteraction.set(id, { ...(byInteraction.get(id) ?? {}), [qid]: value });
    },
    clear(id) {
      if (id === undefined) byInteraction.clear();
      else byInteraction.delete(id);
    },
  };
}

/**
 * The next question to ask by voice: the first REQUIRED one with no answer yet, or
 * `null` when none is left (or the ask is not structured / has no required question).
 * The step id carries the question id, so each step is its own question to the flow.
 */
export function nextVoiceStep(
  interaction: StructuredInteractionLike,
  answered: Readonly<Record<string, StructuredAnswerValue>>,
): VoiceQuestion | null {
  const all = questionsOf(interaction);
  const required = all.filter((q) => q.required !== false);
  const q = required.find((r) => answered[r.id] === undefined);
  if (q === undefined) return null;
  const n = required.indexOf(q) + 1;
  const lead = required.length > 1 ? `Question ${n} of ${required.length}. ` : "";
  return {
    id: `${interaction.interactionId}#${q.id}`,
    prompt: `${lead}${q.prompt}`,
    spec: voiceSpecOfQuestion(q),
    part: { interactionId: interaction.interactionId, questionId: q.id },
  };
}

/** What delivering one spoken answer led to. */
export type PartDelivery =
  | { readonly ok: true; readonly done: boolean }
  | { readonly ok: false; readonly error: string };

/**
 * Take one confirmed spoken answer of a structured ask. It is recorded; while required
 * questions remain, nothing is sent (`done: false`, the caller asks the next with
 * {@link nextVoiceStep}). With none left, the id-keyed map is sent. A failed send clears
 * the collected answers so the person starts again from the first question.
 */
export async function deliverPartAnswer(deps: {
  readonly question: VoiceQuestion;
  readonly value: VoiceAnswerValue;
  readonly interaction: StructuredInteractionLike;
  readonly collected: StructuredVoiceAnswers;
  readonly send: (answers: Readonly<Record<string, StructuredAnswerValue>>) => Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }>;
}): Promise<PartDelivery> {
  const { question, interaction, collected } = deps;
  const part = question.part;
  const q = part === undefined ? undefined : questionsOf(interaction).find((x) => x.id === part.questionId);
  if (part === undefined || q === undefined) return { ok: false, error: "That question is no longer open." };
  collected.record(part.interactionId, q.id, answerValueOf(q, deps.value));
  const answers = collected.get(part.interactionId);
  if (nextVoiceStep(interaction, answers) !== null) return { ok: true, done: false };
  const out = await deps.send(answers);
  if (out.ok) return { ok: true, done: true };
  collected.clear(part.interactionId);
  return out;
}
