/**
 * E2E test: `.withOutputSchema()` populates `result.object` from the agent's
 * final answer using the fast-path extraction helper (Task 1.4).
 *
 * Uses the deterministic test provider (TestLLMServiceLayer via
 * `.withTestScenario()`) so no real LLM calls are made.
 */
import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import { ReactiveAgents } from "../builder.js";

describe(".withOutputSchema() e2e", () => {
  it("populates result.object from agent final answer", async () => {
    // The test provider returns this text for every LLM call (complete +
    // completeStructured). The reactive kernel reads it as the answer on
    // iteration 1; the fast-path extraction then calls completeStructured()
    // which parses the JSON text and validates it against the schema contract.
    const agent = await ReactiveAgents.create()
      .withName("output-schema-e2e")
      .withProvider("test")
      .withTestScenario([{ text: '{"city":"Paris"}' }])
      .withReasoning({ maxIterations: 1, defaultStrategy: "reactive" })
      .withOutputSchema(Schema.Struct({ city: Schema.String }))
      .build();

    const r = await agent.run("name a city");
    await agent.dispose();

    // The extraction returns the parsed structured value.
    expect(r.object).toEqual({ city: "Paris" });
    expect(r.objectError).toBeUndefined();
  });

  it("populates objectError when extraction fails (degrade mode)", async () => {
    // "garbage" text: kernel outputs it as the final answer. Extraction then
    // tries to parse "garbage" as JSON — fails all retries → objectError set.
    const agent = await ReactiveAgents.create()
      .withName("output-schema-e2e-fail")
      .withProvider("test")
      .withTestScenario([{ text: "garbage" }])
      .withReasoning({ maxIterations: 1, defaultStrategy: "reactive" })
      .withOutputSchema(Schema.Struct({ city: Schema.String }), { onParseFail: "degrade" })
      .build();

    const r = await agent.run("name a city");
    await agent.dispose();

    expect(r.object).toBeUndefined();
    expect(r.objectError).toBeDefined();
  });
});
