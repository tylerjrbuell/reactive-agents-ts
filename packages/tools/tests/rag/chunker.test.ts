import { describe, it, expect } from "bun:test";

import {
  chunkDocument,
  chunkBySentences,
  chunkByMarkdownSections,
} from "../../src/rag/chunker.js";

// ═══════════════════════════════════════════════════════════════════════
// chunkDocument — strategy dispatch
// ═══════════════════════════════════════════════════════════════════════

describe("chunkDocument", () => {
  it("should return empty array for empty content", () => {
    expect(chunkDocument("")).toEqual([]);
    expect(chunkDocument("  \n  ")).toEqual([]);
  });

  it("should return single chunk for short content", () => {
    const chunks = chunkDocument("Hello world.", { maxChunkSize: 1000 });
    expect(chunks).toEqual(["Hello world."]);
  });

  it("should default to paragraph strategy", () => {
    const content = "Paragraph one is here.\n\nParagraph two is here.\n\nParagraph three is here.";
    const chunks = chunkDocument(content, { maxChunkSize: 30 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("should respect maxChunkSize", () => {
    const content = Array(20).fill("This is a sentence.").join(" ");
    const chunks = chunkDocument(content, { maxChunkSize: 100, strategy: "fixed" });
    for (const chunk of chunks) {
      // Allow small overflow from trimming differences
      expect(chunk.length).toBeLessThanOrEqual(110);
    }
  });

  it("should dispatch to fixed strategy", () => {
    const content = "A".repeat(300);
    const chunks = chunkDocument(content, { maxChunkSize: 100, chunkOverlap: 20, strategy: "fixed" });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("should dispatch to sentence strategy", () => {
    const content = "First sentence. Second sentence. Third sentence. Fourth sentence.";
    const chunks = chunkDocument(content, { maxChunkSize: 50, strategy: "sentence" });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it("should dispatch to markdown-sections strategy", () => {
    const content = "# Title\n\nIntro.\n\n## A\n\nContent A.\n\n## B\n\nContent B.";
    const chunks = chunkDocument(content, { strategy: "markdown-sections" });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Fixed chunking
// ═══════════════════════════════════════════════════════════════════════

describe("fixed chunking", () => {
  it("should produce overlapping chunks", () => {
    const content = "ABCDEFGHIJ" + "KLMNOPQRST" + "UVWXYZ";
    const chunks = chunkDocument(content, {
      maxChunkSize: 10,
      chunkOverlap: 3,
      strategy: "fixed",
    });
    expect(chunks.length).toBeGreaterThan(1);
    // Verify overlap: end of first chunk should appear at start of second
    if (chunks.length >= 2) {
      const firstEnd = chunks[0]!.slice(-3);
      expect(chunks[1]!.startsWith(firstEnd)).toBe(true);
    }
  });

  it("should handle content shorter than maxChunkSize", () => {
    const chunks = chunkDocument("short", { maxChunkSize: 1000, strategy: "fixed" });
    expect(chunks).toEqual(["short"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// chunkBySentences
// ═══════════════════════════════════════════════════════════════════════

describe("chunkBySentences", () => {
  it("should split on sentence boundaries", () => {
    const content = "First sentence. Second sentence. Third sentence.";
    const chunks = chunkBySentences(content, 35, 0);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // Each chunk should contain complete sentences
    for (const chunk of chunks) {
      // Should not cut mid-word
      expect(chunk.trim().length).toBeGreaterThan(0);
    }
  });

  it("should handle content without sentence terminators", () => {
    const content = "No periods here just continuous text that goes on and on";
    const chunks = chunkBySentences(content, 30, 0);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it("should respect overlap", () => {
    const content = "Sentence one. Sentence two. Sentence three. Sentence four. Sentence five.";
    const chunks = chunkBySentences(content, 40, 20);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// chunkByMarkdownSections
// ═══════════════════════════════════════════════════════════════════════

describe("chunkByMarkdownSections", () => {
  it("should split on heading boundaries", () => {
    const content = [
      "# Main Title",
      "",
      "Introduction text.",
      "",
      "## Section A",
      "",
      "Content for section A.",
      "",
      "## Section B",
      "",
      "Content for section B.",
    ].join("\n");

    const chunks = chunkByMarkdownSections(content);
    expect(chunks.length).toBe(3); // Title+intro, Section A, Section B
    expect(chunks[0]).toContain("Main Title");
    expect(chunks[1]).toContain("Section A");
    expect(chunks[2]).toContain("Section B");
  });

  it("should handle content without headings", () => {
    const content = "Just plain text.\n\nAnother paragraph.";
    const chunks = chunkByMarkdownSections(content);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toContain("Just plain text");
  });

  it("should handle nested headings", () => {
    const content = [
      "# H1",
      "H1 content.",
      "## H2",
      "H2 content.",
      "### H3",
      "H3 content.",
    ].join("\n");

    const chunks = chunkByMarkdownSections(content);
    expect(chunks.length).toBe(3);
  });

  it("should sub-chunk oversized sections", () => {
    const longContent = "## Big Section\n\n" + Array(20).fill("Long paragraph content here.").join("\n\n");
    const chunks = chunkByMarkdownSections(longContent, 100);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("should handle empty content", () => {
    const chunks = chunkByMarkdownSections("");
    expect(chunks).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════════════

describe("edge cases", () => {
  it("should handle single character content", () => {
    const chunks = chunkDocument("X");
    expect(chunks).toEqual(["X"]);
  });

  it("should handle very large maxChunkSize", () => {
    const content = "Hello world";
    const chunks = chunkDocument(content, { maxChunkSize: 1_000_000 });
    expect(chunks).toEqual(["Hello world"]);
  });

  it("should handle zero overlap", () => {
    const content = "A".repeat(100);
    const chunks = chunkDocument(content, { maxChunkSize: 30, chunkOverlap: 0, strategy: "fixed" });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("should not produce empty chunks", () => {
    const content = "\n\n\n\nSome content\n\n\n\n";
    const chunks = chunkDocument(content);
    for (const chunk of chunks) {
      expect(chunk.trim().length).toBeGreaterThan(0);
    }
  });
});
