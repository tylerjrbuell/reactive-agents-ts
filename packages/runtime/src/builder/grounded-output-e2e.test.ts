/**
 * E2E test: `.withOutputSchema()` with `mode: "grounded"` runs the grounded
 * extraction engine — populates `object`, `provenance`, and `confidence` on
 * the result (Task 2.5).
 *
 * Uses the deterministic test provider (TestLLMServiceLayer via
 * `.withTestScenario()`) so no real LLM calls are made.
 */
import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import { ReactiveAgents } from "../builder.js";

describe(".withOutputSchema grounded e2e", () => {
  it("populates object + provenance/confidence under mode:grounded", async () => {
    // The test provider returns this JSON text as the final answer.
    // groundedExtract runs Phase A (extract from text), then grounds fields
    // against the evidence corpus (which is thin here — no tool steps —
    // so provenance will be empty but confidence should be populated).
    const agent = await ReactiveAgents.create()
      .withName("grounded-output-e2e")
      .withProvider("test")
      .withTestScenario([
        { text: '{"city":"Paris"}' },
        { text: '{"city":"Paris"}' }, // repair pass if needed
      ])
      .withReasoning({ maxIterations: 1, defaultStrategy: "reactive" })
      .withOutputSchema(Schema.Struct({ city: Schema.String }), {
        mode: "grounded",
      })
      .build();

    const r = await agent.run("name a city");
    await agent.dispose();

    // Object must be extracted correctly.
    expect(r.object).toEqual({ city: "Paris" });
    expect(r.objectError).toBeUndefined();

    // Grounded path populates confidence (even with thin corpus — each field
    // gets a confidence score from groundFields).
    expect(r.confidence).toBeDefined();
    // provenance may be empty Record when corpus has no matching evidence,
    // but the field itself should exist on the grounded path.
    expect(r.provenance).toBeDefined();
  });

  it("fast path still works (mode not set → auto/fast)", async () => {
    const agent = await ReactiveAgents.create()
      .withName("grounded-output-e2e-fast")
      .withProvider("test")
      .withTestScenario([{ text: '{"city":"Berlin"}' }])
      .withReasoning({ maxIterations: 1, defaultStrategy: "reactive" })
      .withOutputSchema(Schema.Struct({ city: Schema.String }))
      .build();

    const r = await agent.run("name a city");
    await agent.dispose();

    expect(r.object).toEqual({ city: "Berlin" });
    expect(r.objectError).toBeUndefined();
    // Fast path does NOT populate provenance/confidence.
    expect(r.provenance).toBeUndefined();
    expect(r.confidence).toBeUndefined();
  });

  it("degrades (objectError set) when grounded extraction fails", async () => {
    // "garbage" triggers extraction failure in Phase A → objectError set
    const agent = await ReactiveAgents.create()
      .withName("grounded-output-e2e-fail")
      .withProvider("test")
      .withTestScenario([
        { text: "garbage" },
        { text: "garbage" }, // repair pass also fails
      ])
      .withReasoning({ maxIterations: 1, defaultStrategy: "reactive" })
      .withOutputSchema(Schema.Struct({ city: Schema.String }), {
        mode: "grounded",
        onParseFail: "degrade",
      })
      .build();

    const r = await agent.run("name a city");
    await agent.dispose();

    expect(r.object).toBeUndefined();
    expect(r.objectError).toBeDefined();
  });
});
