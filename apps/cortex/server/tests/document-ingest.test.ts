import { describe, expect, it } from "bun:test";
import { parseDocumentSpecs } from "../services/cortex-agent-config.js";

describe("parseDocumentSpecs", () => {
  it("round-trips path-based and inline specs, dropping unknown keys", () => {
    expect(
      parseDocumentSpecs([
        { source: "/docs/a.md", format: "markdown", chunkStrategy: "paragraph", maxChunkSize: 500, junk: 1 },
        { source: "notes", content: "hello" },
      ]),
    ).toEqual([
      { source: "/docs/a.md", format: "markdown", chunkStrategy: "paragraph", maxChunkSize: 500 },
      { source: "notes", content: "hello" },
    ]);
  });

  it("labels content-only docs 'inline' so chunks stay attributable", () => {
    expect(parseDocumentSpecs([{ content: "just text" }])).toEqual([{ source: "inline", content: "just text" }]);
  });

  it("drops entries with neither source nor content, and non-arrays", () => {
    expect(parseDocumentSpecs([{ format: "text" }, null, "x", { source: "" }])).toBeUndefined();
    expect(parseDocumentSpecs("nope")).toBeUndefined();
    expect(parseDocumentSpecs(undefined)).toBeUndefined();
  });
});
