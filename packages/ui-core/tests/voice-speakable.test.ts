import { describe, expect, test } from "bun:test";
import { chunkSpeech, isEcho, locateInText, speakableOf } from "../src/index.js";

describe("speakableOf", () => {
  test("announces code blocks instead of reading them", () => {
    const md = "Run this:\n\n```ts\nconst a = 1;\nconst b = 2;\n```\n\nThen done.";
    const r = speakableOf(md);
    expect(r.codeBlocks).toBe(1);
    expect(r.text).toContain("Code block in ts, 2 lines.");
    expect(r.text).not.toContain("const a");
    expect(r.text).toContain("Then done.");
  });

  test("an unterminated fence is still announced", () => {
    const r = speakableOf("```\nline\nline2");
    expect(r.text).toBe("Code block, 2 lines.");
  });

  test("a tilde fence closes only on a tilde fence", () => {
    const r = speakableOf("~~~\n```\nnot closed by backticks\n~~~\nafter");
    expect(r.codeBlocks).toBe(1);
    expect(r.text).toContain("after");
    expect(r.text).not.toContain("not closed");
  });

  test("tables are announced with their data row count", () => {
    const r = speakableOf("| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nend");
    expect(r.tables).toBe(1);
    expect(r.text).toContain("Table, 3 rows.");
    expect(r.text).not.toContain("|");
  });

  test("strips markup, keeps link labels and image alt text", () => {
    const r = speakableOf("# Title\n\nSome **bold** and _italic_ with `code`, a [link](https://x.dev) and ![chart](a.png). See https://example.com/page now.");
    expect(r.text).toContain("Title.");
    expect(r.text).toContain("Some bold and italic with code, a link and chart.");
    expect(r.text).toContain("See link now.");
    expect(r.text).not.toMatch(/[*_`#\[\]]/);
  });

  test("list items end with a pause and lose their markers", () => {
    const r = speakableOf("- first thing\n- [x] second\n1. third");
    expect(r.text).toBe("first thing.\n\nsecond.\n\nthird.");
  });

  test("block math is announced, quote marks and rules dropped", () => {
    const r = speakableOf("> quoted\n\n---\n\n$$\nx^2\n$$\n\nend");
    expect(r.text).toBe("quoted\n\nEquation.\n\nend");
  });

  test("empty and markup-only input has nothing to say", () => {
    expect(speakableOf("").text).toBe("");
    expect(speakableOf("---\n\n<!-- c -->").text).toBe("");
  });
});

describe("chunkSpeech", () => {
  test("one chunk per sentence with offsets into the text", () => {
    const text = "First one. Second one! Third?";
    const chunks = chunkSpeech(text);
    expect(chunks.map((c) => c.text)).toEqual(["First one.", "Second one!", "Third?"]);
    for (const c of chunks) expect(text.slice(c.start, c.end)).toBe(c.text);
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  test("abbreviations, initials and decimals do not end a sentence", () => {
    const chunks = chunkSpeech("Dr. Smith paid 3.5 dollars, e.g. cash. J. K. Rowling agreed.");
    expect(chunks.map((c) => c.text)).toEqual(["Dr. Smith paid 3.5 dollars, e.g. cash.", "J. K. Rowling agreed."]);
  });

  test("newlines are boundaries", () => {
    expect(chunkSpeech("Heading.\n\nbody without end").map((c) => c.text)).toEqual(["Heading.", "body without end"]);
  });

  test("a long sentence is split at clauses and no chunk exceeds the limit", () => {
    const long = Array.from({ length: 30 }, (_, i) => `clause number ${i}`).join(", ") + ".";
    const chunks = chunkSpeech(long, { maxChars: 80 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(80);
    expect(chunks.map((c) => c.text).join(" ").replace(/\s+/g, " ")).toBe(long);
  });

  test("an unbroken run is hard-cut", () => {
    const chunks = chunkSpeech("x".repeat(500), { maxChars: 100 });
    expect(chunks.every((c) => c.text.length <= 100)).toBe(true);
    expect(chunks.map((c) => c.text).join("")).toBe("x".repeat(500));
  });

  test("closing quotes stay with their sentence", () => {
    expect(chunkSpeech('He said "stop." Then left.').map((c) => c.text)).toEqual(['He said "stop."', "Then left."]);
  });

  test("empty text has no chunks", () => {
    expect(chunkSpeech("  \n ")).toEqual([]);
  });
});

describe("isEcho", () => {
  test("a fragment of the spoken text is an echo, other words are not", () => {
    const spoken = "The build finished and all 12 tests passed.";
    expect(isEcho("tests passed", spoken)).toBe(true);
    expect(isEcho("The BUILD finished!", spoken)).toBe(true);
    expect(isEcho("stop please", spoken)).toBe(false);
    expect(isEcho("   ", spoken)).toBe(true);
  });
});

describe("locateInText", () => {
  test("finds a sentence ignoring whitespace differences and maps back to offsets", () => {
    const hay = "Intro line\n   First   sentence here.\nNext one.";
    const at = locateInText(hay, "First sentence here.");
    expect(at).not.toBeNull();
    expect(hay.slice(at!.start, at!.end)).toBe("First   sentence here.");
  });

  test("null when the text is not there", () => {
    expect(locateInText("abc", "xyz")).toBeNull();
    expect(locateInText("abc", " ")).toBeNull();
  });
});
