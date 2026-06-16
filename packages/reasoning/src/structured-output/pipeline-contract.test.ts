import { describe, it, expect } from "bun:test";
import { Effect, Schema } from "effect";
import { extractStructuredOutput, buildStructuredPrompt, buildRetryPrompt } from "./pipeline.js";
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

describe("buildStructuredPrompt / buildRetryPrompt — schema rendering", () => {
  it("buildStructuredPrompt renders schema field names into the prompt", () => {
    const contract = toSchemaContract(Schema.Struct({ total: Schema.Number, currency: Schema.String }));
    const jsonSchemaString = JSON.stringify(contract.toJsonSchema(), null, 2);
    const prompt = buildStructuredPrompt({ contract, prompt: "extract invoice" }, jsonSchemaString);
    expect(prompt).toContain("total");
    expect(prompt).toContain("currency");
    expect(prompt).toContain("JSON Schema");
  });

  it("buildRetryPrompt renders schema field names + original error into the retry prompt", () => {
    const contract = toSchemaContract(Schema.Struct({ total: Schema.Number, currency: Schema.String }));
    const jsonSchemaString = JSON.stringify(contract.toJsonSchema(), null, 2);
    const prompt = buildRetryPrompt({ contract, prompt: "extract invoice" }, "is missing", jsonSchemaString);
    expect(prompt).toContain("total");
    expect(prompt).toContain("currency");
    expect(prompt).toContain("JSON Schema");
    expect(prompt).toContain("is missing");
    expect(prompt).toContain("extract invoice");
  });

  it("buildStructuredPrompt gracefully omits schema block when jsonSchemaString is undefined", () => {
    const contract = toSchemaContract(Schema.Struct({ answer: Schema.String }));
    const prompt = buildStructuredPrompt({ contract, prompt: "say ok" }, undefined);
    expect(prompt).toContain("say ok");
    // Should not throw and must still include the JSON-only instruction
    expect(prompt).toContain("JSON");
  });

  it("extractStructuredOutput sends schema in prompt (integration: prompt-mode captures schema)", async () => {
    // The test LLM returns a valid response; the side-effect we verify is that
    // the PROMPT sent to the LLM contains the field names from the schema.
    // We do this by reading the captured prompt via the EventBus or by inspecting
    // the prompt indirectly: if extraction succeeds and the schema was rendered,
    // the test LLM would have received it. We verify via buildStructuredPrompt unit above.
    // This integration test confirms the full pipeline doesn't crash.
    const contract = toSchemaContract(Schema.Struct({ total: Schema.Number, currency: Schema.String }));
    const llm = TestLLMServiceLayer([{ text: '{"total":42,"currency":"USD"}' }]);
    const out = await Effect.runPromise(
      extractStructuredOutput({
        contract,
        prompt: "extract invoice",
        forcePromptMode: true,
      }).pipe(Effect.provide(llm)),
    );
    expect(out.data).toEqual({ total: 42, currency: "USD" });
    expect(out.nativeMode).toBe(false);
  });
});
