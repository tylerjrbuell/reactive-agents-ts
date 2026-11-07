/**
 * `.withOutputSchema(schema, { onParseFail: "throw" })`: a parse failure must
 * reject `run()` with the parse error, not Effect's empty-message fallback
 * ("An error has occurred"). `StructuredOutputError` carried no `message`, so
 * every boundary that renders `.message` showed the generic text.
 */
import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { ReactiveAgents } from "../src";
import { StructuredOutputError } from "../src/errors/structured-output-error";

describe("onParseFail: throw surfaces the parse error", () => {
  test("StructuredOutputError has a message naming the issues", () => {
    const e = new StructuredOutputError({ rawText: "nope", issues: ["city: expected string"] });
    expect(e.message).toContain("city: expected string");
    expect(e._tag).toBe("StructuredOutputError");
  });

  test("run() rejects with the parse error, not the generic fallback", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([{ text: "FINAL ANSWER: I could not find a city." }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withMaxIterations(2)
      .withOutputSchema(Schema.Struct({ city: Schema.String }), { onParseFail: "throw" })
      .build();
    let caught: unknown;
    try {
      await agent.run("Which city?");
    } catch (e) {
      caught = e;
    } finally {
      await agent.dispose();
    }
    expect(caught).toBeDefined();
    const message = caught !== null && typeof caught === "object" && "message" in caught ? String(caught.message) : String(caught);
    expect(message).not.toContain("An error has occurred");
    expect(message).toContain("Structured output did not match the schema");
    expect(message).not.toContain("Unexpected error");
    expect(message).toContain('onParseFail: "degrade"');
  }, 20_000);
});
