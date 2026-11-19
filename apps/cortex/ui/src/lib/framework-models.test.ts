import { describe, expect, it } from "bun:test";
import { mapFrameworkBody, modelSelectOption, UNCONFIRMED_MODELS_GROUP } from "./framework-models.js";

describe("mapFrameworkBody", () => {
  it("carries each row's listedBy through to the option", () => {
    const options = mapFrameworkBody({
      models: [
        { name: "grok-4", label: "Grok 4", listedBy: "static" },
        { name: "grok-3-mini", label: "grok-3-mini", listedBy: "price-book" },
        { name: "plain", label: "plain" },
      ],
    });
    expect(options.map((o) => o.listedBy)).toEqual(["static", "price-book", undefined]);
    expect("listedBy" in (options[2] ?? {})).toBe(false);
  });
});

describe("modelSelectOption", () => {
  it("puts PriceBook-only rows in the not-confirmed section and leaves the rest ungrouped", () => {
    expect(modelSelectOption({ value: "grok-3-mini", label: "grok-3-mini", listedBy: "price-book" }).group).toBe(
      UNCONFIRMED_MODELS_GROUP,
    );
    expect(modelSelectOption({ value: "grok-4", label: "Grok 4", listedBy: "static" }).group).toBeUndefined();
    expect(modelSelectOption({ value: "gpt-4o", label: "GPT-4o", listedBy: "live" }).group).toBeUndefined();
  });

  it("labels the option like the dropdown text", () => {
    expect(modelSelectOption({ value: "m", label: "M" }).label).toBe("M · price unknown");
  });
});
