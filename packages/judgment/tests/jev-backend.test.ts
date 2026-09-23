import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { makeJevBackend } from "../src/backends/jev-backend.js";
import {
  JudgmentBadResponse,
  JudgmentRateLimited,
  JudgmentUnauthorized,
  type QuestionSpecs,
} from "../src/types.js";

/**
 * `fetch` override is the SDK's own supported test seam
 * (`TypeSafeClientConfig.fetch`) — no bespoke transport wrapper, per Global
 * Constraints ("all tests offline via a fake transport injected at the SDK
 * boundary").
 */
const fakeFetch = (
  handler: (input: string, init?: RequestInit) => Response,
): { fetch: (input: string, init?: RequestInit) => Promise<Response>; calls: RequestInit[] } => {
  const calls: RequestInit[] = [];
  return {
    calls,
    fetch: async (input, init) => {
      calls.push(init ?? {});
      return handler(input, init);
    },
  };
};

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const SUCCESS_BODY = {
  model: "jev-latest",
  usage: { input_tokens: 42, output_tokens: 0 },
  answers: {
    relevance: { type: "score", score: 1.9, confidence: 0.92, legend: {}, probabilities: {} },
    onTopic: { type: "noul", noul: 0.88 },
    category: {
      type: "choice",
      choice: "billing",
      confidence: 0.95,
      probabilities: { billing: 0.95, technical: 0.05 },
    },
  },
};

const QUESTIONS: QuestionSpecs = {
  relevance: { type: "score", instructions: "Rate relevance", criteria: ["off", "partial", "full"] },
  onTopic: { type: "noul", instructions: "Is this on-topic?" },
  category: { type: "choice", instructions: "Category", criteria: { billing: null, technical: null } },
};

describe("makeJevBackend", () => {
  it("evaluates a mixed choice+score+noul batch in ONE HTTP call", async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(200, SUCCESS_BODY));
    const backend = makeJevBackend({ apiKey: "test-key", fetch, retry: { maxRetries: 0 } });

    const answers = await Effect.runPromise(
      backend.evaluate({ state: { input: "I was charged twice" }, questions: QUESTIONS }),
    );

    expect(calls).toHaveLength(1);
    expect(answers.relevance).toEqual({
      kind: "score",
      value: 1.9,
      probabilities: {},
      confidence: 0.92,
      calibrated: true,
    });
    expect(answers.onTopic).toEqual({ kind: "noul", probability: 0.88 });
    expect(answers.category.kind).toBe("choice");
  });

  it("serializes state and forwards a model override in the request body", async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(200, SUCCESS_BODY));
    const backend = makeJevBackend({ apiKey: "test-key", fetch, retry: { maxRetries: 0 } });

    await Effect.runPromise(
      backend.evaluate({ state: { input: "hi" }, questions: QUESTIONS, model: "jev-mini" }),
    );

    const body = JSON.parse(calls[0]?.body as string);
    expect(body.state).toEqual({ input: "hi" });
    expect(body.model).toBe("jev-mini");
  });

  it("maps 401 to JudgmentUnauthorized without retrying", async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(401, { message: "bad key" }));
    const backend = makeJevBackend({ apiKey: "bad", fetch, retry: { maxRetries: 2 } });

    const error = await Effect.runPromise(
      backend.evaluate({ state: "x", questions: QUESTIONS }).pipe(Effect.flip),
    );

    expect(error).toBeInstanceOf(JudgmentUnauthorized);
    expect(calls).toHaveLength(1); // 401 is not in the SDK's default retryable status set
  });

  it("maps 429 to JudgmentRateLimited", async () => {
    const { fetch } = fakeFetch(() => jsonResponse(429, { message: "slow down" }));
    const backend = makeJevBackend({ apiKey: "test-key", fetch, retry: { maxRetries: 0 } });

    const error = await Effect.runPromise(
      backend.evaluate({ state: "x", questions: QUESTIONS }).pipe(Effect.flip),
    );

    expect(error).toBeInstanceOf(JudgmentRateLimited);
  });

  it("never partial-trusts a malformed 2xx response — maps to JudgmentBadResponse", async () => {
    const { fetch } = fakeFetch(() =>
      jsonResponse(200, { model: "jev-latest", usage: { input_tokens: 1, output_tokens: 0 }, answers: {} }),
    );
    const backend = makeJevBackend({ apiKey: "test-key", fetch, retry: { maxRetries: 0 } });

    const error = await Effect.runPromise(
      backend.evaluate({ state: "x", questions: QUESTIONS }).pipe(Effect.flip),
    );

    expect(error).toBeInstanceOf(JudgmentBadResponse);
  });

  it("never attaches the API key to the emitted answers", async () => {
    const { fetch } = fakeFetch(() => jsonResponse(200, SUCCESS_BODY));
    const backend = makeJevBackend({ apiKey: "super-secret-key", fetch, retry: { maxRetries: 0 } });

    const answers = await Effect.runPromise(
      backend.evaluate({ state: "x", questions: QUESTIONS }),
    );

    expect(JSON.stringify(answers)).not.toContain("super-secret-key");
  });

  it("listModels() calls GET /v1/models and translates snake_case ModelCards", async () => {
    const { fetch, calls } = fakeFetch((input) => {
      expect(input).toContain("/v1/models");
      return jsonResponse(200, {
        models: [
          { name: "jev-latest", description: "Most recent stable release.", release_date: "2026-01-01" },
          { name: "jev-preview", description: "Most recent release, preview or not.", release_date: "2026-01-01" },
        ],
      });
    });
    const backend = makeJevBackend({ apiKey: "test-key", fetch, retry: { maxRetries: 0 } });

    const models = await Effect.runPromise(backend.listModels!());

    expect(calls).toHaveLength(1);
    expect(models).toEqual([
      { name: "jev-latest", description: "Most recent stable release.", releaseDate: "2026-01-01" },
      { name: "jev-preview", description: "Most recent release, preview or not.", releaseDate: "2026-01-01" },
    ]);
  });

  it("listModels() maps a 401 to JudgmentUnauthorized like evaluate() does", async () => {
    const { fetch } = fakeFetch(() => jsonResponse(401, { message: "bad key" }));
    const backend = makeJevBackend({ apiKey: "bad", fetch, retry: { maxRetries: 0 } });

    const error = await Effect.runPromise(backend.listModels!().pipe(Effect.flip));

    expect(error).toBeInstanceOf(JudgmentUnauthorized);
  });
});
