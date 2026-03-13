import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { LLMService, TestLLMServiceLayer } from "../src/index.js";
import type { StructuredOutputCapabilities } from "../src/types.js";

describe("StructuredOutputCapabilities", () => {
  it("TestLLMService reports all capabilities as true", async () => {
    const layer = TestLLMServiceLayer();
    const caps = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.getStructuredOutputCapabilities();
      }).pipe(Effect.provide(layer)),
    );

    expect(caps.nativeJsonMode).toBe(true);
    expect(caps.jsonSchemaEnforcement).toBe(false);
    expect(caps.prefillSupport).toBe(false);
    expect(caps.grammarConstraints).toBe(false);
  });
});
