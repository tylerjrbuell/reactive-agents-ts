import { describe, it, expect } from "bun:test";
import { Effect, Schema } from "effect";
import { extractStructuredOutput } from "./pipeline.js";
import { toSchemaContract } from "./schema-contract.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

describe("extractStructuredOutput — contract overload", () => {
  it("extracts using a SchemaContract (prompt-mode fallback)", async () => {
    const contract = toSchemaContract(Schema.Struct({ answer: Schema.String }));
    // forcePromptMode so complete() is called and returns our fixed JSON text
    const llm = TestLLMServiceLayer([{ text: '{"answer":"hi"}' }]);
    const out = await Effect.runPromise(
      extractStructuredOutput({
        contract,
        prompt: "say hi",
        forcePromptMode: true,
      }).pipe(Effect.provide(llm)),
    );
    expect(out.data).toEqual({ answer: "hi" });
    expect(out.nativeMode).toBe(false);
  });

  it("contract validation rejects non-conforming output", async () => {
    const contract = toSchemaContract(Schema.Struct({ answer: Schema.String }));
    // Returns JSON missing the `answer` field — should fail all retries
    const llm = TestLLMServiceLayer([{ text: '{"wrong":123}' }]);
    await expect(
      Effect.runPromise(
        extractStructuredOutput({
          contract,
          prompt: "say hi",
          forcePromptMode: true,
          maxRetries: 0,
        }).pipe(Effect.provide(llm)),
      ),
    ).rejects.toThrow();
  });

  it("falls back to schema when contract is absent (existing callers unchanged)", async () => {
    const schema = Schema.Struct({ answer: Schema.String });
    const llm = TestLLMServiceLayer([{ text: '{"answer":"ok"}' }]);
    const out = await Effect.runPromise(
      extractStructuredOutput({
        schema,
        prompt: "say ok",
        forcePromptMode: true,
      }).pipe(Effect.provide(llm)),
    );
    expect(out.data).toEqual({ answer: "ok" });
  });
});
