import { describe, expect, test } from "bun:test";
import { answerTitleOf, exportFileName, htmlDocument } from "./answer-export.js";

describe("answerTitleOf", () => {
  test("first heading wins, then first line, cut when long", () => {
    expect(answerTitleOf("intro\n\n## Q3 results\ntext")).toBe("Q3 results");
    expect(answerTitleOf("Just a sentence about things.\nMore.")).toBe("Just a sentence about things.");
    expect(answerTitleOf("x".repeat(100))).toBe(`${"x".repeat(67)}...`);
    expect(answerTitleOf("  \n")).toBe("Answer");
  });
});

describe("exportFileName", () => {
  test("slug of the title with the extension", () => {
    expect(exportFileName("# Q3 results: EMEA & APAC\nbody", "md")).toBe("q3-results-emea-apac.md");
    expect(exportFileName("", "html")).toBe("answer.html");
  });
});

describe("htmlDocument", () => {
  test("escapes the title, embeds the body, ships a no-script policy", () => {
    const doc = htmlDocument(`<script>alert(1)</script>`, "<p>hi</p>");
    expect(doc).toContain("<title>&lt;script&gt;alert(1)&lt;/script&gt;</title>");
    expect(doc).toContain("<p>hi</p>");
    expect(doc).toContain("default-src 'none'");
    expect(doc).not.toContain("<script>alert");
  });
});
