import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import { ReactiveAgentBuilder } from "../builder.js";

describe(".withOutputSchema", () => {
  it("stores the schema contract + options on the builder", () => {
    const b = new ReactiveAgentBuilder().withOutputSchema(
      Schema.Struct({ x: Schema.Number }),
      { mode: "fast" },
    );
    // @ts-expect-error — reading private for the test
    expect(b._outputSchemaConfig).toBeDefined();
    // @ts-expect-error
    expect(b._outputSchemaConfig.options.mode).toBe("fast");
    // @ts-expect-error
    expect(typeof b._outputSchemaConfig.contract.validate).toBe("function");
  });
  it("defaults options to {} when omitted", () => {
    const b = new ReactiveAgentBuilder().withOutputSchema(Schema.Struct({ x: Schema.Number }));
    // @ts-expect-error
    expect(b._outputSchemaConfig.options).toEqual({});
  });
});
