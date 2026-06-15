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
    ).rejects.toThrow(/Structured output failed/);
  });

  it("native path: contract.validate() runs on completeStructured result (Fix 1 — success path)", async () => {
    // TestLLMServiceLayer has nativeJsonMode=true and completeStructured that
    // JSON.parse()s the text turn and Schema.decodeUnknownSync()s it.
    // The `{ json: ... }` turn variant returns the value directly.
    const contract = toSchemaContract(Schema.Struct({ answer: Schema.String }));
    const llm = TestLLMServiceLayer([{ json: { answer: "native-hi" } }]);
    const out = await Effect.runPromise(
      extractStructuredOutput({
        contract,
        prompt: "say hi",
        // No forcePromptMode — lets completeStructured() run (nativeJsonMode=true)
      }).pipe(Effect.provide(llm)),
    );
    // Must have come from native path and passed contract.validate()
    expect(out.nativeMode).toBe(true);
    expect(out.data).toEqual({ answer: "native-hi" });
  });

  it("native path: contract.validate() failure causes fallthrough to prompt path (Fix 1 — rejection path)", async () => {
    // First turn: completeStructured gets a bad payload (missing `answer`).
    // After contract.validate() rejects it, pipeline falls through to prompt path
    // which gets the second turn with a valid payload.
    const contract = toSchemaContract(Schema.Struct({ answer: Schema.String }));
    const llm = TestLLMServiceLayer([
      { json: { wrong: 123 } },          // native turn: fails contract validation
      { text: '{"answer":"repaired"}' },  // prompt fallback turn
    ]);
    const out = await Effect.runPromise(
      extractStructuredOutput({
        contract,
        prompt: "say hi",
        maxRetries: 1,
        // No forcePromptMode — native is attempted first
      }).pipe(Effect.provide(llm)),
    );
    // Must have fallen back to prompt path
    expect(out.nativeMode).toBe(false);
    expect(out.data).toEqual({ answer: "repaired" });
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
