import { describe, test, expect } from "bun:test";
import { assembleOutput, extractCodeBlocks } from "../../src/kernel/loop/output-assembly.js";
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
