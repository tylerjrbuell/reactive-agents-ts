import { describe, it, expect } from "bun:test";
import { Effect, Schema } from "effect";
import { TestLLMServiceLayer, LLMService } from "@reactive-agents/llm-provider";
import type { TestTurn } from "@reactive-agents/llm-provider";

const makeRequest = (content: string) => ({
  messages: [{ role: "user" as const, content }],
  model: "test-model",
  maxTokens: 1000,
});

async function callComplete(scenario: TestTurn[], input: string) {
  const layer = TestLLMServiceLayer(scenario);
  return Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      return yield* llm.complete(makeRequest(input));
    }).pipe(Effect.provide(layer)),
  );
}

describe("TestLLMServiceLayer — turn resolution", () => {
  it("single text turn returns text with stopReason end_turn", async () => {
    const result = await callComplete([{ text: "hello world" }], "any input");
    expect(result.content).toBe("hello world");
    expect(result.stopReason).toBe("end_turn");
    expect(result.toolCalls).toBeUndefined();
  });

  it("toolCall turn returns stopReason tool_use with toolCalls populated", async () => {
    const result = await callComplete(
      [{ toolCall: { name: "web-search", args: { query: "test" } } }],
      "any input",
    );
    expect(result.stopReason).toBe("tool_use");
    expect(result.content).toBe("");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("web-search");
    expect(result.toolCalls![0].input).toEqual({ query: "test" });
  });

  it("toolCalls turn returns multiple tool calls", async () => {
    const result = await callComplete(
      [
        {
          toolCalls: [
            { name: "web-search", args: { query: "a" } },
            { name: "calculator", args: { expr: "1+1" } },
          ],
        },
      ],
      "any input",
    );
    expect(result.stopReason).toBe("tool_use");
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls![0].name).toBe("web-search");
    expect(result.toolCalls![1].name).toBe("calculator");
  });

  it("turns are consumed sequentially across multiple calls", async () => {
    const layer = TestLLMServiceLayer([
      { text: "first" },
      { text: "second" },
      { text: "third" },
    ]);
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const r1 = yield* llm.complete(makeRequest("a"));
        const r2 = yield* llm.complete(makeRequest("b"));
        const r3 = yield* llm.complete(makeRequest("c"));
        return [r1.content, r2.content, r3.content];
      }).pipe(Effect.provide(layer)),
    );
    expect(results).toEqual(["first", "second", "third"]);
  });

  it("last turn repeats when scenario is exhausted", async () => {
    const layer = TestLLMServiceLayer([{ text: "only" }]);
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const r1 = yield* llm.complete(makeRequest("a"));
        const r2 = yield* llm.complete(makeRequest("b"));
        const r3 = yield* llm.complete(makeRequest("c"));
        return [r1.content, r2.content, r3.content];
      }).pipe(Effect.provide(layer)),
    );
    expect(results).toEqual(["only", "only", "only"]);
  });

  it("match guard skips non-matching turns and hits fallback", async () => {
    const layer = TestLLMServiceLayer([
      { match: "search", text: "search result" },
      { text: "fallback" },
    ]);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete(makeRequest("summarize this"));
      }).pipe(Effect.provide(layer)),
    );
    expect(result.content).toBe("fallback");
  });

  it("match guard consumes matching turn", async () => {
    const layer = TestLLMServiceLayer([
      { match: "search", text: "search result" },
      { text: "fallback" },
    ]);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete(makeRequest("please search for news"));
      }).pipe(Effect.provide(layer)),
    );
    expect(result.content).toBe("search result");
  });

  it("tool call id is auto-generated when not specified", async () => {
    const result = await callComplete(
      [{ toolCall: { name: "calculator", args: {} } }],
      "any",
    );
    expect(result.toolCalls![0].id).toMatch(/^call-/);
  });

  it("tool call id uses provided value", async () => {
    const result = await callComplete(
      [{ toolCall: { name: "calculator", args: {}, id: "my-custom-id" } }],
      "any",
    );
    expect(result.toolCalls![0].id).toBe("my-custom-id");
  });

  it("error turn throws", async () => {
    let threw = false;
    try {
      await callComplete([{ error: "rate_limit_exceeded" }], "any");
    } catch (e) {
      threw = true;
      expect((e as Error).message).toContain("rate_limit_exceeded");
    }
    expect(threw).toBe(true);
  });

  it("json turn returns stringified content from complete()", async () => {
    const result = await callComplete(
      [{ json: { plan: ["step1", "step2"] } }],
      "any",
    );
    expect(result.stopReason).toBe("end_turn");
    expect(JSON.parse(result.content)).toEqual({ plan: ["step1", "step2"] });
  });

  it("json turn returns value directly from completeStructured()", async () => {
    const layer = TestLLMServiceLayer([{ json: { answer: 42 } }]);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.completeStructured({
          ...makeRequest("any"),
          outputSchema: Schema.Unknown,
        } as any);
      }).pipe(Effect.provide(layer)),
    );
    expect(result).toEqual({ answer: 42 });
  });
});
