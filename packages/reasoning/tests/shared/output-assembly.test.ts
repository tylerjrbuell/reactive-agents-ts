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

// HS-cleanup-1 — root-fix invariants.
//
// The framework-leak problem (HS-105) is fixed at producers, not by stripping
// at boundaries. `stripFrameworkLeaks` is a deprecated identity shim; the
// canonical mechanism is `step.metadata.frameworkInstrumentation` and
// producer-side stripping (think.ts).

describe("assembleOutput — skips framework instrumentation steps (HS-cleanup-1)", () => {
  const makeStep = (
    type: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): ReasoningStep =>
    ({ type, content, timestamp: new Date(), id: "step-1" as any, ...(metadata ? { metadata } : {}) }) as any;

  test("code in instrumentation thought step is ignored — finalAnswer used as-is", () => {
    // A `[TOT]` marker step that happens to contain a code block must NOT be
    // promoted as user output. Without the instrumentation filter, the
    // `[TOT] Starting tree exploration` step's content (with embedded code)
    // would be prepended to the answer.
    const result = assembleOutput({
      finalAnswer: "The answer is 42.",
      steps: [
        makeStep("thought", "[TOT] depth=1\n```js\ninternal()\n```", {
          frameworkInstrumentation: "tot-marker",
        }),
      ],
      terminatedBy: "end_turn",
    });
    expect(result.text).toBe("The answer is 42.");
    expect(result.text).not.toContain("internal()");
  });

  test("non-instrumentation thought with code IS promoted", () => {
    const result = assembleOutput({
      finalAnswer: "Done.",
      steps: [makeStep("thought", "```js\nuserCode()\n```")],
      terminatedBy: "end_turn",
    });
    expect(result.text).toContain("userCode()");
  });

  test("mix: instrumentation step ignored, normal step preferred", () => {
    const result = assembleOutput({
      finalAnswer: "Done.",
      steps: [
        makeStep("thought", "[CRITIQUE 1] SATISFIED:\n```js\nlatest()\n```", {
          frameworkInstrumentation: "critique-marker",
        }),
        makeStep("thought", "Real chain:\n```js\nactual()\n```"),
      ],
      terminatedBy: "end_turn",
    });
    expect(result.text).toContain("actual()");
    expect(result.text).not.toContain("latest()");
  });
});
