import { describe, it, expect } from "bun:test";
import { groundFields } from "./field-provenance.js";

describe("groundFields", () => {
  it("attaches provenance when a field value appears in the corpus", () => {
    const corpus = "tool crypto-price returned BTC=64000 USD";
    const r = groundFields({ price: 64000, name: "unseen" }, corpus);
    expect(r.provenance.price).toBeDefined();
    expect(r.provenance.name).toBeUndefined();
    expect(r.confidence.price).toBeGreaterThan(r.confidence.name);
  });
  it("skips null/undefined field values", () => {
    const r = groundFields({ a: null, b: undefined }, "anything");
    expect(Object.keys(r.confidence)).toEqual([]);
  });
});
