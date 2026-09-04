import { describe, it, expect } from "bun:test";
import { toFts5Query } from "../src/fts5-query.js";

describe("toFts5Query", () => {
  it("quotes each term as an FTS5 string literal, OR-joined", () => {
    expect(toFts5Query("hello world example")).toBe('"hello" OR "world" OR "example"');
  });

  it("strips leading/trailing punctuation from a term", () => {
    expect(toFts5Query("Effect-TS.")).toBe('"Effect-TS"');
  });

  it("drops terms shorter than minTermLength (default 4)", () => {
    expect(toFts5Query("a to the food")).toBe('"food"');
  });

  it("caps at maxTerms (default 10)", () => {
    const words = Array.from({ length: 15 }, (_, i) => `word${i}`).join(" ");
    const result = toFts5Query(words);
    expect(result.split(" OR ")).toHaveLength(10);
  });

  it("doubles an embedded double-quote inside a term per FTS5 escaping", () => {
    // A quote in the middle of a word (not stripped as leading/trailing
    // punctuation) must be doubled, not passed through raw.
    expect(toFts5Query('so-called"word')).toBe('"so-called""word"');
  });

  it("returns empty string for punctuation-only input", () => {
    expect(toFts5Query("-- :: ---")).toBe("");
  });

  it("never produces a raw hyphen/colon that could be parsed as FTS5 syntax", () => {
    // The regression this exists for: "Effect-TS" fed unquoted into MATCH
    // threw `SQLiteError: no such column: TS`.
    const result = toFts5Query("Effect-TS Context.Tag async/await");
    for (const term of result.split(" OR ")) {
      expect(term.startsWith('"')).toBe(true);
      expect(term.endsWith('"')).toBe(true);
    }
  });
});
