import { describe, test, expect } from "bun:test";
import { assembleOutput, extractCodeBlocks, stripFrameworkLeaks } from "../../src/kernel/loop/output-assembly.js";
import type { ReasoningStep } from "../../src/types/index.js";

describe("extractCodeBlocks", () => {
  test("extracts fenced code blocks", () => {
    const text = 'Some text\n```typescript\nconst x = 1;\n```\nMore text';
    const blocks = extractCodeBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain("const x = 1;");
  });

  test("returns empty for no code", () => {
    expect(extractCodeBlocks("Just plain text")).toHaveLength(0);
  });

  test("extracts multiple fenced blocks", () => {
    const text = '```js\na()\n```\nstuff\n```py\nb()\n```';
    expect(extractCodeBlocks(text)).toHaveLength(2);
  });
});

describe("assembleOutput", () => {
  const makeStep = (type: string, content: string): ReasoningStep =>
    ({ type, content, timestamp: new Date(), id: "step-1" as any }) as any;

  test("final answer with code → pass-through", () => {
    const result = assembleOutput({
      finalAnswer: '```js\nfunction isPrime(n) { return true; }\n```\nDone.',
      steps: [],
      terminatedBy: "final_answer",
    });
    expect(result.text).toContain("isPrime");
    expect(result.sources).toEqual(["final_answer"]);
  });

  test("final answer > 200 chars → pass-through", () => {
    const longAnswer = "x".repeat(201);
    const result = assembleOutput({
      finalAnswer: longAnswer,
      steps: [makeStep("thought", "```js\ncode()\n```")],
      terminatedBy: "end_turn",
    });
    expect(result.text).toBe(longAnswer);
  });

  test("short summary + preceding code → code prepended", () => {
    const result = assembleOutput({
      finalAnswer: "The code is complete and correct.",
      steps: [
        makeStep("thought", "Let me write fizzbuzz:\n```js\nfunction fizzbuzz() { /* ... */ }\n```"),
        makeStep("action", "final-answer"),
      ],
      terminatedBy: "final_answer",
    });
    expect(result.text).toContain("fizzbuzz");
    expect(result.text).toContain("The code is complete and correct.");
    expect(result.codeBlocks).toHaveLength(1);
  });

  test("no code anywhere → pass-through", () => {
    const result = assembleOutput({
      finalAnswer: "Paris is the capital.",
      steps: [makeStep("thought", "Thinking about geography...")],
      terminatedBy: "end_turn",
    });
    expect(result.text).toBe("Paris is the capital.");
    expect(result.codeBlocks).toHaveLength(0);
  });

  test("multiple code steps + entropy → lowest entropy preferred", () => {
    const result = assembleOutput({
      finalAnswer: "Done.",
      steps: [
        makeStep("thought", "```js\nv1()\n```"),
        makeStep("thought", "```js\nv2()\n```"),
      ],
      terminatedBy: "end_turn",
      entropyScores: [
        { composite: 0.8 },  // high entropy (step 0)
        { composite: 0.2 },  // low entropy (step 1) — preferred
      ],
    });
    expect(result.text).toContain("v2()");
    expect(result.text).not.toContain("v1()");
  });
});

