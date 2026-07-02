import { describe, it, expect } from "bun:test";
import { hintFor, PRESENTATION, INTENTIONAL_DEFAULTS } from "./config-presentation.js";
import type { ConfigFieldDescriptor } from "./capabilities.js";

describe("config presentation", () => {
  it("falls back to a type-appropriate default widget for unknown fields", () => {
    const d: ConfigFieldDescriptor = { path: "brand.new.field", type: "boolean", optional: true };
    expect(hintFor(d).widget).toBe("toggle");
    expect(hintFor(d).group).toBe("More");
  });

  it("maps enum fields to a select by default", () => {
    const d: ConfigFieldDescriptor = { path: "x.y", type: "enum", enumValues: ["a", "b"], optional: true };
    expect(hintFor(d).widget).toBe("select");
  });

  it("maps array fields to tag-input by default", () => {
    const d: ConfigFieldDescriptor = { path: "x.tags", type: "array", optional: true };
    expect(hintFor(d).widget).toBe("tag-input");
  });

  it("uses an explicit hint when present", () => {
    const d: ConfigFieldDescriptor = { path: "temperature", type: "number", optional: false };
    expect(hintFor(d).widget).toBe(PRESENTATION["temperature"]!.widget);
    expect(hintFor(d).group).toBe("Model");
  });

  it("has no PRESENTATION key that also sits in INTENTIONAL_DEFAULTS (no contradiction)", () => {
    for (const k of INTENTIONAL_DEFAULTS) {
      expect(PRESENTATION[k], `${k} both hinted and defaulted`).toBeUndefined();
    }
  });

  it("carries the field description into help when defaulting", () => {
    const d: ConfigFieldDescriptor = { path: "x.z", type: "string", optional: true, description: "hello" };
    expect(hintFor(d).help).toBe("hello");
  });
});
