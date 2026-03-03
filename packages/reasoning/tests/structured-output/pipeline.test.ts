import { describe, it, expect } from "bun:test";
import { Effect, Schema } from "effect";
import { extractStructuredOutput } from "../../src/structured-output/pipeline.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

const TestSchema = Schema.Struct({
  name: Schema.String,
  count: Schema.Number,
});

describe("extractStructuredOutput", () => {
  it("extracts valid JSON on first attempt", async () => {
    const layer = TestLLMServiceLayer({
      "Extract": '{"name": "test", "count": 42}',
    });

    const result = await Effect.runPromise(
      extractStructuredOutput({
        schema: TestSchema,
        prompt: "Extract the data",
        maxRetries: 0,
      }).pipe(Effect.provide(layer)),
    );

    expect(result.data.name).toBe("test");
    expect(result.data.count).toBe(42);
    expect(result.attempts).toBe(1);
    expect(result.repaired).toBe(false);
  });

  it("repairs JSON with markdown fences", async () => {
    const layer = TestLLMServiceLayer({
      "Extract": '```json\n{"name": "fixed", "count": 7}\n```',
    });

    const result = await Effect.runPromise(
      extractStructuredOutput({
        schema: TestSchema,
        prompt: "Extract the data",
        maxRetries: 0,
      }).pipe(Effect.provide(layer)),
    );

    expect(result.data.name).toBe("fixed");
    expect(result.repaired).toBe(true);
  });

  it("repairs trailing commas", async () => {
    const layer = TestLLMServiceLayer({
      "Extract": '{"name": "comma", "count": 3,}',
    });

    const result = await Effect.runPromise(
      extractStructuredOutput({
        schema: TestSchema,
        prompt: "Extract the data",
        maxRetries: 0,
      }).pipe(Effect.provide(layer)),
    );

    expect(result.data.name).toBe("comma");
    expect(result.repaired).toBe(true);
  });

  it("retries with error feedback on schema validation failure", async () => {
    // First call returns wrong shape, retry prompt contains error feedback
    // Note: "previous response" pattern must come first because the retry prompt
    // also contains "Extract the data" (in "Original request:"), and TestLLMServiceLayer
    // checks patterns in insertion order, returning the first match.
    const layer = TestLLMServiceLayer({
      "previous response was not valid": '{"name": "retried", "count": 99}',
      "Extract the data": '{"wrong": "shape"}',
    });

    const result = await Effect.runPromise(
      extractStructuredOutput({
        schema: TestSchema,
        prompt: "Extract the data",
        maxRetries: 1,
      }).pipe(Effect.provide(layer)),
    );

    expect(result.data.name).toBe("retried");
    expect(result.attempts).toBe(2);
  });

  it("uses custom system prompt", async () => {
    const layer = TestLLMServiceLayer({
      "planning agent": '{"name": "planned", "count": 1}',
    });

    const result = await Effect.runPromise(
      extractStructuredOutput({
        schema: TestSchema,
        prompt: "Generate plan",
        systemPrompt: "You are a planning agent",
        maxRetries: 0,
      }).pipe(Effect.provide(layer)),
    );

    expect(result.data.name).toBe("planned");
  });

  it("includes few-shot examples in prompt", async () => {
    const layer = TestLLMServiceLayer({
      "Example": '{"name": "with-example", "count": 5}',
    });

    const result = await Effect.runPromise(
      extractStructuredOutput({
        schema: TestSchema,
        prompt: "Extract data",
        examples: [{ name: "Example item", count: 10 }],
        maxRetries: 0,
      }).pipe(Effect.provide(layer)),
    );

    expect(result.data.name).toBe("with-example");
  });
});
