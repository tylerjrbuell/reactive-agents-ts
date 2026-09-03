import { describe, it, expect } from "bun:test";
import { Effect, Schema } from "effect";
import { runStructuredParseWithRetry } from "../src/structured-parse-retry.js";
import { LLMParseError } from "../src/errors.js";

const OutputSchema = Schema.Struct({ answer: Schema.String });

describe("runStructuredParseWithRetry", () => {
  it("returns the decoded value on a first-attempt success", async () => {
    let attempts = 0;
    const result = await Effect.runPromise(
      runStructuredParseWithRetry({
        outputSchema: OutputSchema,
        schemaStr: "{}",
        maxRetries: 2,
        runAttempt: () => {
          attempts++;
          return Effect.succeed(JSON.stringify({ answer: "ok" }));
        },
      }),
    );

    expect(result).toEqual({ answer: "ok" });
    expect(attempts).toBe(1);
  });

  it("retries on invalid JSON, threading lastError into the next attempt", async () => {
    const seenLastErrors: unknown[] = [];
    const result = await Effect.runPromise(
      runStructuredParseWithRetry({
        outputSchema: OutputSchema,
        schemaStr: "{}",
        maxRetries: 2,
        runAttempt: ({ attempt, lastError }) => {
          seenLastErrors.push(lastError);
          return attempt === 0
            ? Effect.succeed("not json")
            : Effect.succeed(JSON.stringify({ answer: "recovered" }));
        },
      }),
    );

    expect(result).toEqual({ answer: "recovered" });
    expect(seenLastErrors).toHaveLength(2);
    expect(seenLastErrors[0]).toBeNull();
    expect(seenLastErrors[1]).not.toBeNull();
  });

  it("retries on schema-decode failure, not just JSON.parse failure", async () => {
    const result = await Effect.runPromise(
      runStructuredParseWithRetry({
        outputSchema: OutputSchema,
        schemaStr: "{}",
        maxRetries: 1,
        runAttempt: ({ attempt }) =>
          attempt === 0
            ? Effect.succeed(JSON.stringify({ wrongField: 1 }))
            : Effect.succeed(JSON.stringify({ answer: "ok" })),
      }),
    );

    expect(result).toEqual({ answer: "ok" });
  });

  it("fails with LLMParseError carrying every attempt after exhausting retries", async () => {
    const outcome = await Effect.runPromise(
      Effect.either(
        runStructuredParseWithRetry({
          outputSchema: OutputSchema,
          schemaStr: "{}",
          maxRetries: 2,
          runAttempt: () => Effect.succeed("still not json"),
        }),
      ),
    );

    expect(outcome._tag).toBe("Left");
    if (outcome._tag === "Left") {
      expect(outcome.left).toBeInstanceOf(LLMParseError);
      expect(outcome.left.attempts).toHaveLength(3); // maxRetries=2 -> 3 attempts (0,1,2)
      expect(outcome.left.message).toContain("3 attempts");
    }
  });

  it("propagates a runAttempt failure (e.g. provider error) without retrying it as a parse failure", async () => {
    class FakeProviderError {
      readonly _tag = "FakeProviderError";
    }
    let attempts = 0;
    const outcome = await Effect.runPromise(
      Effect.either(
        runStructuredParseWithRetry({
          outputSchema: OutputSchema,
          schemaStr: "{}",
          maxRetries: 2,
          runAttempt: () => {
            attempts++;
            return Effect.fail(new FakeProviderError());
          },
        }),
      ),
    );

    expect(outcome._tag).toBe("Left");
    if (outcome._tag === "Left") {
      expect(outcome.left).toBeInstanceOf(FakeProviderError);
    }
    // A provider-level failure short-circuits the whole Effect.gen — it does
    // not get caught by the loop's JSON.parse try/catch, so only 1 attempt runs.
    expect(attempts).toBe(1);
  });
});
