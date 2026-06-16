import { describe, it, expect } from "bun:test";
import { Effect, Schema } from "effect";
import { toSchemaContract } from "@reactive-agents/reasoning";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { extractObjectFromAnswer } from "./extract-object.js";

describe("extractObjectFromAnswer", () => {
  const contract = toSchemaContract(Schema.Struct({ city: Schema.String }));

  it("returns typed object on success (native JSON path)", async () => {
    // TestLLMServiceLayer has nativeJsonMode=true; completeStructured() returns
    // the json turn directly without JSON.parse, satisfying the contract.
    const llm = TestLLMServiceLayer([{ json: { city: "Paris" } }]);
    const r = await Effect.runPromise(
      extractObjectFromAnswer({
        contract,
        finalAnswer: "The city is Paris",
        onParseFail: "degrade",
      }).pipe(Effect.provide(llm)),
    );
    expect(r.object).toEqual({ city: "Paris" });
    expect(r.objectError).toBeUndefined();
  });

  it("degrades on failure (onParseFail: degrade)", async () => {
    // "garbage" text: native completeStructured JSON.parse throws (caught+nulled),
    // then prompt path complete() returns "garbage" — JSON extraction fails all retries.
    const llm = TestLLMServiceLayer([{ text: "garbage" }]);
    const r = await Effect.runPromise(
      extractObjectFromAnswer({
        contract,
        finalAnswer: "garbage",
        onParseFail: "degrade",
        // maxRetries is not exposed here; extractStructuredOutput defaults to 2
        // but that's fine — all retries will fail on "garbage"
      }).pipe(Effect.provide(llm)),
    );
    expect(r.object).toBeUndefined();
    expect(r.objectError).toBeDefined();
  });

  it("fails with StructuredOutputError when onParseFail is throw", async () => {
    const llm = TestLLMServiceLayer([{ text: "garbage" }]);
    // Use Effect.flip so the typed error becomes the success channel — avoids
    // FiberFailure wrapping that Effect.runPromise applies to failures.
    const err = await Effect.runPromise(
      extractObjectFromAnswer({
        contract,
        finalAnswer: "garbage",
        onParseFail: "throw",
      }).pipe(
        Effect.flip,
        Effect.provide(llm),
      ),
    );
    expect(err._tag).toBe("StructuredOutputError");
    expect(err.rawText).toBe("garbage");
  });
});
