// Direct-import pin for the `find` document-lookup seam
// (packages/tools/src/skills/document-lookup.ts).
import { describe, it, expect } from "bun:test";
import type { DocumentChunk } from "../../src/rag/types.js";
import {
  compactDocumentNames,
  documentOutline,
  focusExcerpt,
  matchDocumentsByName,
  nameOnlyHint,
  searchByDocumentName,
} from "../../src/skills/document-lookup.js";

const chunk = (source: string, chunkIndex: number, content: string): DocumentChunk => ({
  content,
  metadata: { source, format: "markdown", chunkIndex, totalChunks: 2 },
});

describe("document-lookup seam", () => {
  it("compactDocumentNames: basename, else the shortest unique path suffix", () => {
    const names = compactDocumentNames([
      "/home/u/apps/cortex/README.md",
      "/home/u/packages/tools/README.md",
      "/home/u/notes.txt",
      "C:\\work\\guide.md",
    ]);
    expect([...names.values()]).toEqual(["cortex/README.md", "tools/README.md", "notes.txt", "guide.md"]);
  });

  it("compactDocumentNames: an identifier that is a suffix of another keeps its full form", () => {
    const names = compactDocumentNames(["README.md", "docs/README.md"]);
    expect(names.get("README.md")).toBe("README.md");
    expect(names.get("docs/README.md")).toBe("docs/README.md");
  });

  it("matchDocumentsByName: content terms drop name tokens and filler words", () => {
    const store = new Map([["/x/apps/cortex/README.md", [chunk("/x/apps/cortex/README.md", 0, "body")]]]);
    expect(matchDocumentsByName(store, "the Cortex README document").contentTerms).toEqual([]);
    expect(matchDocumentsByName(store, "Cortex README server port").contentTerms).toEqual(["server", "port"]);
    expect(matchDocumentsByName(store, "server port")).toEqual({ ids: [], contentTerms: ["server", "port"] });
  });

  it("searchByDocumentName: ranks the named document's chunks by content terms, not by its name", () => {
    const id = "guide.md";
    const store = new Map([[id, [
      chunk(id, 0, "guide guide guide guide guide intro"),
      chunk(id, 1, "The port setting is PORT=80 in this long section about networking options."),
    ]]]);
    const hits = searchByDocumentName(store, matchDocumentsByName(store, "guide port"), 5);
    expect(hits[0]!.chunkIndex).toBe(1);
  });

  it("documentOutline: headings outside code fences, deduplicated, capped", () => {
    const id = "a.md";
    const chunks = [
      chunk(id, 0, "# Title\n\n## Setup\n\n```bash\n# not a heading\n```"),
      chunk(id, 1, "## Setup\n\n## Usage"),
    ];
    expect(documentOutline(chunks)).toEqual(["# Title", "## Setup", "## Usage"]);
    expect(documentOutline(chunks, 2)).toEqual(["# Title", "## Setup"]);
  });

  it("nameOnlyHint: one document vs several; example from the second heading", () => {
    expect(nameOnlyHint(["README.md"], ["# Cortex", "## Environment"])).toBe(
      "Matched document 'README.md' by name. Its outline is listed. Search its content with the words of the fact you need, not the document's name, e.g. find('Environment').",
    );
    expect(nameOnlyHint(["a.txt", "b.txt"], ["plain first line"])).toBe(
      "Matched documents 'a.txt', 'b.txt' by name. Their outlines are listed. Search their content with the words of the fact you need, not the document's name.",
    );
  });

  it("focusExcerpt: the window with the most distinct terms, prefixed with an ellipsis", () => {
    const content = `${"intro line about nothing\n".repeat(10)}## Environment\n| PORT | 4321 | listen port |\n`;
    const excerpt = focusExcerpt(content, ["environment", "port"], 60);
    expect(excerpt).toStartWith("…## Environment\n| PORT | 4321");
    expect(focusExcerpt("short", ["port"], 60)).toBe("short");
    expect(focusExcerpt(content, [], 10)).toBe("intro line");
  });
});
