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
    const layer = TestLLMServiceLayer([
      { match: "Extract", text: '{"name": "test", "count": 42}' },
    ]);

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
    const layer = TestLLMServiceLayer([
      { match: "Extract", text: '```json\n{"name": "fixed", "count": 7}\n```' },
    ]);

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
    const layer = TestLLMServiceLayer([
      { match: "Extract", text: '{"name": "comma", "count": 3,}' },
    ]);

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
    const layer = TestLLMServiceLayer([
      { text: '{"wrong": "shape"}' },
      { text: '{"wrong": "shape"}' },
      { text: '{"name": "retried", "count": 99}' },
    ]);

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
    const layer = TestLLMServiceLayer([
      { match: "planning agent", text: '{"name": "planned", "count": 1}' },
    ]);

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

  it("strips <think> blocks before JSON extraction", async () => {
    const layer = TestLLMServiceLayer([
      { match: "Extract", text: '<think>\nLet me think about this...\nThe name should be "thought" and count 99.\n</think>\n{"name": "thought", "count": 99}' },
    ]);

    const result = await Effect.runPromise(
      extractStructuredOutput({
        schema: TestSchema,
        prompt: "Extract the data",
        maxRetries: 0,
      }).pipe(Effect.provide(layer)),
    );

    expect(result.data.name).toBe("thought");
    expect(result.data.count).toBe(99);
    expect(result.attempts).toBe(1);
  });

  it("strips <think> blocks that contain JSON-like content", async () => {
    const layer = TestLLMServiceLayer([
      { match: "Extract", text: '<think>\nI could return {"name": "wrong", "count": 0} but let me reconsider.\n</think>\n{"name": "correct", "count": 42}' },
    ]);

    const result = await Effect.runPromise(
      extractStructuredOutput({
        schema: TestSchema,
        prompt: "Extract the data",
        maxRetries: 0,
      }).pipe(Effect.provide(layer)),
    );

    expect(result.data.name).toBe("correct");
    expect(result.data.count).toBe(42);
  });

  it("includes few-shot examples in prompt", async () => {
    const layer = TestLLMServiceLayer([
      { match: "Example", text: '{"name": "with-example", "count": 5}' },
    ]);

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

  it("sets nativeMode true when provider supports structured output", async () => {
    // TestLLMService reports nativeJsonMode: true, so if completeStructured succeeds
    // the result should have nativeMode: true
    const layer = TestLLMServiceLayer([
      { match: "Extract", text: '{"name": "native", "count": 1}' },
    ]);

    const result = await Effect.runPromise(
      extractStructuredOutput({
        schema: TestSchema,
        prompt: "Extract the data",
        maxRetries: 0,
      }).pipe(Effect.provide(layer)),
    );

    expect(result.nativeMode).toBe(true);
    expect(result.data.name).toBe("native");
    expect(result.attempts).toBe(1);
    expect(result.repaired).toBe(false);
  });

  it("falls back to prompt mode when forcePromptMode is set", async () => {
    const layer = TestLLMServiceLayer([
      { match: "Extract", text: '{"name": "prompt-mode", "count": 2}' },
    ]);

    const result = await Effect.runPromise(
      extractStructuredOutput({
        schema: TestSchema,
        prompt: "Extract the data",
        maxRetries: 0,
        forcePromptMode: true,
      }).pipe(Effect.provide(layer)),
    );

    expect(result.nativeMode).toBe(false);
    expect(result.data.name).toBe("prompt-mode");
  });

  // ── Real provider usage crosses the pipeline boundary (2026-07-11) ──
  //
  // Empirical origin: blueprint run 01KX998PS2X3NW7JTAKBJMWPGN reported
  // tokensUsed 6,370 while the trace held 18,448 real tokens — the pipeline
  // discarded response.usage on every attempt, so callers could only estimate.
  it("accumulates real provider usage across prompt-mode attempts", async () => {
    // forcePromptMode skips the native completeStructured turn, so exactly two
    // turns are consumed: attempt 1 (wrong shape) + attempt 2 (valid).
    const layer = TestLLMServiceLayer([
      { text: '{"wrong": "shape"}' },
      { text: '{"name": "usage", "count": 1}' },
    ]);

    const result = await Effect.runPromise(
      extractStructuredOutput({
        schema: TestSchema,
        prompt: "Extract the data",
        maxRetries: 1,
        forcePromptMode: true,
      }).pipe(Effect.provide(layer)),
    );

    expect(result.attempts).toBe(2);
    // Both attempts' provider usage summed — not zero, not an estimate.
    expect(result.usage.totalTokens).toBeGreaterThan(0);
    expect(result.usage.totalTokens).toBe(
      result.usage.inputTokens + result.usage.outputTokens,
    );
  });

  it("native path reports zero usage (documented completeStructured gap)", async () => {
    const layer = TestLLMServiceLayer([
      { match: "Extract", text: '{"name": "native", "count": 1}' },
    ]);
    const result = await Effect.runPromise(
      extractStructuredOutput({
        schema: TestSchema,
        prompt: "Extract the data",
        maxRetries: 0,
      }).pipe(Effect.provide(layer)),
    );
    expect(result.nativeMode).toBe(true);
    expect(result.usage.totalTokens).toBe(0);
  });

  it("falls back to prompt mode when native structured output fails", async () => {
    // Give a response that completeStructured will fail on (markdown fences),
    // but prompt-mode extraction can repair
    const layer = TestLLMServiceLayer([
      { match: "Extract", text: '```json\n{"name": "repaired-fallback", "count": 3}\n```' },
    ]);

    const result = await Effect.runPromise(
      extractStructuredOutput({
        schema: TestSchema,
        prompt: "Extract the data",
        maxRetries: 0,
      }).pipe(Effect.provide(layer)),
    );

    // Native mode failed (JSON.parse of markdown fences), fell back to prompt repair
    expect(result.nativeMode).toBe(false);
    expect(result.data.name).toBe("repaired-fallback");
    expect(result.repaired).toBe(true);
  });
});
