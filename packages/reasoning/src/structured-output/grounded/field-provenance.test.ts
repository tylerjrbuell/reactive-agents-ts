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

  it("does not ground a word-like value embedded inside a larger token", () => {
    // "cat" appears only inside "concatenate" — a coincidental substring, not
    // real evidence. Word-boundary matching must reject it.
    const r = groundFields({ code: "cat" }, "the word concatenate appears here");
    expect(r.provenance.code).toBeUndefined();
    expect(r.confidence.code).toBe(0.4);
  });

  it("still grounds a word-like value at a token boundary", () => {
    const r = groundFields({ animal: "cat" }, "we saw a cat today");
    expect(r.provenance.animal).toBeDefined();
    expect(r.confidence.animal).toBe(0.9);
  });

  it("grounds nested object and array leaf values by dotted path", () => {
    const corpus = "ticker BTC price 64000 exchange Coinbase";
    const r = groundFields(
      { meta: { ticker: "BTC" }, sources: ["Coinbase", "unseen-src"] },
      corpus,
    );
    expect(r.provenance["meta.ticker"]).toBeDefined();
    expect(r.confidence["meta.ticker"]).toBe(0.9);
    expect(r.provenance["sources.0"]).toBeDefined();
    expect(r.confidence["sources.1"]).toBe(0.4); // "unseen-src" absent
  });
});
