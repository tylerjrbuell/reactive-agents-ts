import { Either, Schema } from "effect";

// ─── Structured questions for `request_user_input` ─────────────────────────
//
// Pure, deterministic contract: the model sends a list of typed questions, the
// host collects answers keyed by question id, and `validateAnswers` turns them
// into a typed answer map or a list of per-question errors the model can fix.
// No LLM involved anywhere in this module.

/** The answer types a question can ask for. */
export const QUESTION_TYPES = ["text", "single-choice", "multi-choice", "boolean", "number"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** One selectable option of a choice question. */
export const QuestionOptionSchema = Schema.Struct({
  label: Schema.String,
  value: Schema.String,
  description: Schema.optional(Schema.String),
});
export type QuestionOption = typeof QuestionOptionSchema.Type;

/** One question in a structured request. */
export const QuestionSchema = Schema.Struct({
  id: Schema.String,
  prompt: Schema.String,
  type: Schema.Literal(...QUESTION_TYPES),
  /** Required for `single-choice` / `multi-choice`. */
  options: Schema.optional(Schema.Array(QuestionOptionSchema)),
  /** Default true. A non-required question may be skipped. */
  required: Schema.optional(Schema.Boolean),
  /** Value used when a non-required question is skipped. */
  default: Schema.optional(Schema.Unknown),
  /** number: inclusive bounds. multi-choice: bounds on how many options are picked. */
  min: Schema.optional(Schema.Number),
  max: Schema.optional(Schema.Number),
  /** text: longest accepted answer. */
  maxLength: Schema.optional(Schema.Number),
  /** Choice questions: also accept a free-text value that is not in `options`. */
  allowOther: Schema.optional(Schema.Boolean),
});
export type Question = typeof QuestionSchema.Type;

/** A structured request: the question list the host presents. */
export interface StructuredRequest {
  readonly questions: readonly Question[];
}

/** Per-question status in the result. */
export type AnswerStatus = "answered" | "skipped" | "timeout";
/** Overall status: all answered, some answered, none answered, or the wait timed out. */
export type OverallStatus = "answered" | "partial" | "skipped" | "timeout";

export interface QuestionAnswer {
  readonly status: AnswerStatus;
  /** string | number | boolean | string[]; absent when skipped with no default. */
  readonly value?: string | number | boolean | readonly string[];
  /** True when a choice answer is free text outside `options` (allowOther). */
  readonly other?: true;
}

/** The typed result the model reads. */
export interface StructuredAnswer {
  readonly status: OverallStatus;
  readonly answers: Readonly<Record<string, QuestionAnswer>>;
}

/** Why one answer was rejected. Every variant names the question id. */
export type AnswerError =
  | { readonly _tag: "UnknownQuestion"; readonly id: string; readonly message: string }
  | { readonly _tag: "RequiredMissing"; readonly id: string; readonly message: string }
  | { readonly _tag: "WrongType"; readonly id: string; readonly message: string }
  | { readonly _tag: "NotInOptions"; readonly id: string; readonly message: string }
  | { readonly _tag: "OutOfRange"; readonly id: string; readonly message: string }
  | { readonly _tag: "TooLong"; readonly id: string; readonly message: string };

// ─── Request parsing ───────────────────────────────────────────────────────

const decodeQuestions = Schema.decodeUnknownEither(Schema.Array(QuestionSchema));

/** Validate the question list itself (unique ids, options present for choices). */
function checkQuestions(questions: readonly Question[]): string | undefined {
  if (questions.length === 0) return "questions must not be empty";
  const seen = new Set<string>();
  for (const q of questions) {
    if (q.id.trim() === "") return "every question needs a non-empty id";
    if (seen.has(q.id)) return `duplicate question id '${q.id}'`;
    seen.add(q.id);
    const isChoice = q.type === "single-choice" || q.type === "multi-choice";
    if (isChoice && (q.options === undefined || q.options.length === 0)) {
      return `question '${q.id}' is ${q.type} and needs a non-empty options list`;
    }
    if (isChoice && new Set(q.options?.map((o) => o.value)).size !== q.options?.length) {
      return `question '${q.id}' has duplicate option values`;
    }
  }
  return undefined;
}

/**
 * Read the tool-call arguments into a {@link StructuredRequest}.
 *
 * - `questions` present: the structured form.
 * - Otherwise the legacy `{ kind, prompt, schema }` call is normalized:
 *   `form` -> one question per field, `choice` -> one single-choice,
 *   `confirmation` -> one boolean; an unknown kind or bare prompt -> one text.
 *
 * Returns a message the model can read when the structured form is malformed.
 */
export function parseRequest(args: unknown): Either.Either<StructuredRequest, string> {
  const a = (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>;
  if (a.questions !== undefined) {
    const decoded = decodeQuestions(a.questions);
    if (Either.isLeft(decoded)) {
      return Either.left(
        "invalid questions: each needs id, prompt and type (text | single-choice | multi-choice | boolean | number)",
      );
    }
    const problem = checkQuestions(decoded.right);
    return problem === undefined ? Either.right({ questions: decoded.right }) : Either.left(problem);
  }
  return Either.right(normalizeLegacy(a));
}

function normalizeLegacy(a: Record<string, unknown>): StructuredRequest {
  const prompt = typeof a.prompt === "string" ? a.prompt : "";
  const schema = (typeof a.schema === "object" && a.schema !== null ? a.schema : {}) as Record<string, unknown>;
  if (a.kind === "choice" && Array.isArray(schema.options)) {
    const options = schema.options.filter((o): o is string => typeof o === "string").map((o) => ({ label: o, value: o }));
    if (options.length > 0) return { questions: [{ id: "answer", prompt, type: "single-choice", options }] };
  }
  if (a.kind === "form" && Array.isArray(schema.fields)) {
    const fields = schema.fields.flatMap((f): Question[] => {
      if (typeof f !== "object" || f === null) return [];
      const field = f as Record<string, unknown>;
      if (typeof field.name !== "string") return [];
      const type: QuestionType = field.type === "number" || field.type === "boolean" ? field.type : "text";
      return [{
        id: field.name,
        prompt: typeof field.label === "string" ? field.label : field.name,
        type,
        required: field.required === true,
      }];
    });
    if (fields.length > 0) return { questions: fields };
  }
  if (a.kind === "confirmation") return { questions: [{ id: "answer", prompt, type: "boolean" }] };
  return { questions: [{ id: "answer", prompt, type: "text" }] };
}

// ─── Answer validation ─────────────────────────────────────────────────────

const isAbsent = (v: unknown): boolean => v === undefined || v === null || v === "";

/** Validate one present value against its question; returns the accepted answer or an error. */
function checkOne(q: Question, value: unknown): QuestionAnswer | AnswerError {
  const err = (_tag: AnswerError["_tag"], message: string): AnswerError => ({ _tag, id: q.id, message });
  switch (q.type) {
    case "text": {
      if (typeof value !== "string") return err("WrongType", `'${q.id}' must be text`);
      if (q.maxLength !== undefined && value.length > q.maxLength) {
        return err("TooLong", `'${q.id}' is ${value.length} characters; the limit is ${q.maxLength}`);
      }
      return { status: "answered", value };
    }
    case "boolean":
      return typeof value === "boolean"
        ? { status: "answered", value }
        : err("WrongType", `'${q.id}' must be true or false`);
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return err("WrongType", `'${q.id}' must be a number`);
      if ((q.min !== undefined && value < q.min) || (q.max !== undefined && value > q.max)) {
        return err("OutOfRange", `'${q.id}' must be between ${q.min ?? "-inf"} and ${q.max ?? "inf"}; got ${value}`);
      }
      return { status: "answered", value };
    }
    case "single-choice": {
      if (typeof value !== "string") return err("WrongType", `'${q.id}' must be one option value`);
      if (q.options?.some((o) => o.value === value)) return { status: "answered", value };
      return q.allowOther === true
        ? { status: "answered", value, other: true }
        : err("NotInOptions", `'${q.id}' must be one of: ${optionValues(q)}`);
    }
    case "multi-choice": {
      if (!Array.isArray(value) || !value.every((v): v is string => typeof v === "string")) {
        return err("WrongType", `'${q.id}' must be a list of option values`);
      }
      const picked: readonly string[] = value;
      const known = new Set(q.options?.map((o) => o.value));
      const outside = picked.filter((v) => !known.has(v));
      if (outside.length > 0 && q.allowOther !== true) {
        return err("NotInOptions", `'${q.id}' has values not in options (${outside.join(", ")}); allowed: ${optionValues(q)}`);
      }
      if ((q.min !== undefined && picked.length < q.min) || (q.max !== undefined && picked.length > q.max)) {
        return err("OutOfRange", `'${q.id}' needs between ${q.min ?? 0} and ${q.max ?? "all"} selections; got ${picked.length}`);
      }
      return outside.length > 0 ? { status: "answered", value: picked, other: true } : { status: "answered", value: picked };
    }
  }
}

const optionValues = (q: Question): string => (q.options ?? []).map((o) => o.value).join(", ");
const isAnswerError = (r: QuestionAnswer | AnswerError): r is AnswerError => "_tag" in r;

/**
 * Validate the host's answers (a map keyed by question id) against the request.
 * Right: the typed answer map. Left: every problem found, so the model can fix
 * them all in one retry. Absent answers to non-required questions are `skipped`
 * (carrying `default` when one exists).
 */
export function validateAnswers(
  request: StructuredRequest,
  answers: unknown,
): Either.Either<StructuredAnswer, readonly AnswerError[]> {
  const given = (typeof answers === "object" && answers !== null && !Array.isArray(answers)
    ? answers
    : {}) as Record<string, unknown>;
  const errors: AnswerError[] = [];
  const ids = new Set(request.questions.map((q) => q.id));
  for (const id of Object.keys(given)) {
    if (!ids.has(id)) errors.push({ _tag: "UnknownQuestion", id, message: `no question with id '${id}'` });
  }
  const out: Record<string, QuestionAnswer> = {};
  for (const q of request.questions) {
    const value = given[q.id];
    if (isAbsent(value)) {
      if (q.required !== false) {
        errors.push({ _tag: "RequiredMissing", id: q.id, message: `'${q.id}' is required` });
      } else {
        out[q.id] = q.default === undefined
          ? { status: "skipped" }
          : { status: "skipped", value: q.default as QuestionAnswer["value"] };
      }
      continue;
    }
    const checked = checkOne(q, value);
    if (isAnswerError(checked)) errors.push(checked);
    else out[q.id] = checked;
  }
  if (errors.length > 0) return Either.left(errors);
  const answered = Object.values(out).filter((a) => a.status === "answered").length;
  const status: OverallStatus = answered === 0 ? "skipped" : answered === request.questions.length ? "answered" : "partial";
  return Either.right({ status, answers: out });
}

/** The result when the wait timed out: every question is `timeout`. */
export function timeoutAnswer(request: StructuredRequest): StructuredAnswer {
  return {
    status: "timeout",
    answers: Object.fromEntries(request.questions.map((q) => [q.id, { status: "timeout" } as QuestionAnswer])),
  };
}

/** Render errors as the tool-result text the model reads to recover. */
export function formatAnswerErrors(errors: readonly AnswerError[]): string {
  return `The answers were rejected: ${errors.map((e) => e.message).join("; ")}. Ask again with corrected questions or tell the user.`;
}
