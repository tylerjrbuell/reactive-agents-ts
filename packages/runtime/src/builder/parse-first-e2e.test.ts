/**
 * E2E test: parse-first optimization in `.withOutputSchema().run()`.
 *
 * When the agent's answer already contains valid JSON matching the schema
 * (because the steering instruction steered it to emit JSON), `run()` must
 * extract `result.object` WITHOUT making an additional LLM extraction call.
 *
 * Proof strategy: the test scenario has exactly 1 useful turn (the agent's
 * JSON answer). A second "poison" error turn is appended. If parse-first
 * works, the poison turn is never reached and `result.object` is set
 * correctly. If parse-first falls through to `extractObjectFromAnswer`,
 * the test provider would consume the poison turn and throw, so the test
 * would fail — proving parse-first is the active path.
 */
import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import { ReactiveAgents } from "../builder.js";

describe("parse-first optimization in run() with .withOutputSchema()", () => {
  it("extracts object without an extra LLM call when answer is already valid JSON (fast path)", async () => {
    // Scenario: 1 real turn + 1 poison error turn.
    // The kernel's react-loop consumes turn 1 ('{"city":"Paris"}') as the final answer.
    // Parse-first validates it against the schema and short-circuits.
    // Turn 2 (poison) must NOT be consumed — if it is, the extraction throws and the
    // test fails, proving the optimization is absent.
    const agent = await ReactiveAgents.create()
      .withName("parse-first-fast-e2e")
      .withProvider("test")
      .withTestScenario([
        { text: '{"city":"Paris"}' },
        { error: "POISON: parse-first optimization not working — extra LLM extraction was made" },
      ])
      .withReasoning({ maxIterations: 1, defaultStrategy: "reactive" })
      .withOutputSchema(Schema.Struct({ city: Schema.String }))
      .build();

    const r = await agent.run("name a city");
    await agent.dispose();

    expect(r.object).toEqual({ city: "Paris" });
    expect(r.objectError).toBeUndefined();
  });

  it("extracts object array without an extra LLM call (array schema, fast path)", async () => {
    const CityList = Schema.Array(Schema.Struct({ city: Schema.String }));
    const agent = await ReactiveAgents.create()
      .withName("parse-first-array-e2e")
      .withProvider("test")
      .withTestScenario([
        { text: '[{"city":"Paris"},{"city":"Rome"}]' },
        { error: "POISON: parse-first array optimization not working" },
      ])
      .withReasoning({ maxIterations: 1, defaultStrategy: "reactive" })
      .withOutputSchema(CityList)
      .build();

    const r = await agent.run("name two cities");
    await agent.dispose();

    expect(r.object).toEqual([{ city: "Paris" }, { city: "Rome" }]);
    expect(r.objectError).toBeUndefined();
  });

  it("falls back to LLM extraction when agent answer is not valid JSON (degrade mode)", async () => {
    // When the agent answers with prose, parse-first fails and the fallback
    // LLM extraction path runs. Both turns are consumed: turn 1 = prose answer,
    // turn 2 = the extraction completeStructured call returns valid JSON.
    // We use mode:"fast" to force the extraction path (not grounded).
    const agent = await ReactiveAgents.create()
      .withName("parse-first-fallback-e2e")
      .withProvider("test")
      .withTestScenario([
        { text: "The city is Paris." },    // prose answer — parse-first will fail
        { text: '{"city":"Paris"}' },       // extraction LLM call picks this up
      ])
      .withReasoning({ maxIterations: 1, defaultStrategy: "reactive" })
      .withOutputSchema(Schema.Struct({ city: Schema.String }), {
        mode: "fast",
        onParseFail: "degrade",
      })
      .build();

    const r = await agent.run("name a city");
    await agent.dispose();

    // Falls back to extractObjectFromAnswer — object is still populated.
    expect(r.object).toEqual({ city: "Paris" });
    expect(r.objectError).toBeUndefined();
  });

  it("parse-first on grounded path computes provenance without LLM call (grounded mode)", async () => {
    // Grounded mode: parse-first should validate the JSON, then run groundFields
    // (pure, no LLM). The poison turn must NOT be consumed.
    const agent = await ReactiveAgents.create()
      .withName("parse-first-grounded-e2e")
      .withProvider("test")
      .withTestScenario([
        { text: '{"city":"Paris"}' },
        { error: "POISON: parse-first grounded optimization not working" },
      ])
      .withReasoning({ maxIterations: 1, defaultStrategy: "reactive" })
      .withOutputSchema(Schema.Struct({ city: Schema.String }), {
        mode: "grounded",
      })
      .build();

    const r = await agent.run("name a city");
    await agent.dispose();

    expect(r.object).toEqual({ city: "Paris" });
    expect(r.objectError).toBeUndefined();
    // Grounded path populates confidence even on parse-first success.
    expect(r.confidence).toBeDefined();
    expect(r.provenance).toBeDefined();
  });
});
