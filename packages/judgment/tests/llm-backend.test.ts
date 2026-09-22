import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { LLMError, LLMParseError, LLMRateLimitError, LLMTimeoutError } from "@reactive-agents/llm-provider";
import type { LLMService, StructuredCompletionRequest } from "@reactive-agents/llm-provider";
import { makeLlmBackend } from "../src/backends/llm-backend.js";
import {
  JudgmentBadResponse,
  JudgmentConnectionError,
  JudgmentRateLimited,
  JudgmentTimeout,
  type QuestionSpecs,
} from "../src/types.js";

const QUESTIONS: QuestionSpecs = {
  onTopic: { type: "noul", instructions: "Is this on-topic?" },
  category: {
    type: "choice",
    instructions: "Pick a category",
    criteria: { billing: null, technical: null, other: null },
  },
  relevance: { type: "score", instructions: "Rate relevance", criteria: ["off", "partial", "full"] },
};

/** Minimal fake — only `completeStructured` is exercised by this backend. */
const fakeLlm = (
  respond: <A>(request: StructuredCompletionRequest<A>) => Effect.Effect<A, never>,
): LLMService["Type"] =>
  ({
    completeStructured: respond,
  }) as unknown as LLMService["Type"];

describe("makeLlmBackend", () => {
  it("maps a schema-valid structured reply to typed answers, all calibrated:false", async () => {
    const llm = fakeLlm((_req) =>
      Effect.succeed({
        onTopic: { probability: 0.8 },
        category: { value: "billing", confidence: 0.7 },
        relevance: { value: 1.9, confidence: 0.6 },
      } as never),
    );
    const backend = makeLlmBackend(llm);

    const answers = await Effect.runPromise(
      backend.evaluate({ state: "I was charged twice", questions: QUESTIONS }),
    );

    expect(answers.onTopic).toEqual({ kind: "noul", probability: 0.8 });
    expect(answers.category).toMatchObject({ kind: "choice", value: "billing", calibrated: false });
    expect(answers.relevance).toMatchObject({ kind: "score", value: 1.9, calibrated: false });
    // Every answer carries calibrated:false (Noul has no calibration field at all — probability-only).
    expect((answers.category as { calibrated: boolean }).calibrated).toBe(false);
    expect((answers.relevance as { calibrated: boolean }).calibrated).toBe(false);
  });

  it("produces the SAME answer shape as the jev backend (backend-agnostic to consumers)", async () => {
    const llm = fakeLlm((_req) =>
      Effect.succeed({ onTopic: { probability: 0.5 } } as never),
    );
    const backend = makeLlmBackend(llm);

    const answers = await Effect.runPromise(
      backend.evaluate({ state: "x", questions: { onTopic: QUESTIONS.onTopic! } }),
    );

    expect(answers.onTopic).toHaveProperty("kind", "noul");
    expect(answers.onTopic).toHaveProperty("probability");
    expect(Object.keys(answers.onTopic)).toEqual(["kind", "probability"]);
  });

  it("never fabricates an answer for an unknown choice value — maps to JudgmentBadResponse", async () => {
    const llm = fakeLlm((_req) =>
      Effect.succeed({
        onTopic: { probability: 0.5 },
        category: { value: "not-a-real-category", confidence: 0.9 },
        relevance: { value: 1, confidence: 0.5 },
      } as never),
    );
    const backend = makeLlmBackend(llm);

    const error = await Effect.runPromise(
      backend.evaluate({ state: "x", questions: QUESTIONS }).pipe(Effect.flip),
    );

    expect(error).toBeInstanceOf(JudgmentBadResponse);
  });

  it("maps LLMErrors to the same JudgmentError taxonomy as the jev backend", async () => {
    const cases: [ReturnType<typeof fakeLlm>, unknown][] = [
      [
        fakeLlm(() => Effect.fail(new LLMRateLimitError({ message: "slow down", provider: "anthropic", retryAfterMs: 500 }))),
        JudgmentRateLimited,
      ],
      [
        fakeLlm(() => Effect.fail(new LLMTimeoutError({ message: "too slow", provider: "anthropic", timeoutMs: 3000 }))),
        JudgmentTimeout,
      ],
      [
        fakeLlm(() => Effect.fail(new LLMParseError({ message: "bad json", rawOutput: "{", expectedSchema: "Batch" }))),
        JudgmentBadResponse,
      ],
      [
        fakeLlm(() => Effect.fail(new LLMError({ message: "boom", provider: "anthropic" }))),
        JudgmentConnectionError,
      ],
    ];

    for (const [llm, ExpectedError] of cases) {
      const backend = makeLlmBackend(llm);
      const error = await Effect.runPromise(
        backend.evaluate({ state: "x", questions: { onTopic: QUESTIONS.onTopic! } }).pipe(Effect.flip),
      );
      expect(error).toBeInstanceOf(ExpectedError as new (...args: never[]) => unknown);
    }
  });
});
