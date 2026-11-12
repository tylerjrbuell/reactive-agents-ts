/**
 * Structured `request_user_input` questions (the agent asks several typed questions at
 * once) as the question form and voice mode read them. Pure.
 *
 * A question arrives as `questions` on the interaction (live `InteractionRequested`,
 * the pending-interaction lists) or, for a durable pause, inside the persisted
 * `schema` (`{ questions }`). The answer is an id-keyed map: `{ [question.id]: value }`
 * with a string, number, boolean, or `string[]` (multi-choice). The agent validates it
 * again; the checks here (the same rules) let the form say what is wrong before sending.
 */
import type { InteractionQuestionWire } from "@reactive-agents/ui-core";

/** One question of a structured request. */
export type StructuredQuestion = InteractionQuestionWire;

/** A value in the answer map. */
export type StructuredAnswerValue = string | number | boolean | readonly string[];

/** What the form holds per question while it is being filled. */
export type QuestionDraftValue = string | readonly string[];

/** Form state keyed by question id; a choice's free-text "other" lives under {@link otherKey}. */
export type QuestionDraft = Readonly<Record<string, QuestionDraftValue>>;

const TYPES: ReadonlySet<string> = new Set(["text", "single-choice", "multi-choice", "boolean", "number"]);

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

function readQuestion(raw: unknown): StructuredQuestion | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || raw.id === "" || typeof raw.prompt !== "string" || typeof raw.type !== "string" || !TYPES.has(raw.type)) return null;
  const options = Array.isArray(raw.options)
    ? raw.options.flatMap((o): { label: string; value: string; description?: string }[] =>
        isRecord(o) && typeof o.value === "string"
          ? [{ label: typeof o.label === "string" && o.label !== "" ? o.label : o.value, value: o.value, ...(typeof o.description === "string" && o.description !== "" ? { description: o.description } : {}) }]
          : [],
      )
    : undefined;
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return {
    id: raw.id,
    prompt: raw.prompt,
    type: raw.type as StructuredQuestion["type"],
    ...(options !== undefined && options.length > 0 ? { options } : {}),
    ...(raw.required === false ? { required: false } : {}),
    ...(raw.default !== undefined ? { default: raw.default } : {}),
    ...(num(raw.min) !== undefined ? { min: num(raw.min) as number } : {}),
    ...(num(raw.max) !== undefined ? { max: num(raw.max) as number } : {}),
    ...(num(raw.maxLength) !== undefined ? { maxLength: num(raw.maxLength) as number } : {}),
    ...(raw.allowOther === true ? { allowOther: true } : {}),
  };
}

/**
 * The typed questions of an interaction: `questions` when the wire carries them, else
 * `schema.questions` (a durable pause persists them there). Empty for a legacy
 * `kind` + `schema` question. Malformed entries are dropped; a choice question with no
 * usable options is dropped too (nothing to pick) unless it takes free text.
 */
export function questionsOf(p: { readonly questions?: unknown; readonly schema?: unknown }): readonly StructuredQuestion[] {
  const raw = Array.isArray(p.questions) ? p.questions : isRecord(p.schema) && Array.isArray(p.schema.questions) ? p.schema.questions : [];
  return raw
    .map(readQuestion)
    .filter((q): q is StructuredQuestion => q !== null && (!(q.type === "single-choice" || q.type === "multi-choice") || q.options !== undefined || q.allowOther === true));
}

/** Draft key of a choice question's free-text answer. */
export const otherKey = (id: string): string => `${id}:other`;

/** `question.required` defaults to true. */
export const isRequired = (q: StructuredQuestion): boolean => q.required !== false;

const textOf = (v: QuestionDraftValue | undefined): string => (typeof v === "string" ? v.trim() : "");
const listOf = (v: QuestionDraftValue | undefined): readonly string[] => (Array.isArray(v) ? (v as readonly string[]) : []);

/** The answer map a filled form sends, or the problem per question id (never both). */
export type BuiltAnswers =
  | { readonly ok: true; readonly answers: Readonly<Record<string, StructuredAnswerValue>> }
  | { readonly ok: false; readonly errors: Readonly<Record<string, string>> };

/**
 * Turn the form's draft into the id-keyed answer map. Blank non-required questions are
 * left out (the agent applies their default). Required blanks, numbers out of range,
 * text over `maxLength`, too few / many picks and values outside the options (unless
 * `allowOther`) come back as one message per question id.
 */
export function buildAnswers(questions: readonly StructuredQuestion[], draft: QuestionDraft): BuiltAnswers {
  const answers: Record<string, StructuredAnswerValue> = {};
  const errors: Record<string, string> = {};
  for (const q of questions) {
    const need = (): void => {
      if (isRequired(q)) errors[q.id] = "Answer this question.";
    };
    const optionValues = new Set((q.options ?? []).map((o) => o.value));
    switch (q.type) {
      case "text": {
        const t = textOf(draft[q.id]);
        if (t === "") need();
        else if (q.maxLength !== undefined && t.length > q.maxLength) errors[q.id] = `At most ${q.maxLength} characters.`;
        else answers[q.id] = t;
        break;
      }
      case "number": {
        const t = textOf(draft[q.id]);
        if (t === "") {
          need();
          break;
        }
        const n = Number(t);
        if (!Number.isFinite(n)) errors[q.id] = "Enter a number.";
        else if (q.min !== undefined && n < q.min) errors[q.id] = `At least ${q.min}.`;
        else if (q.max !== undefined && n > q.max) errors[q.id] = `At most ${q.max}.`;
        else answers[q.id] = n;
        break;
      }
      case "boolean": {
        const t = textOf(draft[q.id]);
        if (t === "yes") answers[q.id] = true;
        else if (t === "no") answers[q.id] = false;
        else need();
        break;
      }
      case "single-choice": {
        const other = textOf(draft[otherKey(q.id)]);
        const pick = other !== "" && q.allowOther === true ? other : textOf(draft[q.id]);
        if (pick === "") need();
        else if (!optionValues.has(pick) && q.allowOther !== true) errors[q.id] = "Pick one of the options.";
        else answers[q.id] = pick;
        break;
      }
      case "multi-choice": {
        const other = q.allowOther === true ? textOf(draft[otherKey(q.id)]) : "";
        const picked = [...listOf(draft[q.id]).filter((v) => optionValues.has(v)), ...(other !== "" ? [other] : [])];
        if (picked.length === 0) {
          need();
          break;
        }
        if (q.min !== undefined && picked.length < q.min) errors[q.id] = `Pick at least ${q.min}.`;
        else if (q.max !== undefined && picked.length > q.max) errors[q.id] = `Pick at most ${q.max}.`;
        else answers[q.id] = picked;
        break;
      }
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, answers };
}

/** The label to show for an option value (the value itself when it is free text). */
export function optionLabel(q: StructuredQuestion, value: string): string {
  return q.options?.find((o) => o.value === value)?.label ?? value;
}
