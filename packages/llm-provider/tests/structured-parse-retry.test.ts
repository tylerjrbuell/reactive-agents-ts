import { describe, it, expect } from "bun:test";
import { Effect, FiberRef, Schema } from "effect";
import { runStructuredParseWithRetry, StructuredUsageRef } from "../src/structured-parse-retry.js";
import { LLMParseError } from "../src/errors.js";

const OutputSchema = Schema.Struct({ answer: Schema.String });

const usage = {
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
  estimatedCost: 0,
};

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
          return Effect.succeed({
            content: JSON.stringify({ answer: "ok" }),
            usage,
          });
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
            ? Effect.succeed({ content: "not json", usage })
            : Effect.succeed({
                content: JSON.stringify({ answer: "recovered" }),
                usage,
              });
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
            ? Effect.succeed({ content: JSON.stringify({ wrongField: 1 }), usage })
            : Effect.succeed({
                content: JSON.stringify({ answer: "ok" }),
                usage,
              }),
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
          runAttempt: () =>
            Effect.succeed({ content: "still not json", usage }),
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

// Per-attempt reports (H3 instrument gap 1, 2026-11-06): the kernel records
// `attempts` on the structured exchange only if the provider reports them on
// the StructuredUsageRef value. These pin that the retry loop builds one
// report per attempt, on every exit path, as a fresh object per call.
describe("runStructuredParseWithRetry — per-attempt reports on StructuredUsageRef", () => {
  const attemptUsage = (input: number, output: number) => ({
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
    estimatedCost: 0,
  });

  it("reports one attempt per native call on success, with stop reason and thinking size", async () => {
    const ref = await Effect.runPromise(
      Effect.gen(function* () {
        yield* runStructuredParseWithRetry({
          outputSchema: OutputSchema,
          schemaStr: "{}",
          maxRetries: 2,
          runAttempt: ({ attempt }) =>
            attempt === 0
              ? Effect.succeed({ content: "not json", usage: attemptUsage(10, 900), stopReason: "max_tokens", thinkingChars: 3600 })
              : Effect.succeed({ content: JSON.stringify({ answer: "ok" }), usage: attemptUsage(20, 40), stopReason: "end_turn" }),
        });
        return yield* FiberRef.get(StructuredUsageRef);
      }),
    );

    expect(ref?.totalTokens).toBe(970);
    expect(ref?.attempts).toEqual([
      { attempt: 0, parsed: false, inputTokens: 10, outputTokens: 900, stopReason: "max_tokens", thinkingChars: 3600 },
      { attempt: 1, parsed: true, inputTokens: 20, outputTokens: 40, stopReason: "end_turn" },
    ]);
  });

  it("reports every attempt when the call ends in a parse failure", async () => {
    const ref = await Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.either(
          runStructuredParseWithRetry({
            outputSchema: OutputSchema,
            schemaStr: "{}",
            maxRetries: 2,
            runAttempt: () => Effect.succeed({ content: "nope", usage: attemptUsage(5, 7), stopReason: "length" }),
          }),
        );
        return yield* FiberRef.get(StructuredUsageRef);
      }),
    );

    expect(ref?.totalTokens).toBe(36);
    expect(ref?.attempts?.map((a) => [a.attempt, a.parsed, a.stopReason])).toEqual([
      [0, false, "length"],
      [1, false, "length"],
      [2, false, "length"],
    ]);
  });

  it("keeps the completed attempts when a later attempt's provider call fails", async () => {
    class FakeProviderError {
      readonly _tag = "FakeProviderError";
    }
    const ref = await Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.either(
          runStructuredParseWithRetry({
            outputSchema: OutputSchema,
            schemaStr: "{}",
            maxRetries: 2,
            runAttempt: ({ attempt }) =>
              attempt === 0
                ? Effect.succeed({ content: "nope", usage: attemptUsage(8, 600) })
                : Effect.fail(new FakeProviderError()),
          }),
        );
        return yield* FiberRef.get(StructuredUsageRef);
      }),
    );

    expect(ref?.totalTokens).toBe(608);
    expect(ref?.attempts).toEqual([{ attempt: 0, parsed: false, inputTokens: 8, outputTokens: 600 }]);
  });

  it("leaves the ref untouched when the first provider call fails (nothing ran)", async () => {
    class FakeProviderError {
      readonly _tag = "FakeProviderError";
    }
    const ref = await Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.either(
          runStructuredParseWithRetry({
            outputSchema: OutputSchema,
            schemaStr: "{}",
            maxRetries: 2,
            runAttempt: () => Effect.fail(new FakeProviderError()),
          }),
        );
        return yield* FiberRef.get(StructuredUsageRef);
      }),
    );

    expect(ref).toBeNull();
  });

  it("sets a fresh usage object per call (no shared attempts array)", async () => {
    const [first, second] = await Effect.runPromise(
      Effect.gen(function* () {
        const call = runStructuredParseWithRetry({
          outputSchema: OutputSchema,
          schemaStr: "{}",
          maxRetries: 0,
          runAttempt: () => Effect.succeed({ content: JSON.stringify({ answer: "ok" }), usage: attemptUsage(1, 2) }),
        });
        yield* call;
        const a = yield* FiberRef.get(StructuredUsageRef);
        yield* call;
        const b = yield* FiberRef.get(StructuredUsageRef);
        return [a, b] as const;
      }),
    );

    expect(first).not.toBe(second);
    expect(first?.attempts).not.toBe(second?.attempts);
    expect(first?.attempts).toHaveLength(1);
    expect(second?.attempts).toHaveLength(1);
  });
});
