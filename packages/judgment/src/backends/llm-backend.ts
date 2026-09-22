import { Effect, Schema } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { LLMErrors } from "@reactive-agents/llm-provider";
import {
  JudgmentBadResponse,
  JudgmentConnectionError,
  JudgmentRateLimited,
  JudgmentTimeout,
  type ChoiceSpec,
  type JudgmentAnswer,
  type JudgmentAnswers,
  type JudgmentBackend,
  type JudgmentEntry,
  type JudgmentError,
  type QuestionSpec,
  type QuestionSpecs,
  type ScoreSpec,
} from "../types.js";

/**
 * `JudgmentBackend` over RA's own `LLMService.completeStructured()` — the
 * emulation backend the primitive works on **without a TypeSafe key**, using
 * whichever LLM provider the agent already has configured. Probabilities are
 * present so consumers see one uniform `JudgmentAnswer` shape regardless of
 * backend, but they are the model's own self-reported estimate, not a
 * calibrated distribution — every answer this backend produces carries
 * `calibrated: false`, and consumers gating on calibration MUST check it.
 * Degrade order at a consumer becomes: `jev` → `llm` → existing heuristic.
 */

const entryToText = (entry: JudgmentEntry): string =>
  typeof entry === "string" ? entry : JSON.stringify(entry);

const describeQuestion = (id: string, spec: QuestionSpec): string => {
  const instructions = spec.instructions !== undefined ? entryToText(spec.instructions) : "(no instructions given)";
  switch (spec.type) {
    case "noul":
      return [
        `Question "${id}" (yes/no): ${instructions}`,
        spec.criteria?.true !== undefined ? `  Yes means: ${entryToText(spec.criteria.true)}` : "",
        spec.criteria?.false !== undefined ? `  No means: ${entryToText(spec.criteria.false)}` : "",
      ].filter(Boolean).join("\n");
    case "choice": {
      const options = Object.entries(spec.criteria)
        .map(([label, desc]) => `  - "${label}"${desc !== null && desc !== undefined ? `: ${entryToText(desc)}` : ""}`)
        .join("\n");
      return `Question "${id}" (pick exactly one option): ${instructions}\nOptions:\n${options}`;
    }
    case "score": {
      const levels = spec.criteria
        .map((desc, i) => `  ${i}: ${desc !== null && desc !== undefined ? entryToText(desc) : "(undescribed)"}`)
        .join("\n");
      return `Question "${id}" (score on this rubric, 0-indexed; may fall between levels): ${instructions}\nLevels:\n${levels}`;
    }
  }
};

const buildPrompt = (state: JudgmentEntry, questions: QuestionSpecs): string =>
  [
    "You are answering structured judgment questions about the following state:",
    entryToText(state),
    "",
    "Answer each question independently, based only on the state above.",
    ...Object.entries(questions).map(([id, spec]) => describeQuestion(id, spec)),
  ].join("\n\n");

/** One field's schema per question — a self-reported (uncalibrated) probability/confidence in [0,1]. */
const questionFieldSchema = (spec: QuestionSpec) => {
  switch (spec.type) {
    case "noul":
      return Schema.Struct({ probability: Schema.Number });
    case "choice":
      return Schema.Struct({ value: Schema.String, confidence: Schema.Number });
    case "score":
      return Schema.Struct({ value: Schema.Number, confidence: Schema.Number });
  }
};

const buildBatchSchema = (questions: QuestionSpecs): Schema.Schema<Record<string, unknown>> => {
  const fields: Record<string, ReturnType<typeof questionFieldSchema>> = {};
  for (const [id, spec] of Object.entries(questions)) {
    fields[id] = questionFieldSchema(spec);
  }
  return Schema.Struct(fields) as Schema.Schema<Record<string, unknown>>;
};

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

const toJudgmentAnswer = (id: string, spec: QuestionSpec, raw: unknown): JudgmentAnswer => {
  const record = raw as Record<string, unknown>;
  switch (spec.type) {
    case "noul":
      return { kind: "noul", probability: clamp01(Number(record.probability)) };
    case "choice": {
      const value = String(record.value);
      const choiceSpec = spec as ChoiceSpec;
      if (!(value in choiceSpec.criteria)) {
        throw new Error(`llm backend returned unknown choice "${value}" for question "${id}" — not one of: ${Object.keys(choiceSpec.criteria).join(", ")}`);
      }
      const confidence = clamp01(Number(record.confidence));
      // Uniform-remainder distribution: the LLM reports one confidence value,
      // not a full distribution, so probabilities is a best-effort spread
      // (kept internally consistent, clearly `calibrated: false`).
      const others = Object.keys(choiceSpec.criteria).filter((k) => k !== value);
      const remainder = others.length > 0 ? (1 - confidence) / others.length : 0;
      const probabilities: Record<string, number> = { [value]: confidence };
      for (const k of others) probabilities[k] = remainder;
      return { kind: "choice", value, probabilities, confidence, calibrated: false };
    }
    case "score": {
      const scoreSpec = spec as ScoreSpec;
      const maxIndex = scoreSpec.criteria.length - 1;
      const value = Math.max(0, Math.min(maxIndex, Number(record.value)));
      return { kind: "score", value, probabilities: {}, confidence: clamp01(Number(record.confidence)), calibrated: false };
    }
  }
};

const toJudgmentError = (cause: LLMErrors): JudgmentError => {
  switch (cause._tag) {
    case "LLMRateLimitError":
      return new JudgmentRateLimited({ message: cause.message, retryAfterMs: cause.retryAfterMs });
    case "LLMTimeoutError":
      return new JudgmentTimeout({ message: cause.message, timeoutMs: cause.timeoutMs });
    case "LLMParseError":
      return new JudgmentBadResponse({ message: `${cause.message}: ${cause.rawOutput.slice(0, 200)}` });
    case "LLMContextOverflowError":
      return new JudgmentBadResponse({ message: cause.message });
    case "LLMError":
      return new JudgmentConnectionError({ message: cause.message });
  }
};

/** `JudgmentBackend` over an injected `LLMService` — no vendor SDK, no TypeSafe key. */
export const makeLlmBackend = (llm: LLMService["Type"]): JudgmentBackend => ({
  name: "llm",
  evaluate: ({ state, questions, model }) => {
    const questionIds = Object.keys(questions);
    const schema = buildBatchSchema(questions);
    return llm
      .completeStructured({
        messages: [{ role: "user", content: buildPrompt(state, questions) }],
        outputSchema: schema,
        model,
        maxParseRetries: 1,
      })
      .pipe(
        Effect.mapError(toJudgmentError),
        Effect.flatMap((decoded) =>
          Effect.try({
            try: (): JudgmentAnswers =>
              Object.fromEntries(
                questionIds.map((id) => [id, toJudgmentAnswer(id, questions[id]!, decoded[id])] as const),
              ),
            catch: (cause) =>
              new JudgmentBadResponse({ message: cause instanceof Error ? cause.message : String(cause) }),
          }),
        ),
      );
  },
});
