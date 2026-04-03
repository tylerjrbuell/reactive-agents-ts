import { describe, expect, test } from "bun:test";
import { splitMarkdownAndDisplayMath } from "./render-markdown-with-math.js";

describe("splitMarkdownAndDisplayMath", () => {
  test("extracts display math between dollars", () => {
    const s = "Intro\n$$a+b$$\nOutro";
    expect(splitMarkdownAndDisplayMath(s)).toEqual([
      { kind: "markdown", text: "Intro\n" },
      { kind: "math", text: "a+b" },
      { kind: "markdown", text: "\nOutro" },
    ]);
  });

  test("ignores dollars inside fenced code", () => {
    const s = "```\n$$x$$\n```\nAfter $$y$$";
    expect(splitMarkdownAndDisplayMath(s)).toEqual([
      { kind: "markdown", text: "```\n$$x$$\n```\nAfter " },
      { kind: "math", text: "y" },
    ]);
  });

  test("treats unmatched close as literal markdown tail", () => {
    const s = "Hello $$ no end";
    expect(splitMarkdownAndDisplayMath(s)).toEqual([{ kind: "markdown", text: "Hello $$ no end" }]);
  });
});
