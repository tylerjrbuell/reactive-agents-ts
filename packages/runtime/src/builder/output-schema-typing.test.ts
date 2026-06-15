/**
 * Type-level test: `.withOutputSchema<A>()` threads `A` so `result.object` is
 * typed `A | undefined`, not `unknown | undefined`.
 *
 * The `@ts-expect-error` annotations are the actual compile-time proof:
 * - If the carry works, property-access on `unknown` errors exactly where marked
 *   (the directive is satisfied, test file compiles, runtime passes).
 * - If the carry is broken (object still `unknown`), the marked line does NOT
 *   error and TS reports "Unused '@ts-expect-error' directive" — compile fails.
 */
import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import { ReactiveAgents } from "../builder.js";

describe("withOutputSchema typed-carry", () => {
  it("types result.object as the schema type", async () => {
    const agent = await ReactiveAgents.create()
      .withName("typed-carry-test")
      .withProvider("test")
      .withTestScenario([{ text: '{"city":"Paris"}' }])
      .withReasoning({ maxIterations: 1, defaultStrategy: "reactive" })
      .withOutputSchema(Schema.Struct({ city: Schema.String }))
      .build();

    const r = await agent.run("name a city");
    await agent.dispose();

    // Compile-time proof: assigning r.object to a typed variable must type-check.
    const city: string | undefined = r.object?.city;
    expect(typeof city === "string" || city === undefined).toBe(true);

    // @ts-expect-error — r.object.nonexistent must NOT type-check
    const _bad = r.object?.nonexistent;
    void _bad;
  });

  it("defaults object to unknown without withOutputSchema", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTestScenario([{ text: "hello" }])
      .withReasoning({ maxIterations: 1, defaultStrategy: "reactive" })
      .build();

    const r = await agent.run("x");
    await agent.dispose();

    // @ts-expect-error — object is unknown, property access must NOT type-check
    const _x = r.object?.anything;
    void _x;
  });
});