describe("stripFrameworkLeaks (M2 sweep-2026-05-23)", () => {
  test("M2a — strips <rationale call='N'>...</rationale> wrapper", () => {
    const leaked = '<rationale call="1">{"why":"direct calculation","confidence":0.9}</rationale>';
    expect(stripFrameworkLeaks(leaked)).toBe("");
  });

  test("M2a — strips wrapper but keeps trailing answer", () => {
    const leaked = '<rationale call="1">To calculate.</rationale>\nThe result is: 391';
    const clean = stripFrameworkLeaks(leaked);
    expect(clean).not.toContain("<rationale");
    expect(clean).toContain("The result is: 391");
  });

  test("M2a — multiple rationale blocks all stripped", () => {
    const leaked = '<rationale call="1">first</rationale>\nMid text\n<rationale call="2">second</rationale>\nEnd';
    const clean = stripFrameworkLeaks(leaked);
    expect(clean).not.toContain("<rationale");
    expect(clean).toContain("Mid text");
    expect(clean).toContain("End");
  });

  test("M2b — strips [CRITIQUE N] SATISFIED: meta-marker (reflexion)", () => {
    const leaked = "[CRITIQUE 1] SATISFIED: The agent successfully retrieved...";
    expect(stripFrameworkLeaks(leaked)).toBe("");
  });

  test("M2b — strips marker line, keeps following content", () => {
    const leaked = "[CRITIQUE 2] SATISFIED: All steps complete.\n\nThe trade-offs are: ...";
    const clean = stripFrameworkLeaks(leaked);
    expect(clean).not.toContain("[CRITIQUE");
    expect(clean).toContain("trade-offs");
  });

  test("M2c — strips [find result — compressed preview] template (ToT)", () => {
    const leaked = "[find result — compressed preview]\nType: Object(4 keys)\n  query: full-text indexing trade-offs\n  results: Array(5)";
    expect(stripFrameworkLeaks(leaked).trim()).toBe("");
  });

  test("does not strip user content matching prefix-like patterns", () => {
    const valid = "The XML format <rationale> is used in education for...";
    expect(stripFrameworkLeaks(valid)).toBe(valid);
  });

  test("idempotent — running twice produces same result", () => {
    const leaked = '<rationale call="1">x</rationale>\nAnswer';
    const once = stripFrameworkLeaks(leaked);
    const twice = stripFrameworkLeaks(once);
    expect(twice).toBe(once);
  });

  test("empty input → empty output", () => {
    expect(stripFrameworkLeaks("")).toBe("");
  });

  test("clean input → unchanged", () => {
    expect(stripFrameworkLeaks("Paris is the capital of France.")).toBe("Paris is the capital of France.");
  });

  test("M2b — UNSATISFIED status also stripped", () => {
    const leaked = "[CRITIQUE 3] UNSATISFIED: The agent's response only contains a rationale.";
    expect(stripFrameworkLeaks(leaked)).toBe("");
  });

  test("M2b — PARTIAL status also stripped", () => {
    const leaked = "[CRITIQUE 2] PARTIAL: incomplete answer.\nReal content here.";
    const clean = stripFrameworkLeaks(leaked);
    expect(clean).not.toContain("[CRITIQUE");
    expect(clean).toContain("Real content here.");
  });

  test("M2a — orphan </rationale> close tag stripped", () => {
    const leaked = "Let's check if everything is complete using pulse().</rationale>";
    const clean = stripFrameworkLeaks(leaked);
    expect(clean).not.toContain("</rationale>");
    expect(clean).toContain("pulse()");
  });

  test("M2a — orphan opening rationale (no close) stripped", () => {
    const leaked = 'prefix\n<rationale call="2">truncated content with no closer';
    const clean = stripFrameworkLeaks(leaked);
    expect(clean).not.toContain("<rationale");
    expect(clean).toContain("prefix");
  });

  test("M2c — [search result —] variant also stripped", () => {
    const leaked = "[search result — preview]\nType: Array(5)";
    expect(stripFrameworkLeaks(leaked).trim()).toBe("");
  });
});

describe("assembleOutput — sanitizes framework leaks (M2)", () => {
  const makeStep = (type: string, content: string): ReasoningStep =>
    ({ type, content, timestamp: new Date(), id: "step-1" as any }) as any;

  test("M2a leak in finalAnswer is stripped on assembly", () => {
    const result = assembleOutput({
      finalAnswer: '<rationale call="1">{"why":"trivial"}</rationale>',
      steps: [],
      terminatedBy: "end_turn",
    });
    expect(result.text).not.toContain("<rationale");
  });

  test("M2b leak in finalAnswer is stripped on assembly", () => {
    const result = assembleOutput({
      finalAnswer: "[CRITIQUE 1] SATISFIED: done.\nThe answer is X.",
      steps: [],
      terminatedBy: "end_turn",
    });
    expect(result.text).not.toContain("[CRITIQUE");
    expect(result.text).toContain("The answer is X.");
  });

  test("M2c leak in finalAnswer is stripped on assembly", () => {
    const result = assembleOutput({
      finalAnswer: "[find result — compressed preview]\nType: Object\n  data: ...",
      steps: [],
      terminatedBy: "end_turn",
    });
    expect(result.text).not.toContain("[find result");
  });
});
