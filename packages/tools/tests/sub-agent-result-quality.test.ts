import { describe, test, expect } from "bun:test";
import { createSubAgentExecutor } from "../src/adapters/agent-tool-adapter.js";

// Helper to build an executor backed by a fake executeFn that returns
// the given output string directly.
const makeExecutor = (output: string, success = true) => {
  const executeFn = async (_opts: unknown) => ({
    output,
    success,
    tokensUsed: 10,
    stepsCompleted: 1,
  });
  return createSubAgentExecutor(
    { name: "test-agent" },
    executeFn as Parameters<typeof createSubAgentExecutor>[1],
  );
};

describe("sub-agent result formatting", () => {
  test("short factual answer passes through without wrapping", async () => {
    const executor = makeExecutor("120");
    const result = await executor("What is the answer?");
    expect(result.summary).toBe("120");
  });

  test("FINAL ANSWER: prefix is stripped (plain)", async () => {
    const executor = makeExecutor("FINAL ANSWER: 120");
    const result = await executor("What is the answer?");
    expect(result.summary).toBe("120");
  });

  test("FINAL ANSWER: prefix is stripped (bold markdown)", async () => {
    const executor = makeExecutor("**FINAL ANSWER**: 120");
    const result = await executor("What is the answer?");
    expect(result.summary).toBe("120");
  });

  test("FINAL ANSWER: prefix stripped case-insensitively", async () => {
    const executor = makeExecutor("final answer: The result is 42.");
    const result = await executor("What is the answer?");
    expect(result.summary).toBe("The result is 42.");
  });

  test("Thought: prefix is stripped", async () => {
    const executor = makeExecutor("Thought: I should compute 6*7 = 42");
    const result = await executor("Math question");
    expect(result.summary).toBe("I should compute 6*7 = 42");
  });

  test("Answer: prefix is stripped", async () => {
    const executor = makeExecutor("Answer: Paris");
    const result = await executor("Capital of France?");
    expect(result.summary).toBe("Paris");
  });

  test("short answer (≤500 chars) passes through verbatim without truncation", async () => {
    const shortAnswer = "The answer is 42.";
    const executor = makeExecutor(shortAnswer);
    const result = await executor("Give me a short answer");
    expect(result.summary).toBe(shortAnswer);
    expect(result.summary.includes("omitted")).toBe(false);
  });

  test("answer just at 500 chars is not truncated", async () => {
    const exactly500 = "A".repeat(500);
    const executor = makeExecutor(exactly500);
    const result = await executor("Long but not too long");
    expect(result.summary).toBe(exactly500);
    expect(result.summary.includes("omitted")).toBe(false);
  });

  test("long output (>1200 chars) keeps head + tail with omission marker", async () => {
    const longOutput = "B".repeat(2000);
    const executor = makeExecutor(longOutput);
    const result = await executor("Long output task");

    // Should contain head (first 600 chars)
    expect(result.summary.startsWith("B".repeat(600))).toBe(true);
    // Should contain the omission marker
    expect(result.summary).toContain("chars omitted");
    // Should contain tail (last 400 chars)
    expect(result.summary.endsWith("B".repeat(400))).toBe(true);
    // Total length should be well under the original 2000 chars
    expect(result.summary.length).toBeLessThan(1200);
  });

  test("output between 501 and 1200 chars is kept as-is", async () => {
    const mediumOutput = "C".repeat(800);
    const executor = makeExecutor(mediumOutput);
    const result = await executor("Medium output task");
    expect(result.summary).toBe(mediumOutput);
    expect(result.summary.includes("omitted")).toBe(false);
  });

  test("empty output returns empty string without crash", async () => {
    const executor = makeExecutor("");
    const result = await executor("Empty task");
    expect(result.summary).toBe("");
  });

  test("FINAL ANSWER prefix stripped then short answer passes through", async () => {
    // After stripping "FINAL ANSWER: " the remaining text is ≤500 chars
    const executor = makeExecutor("FINAL ANSWER: The capital of France is Paris.");
    const result = await executor("Capital of France?");
    expect(result.summary).toBe("The capital of France is Paris.");
    expect(result.summary.includes("FINAL")).toBe(false);
  });

  test("success flag is preserved", async () => {
    const executor = makeExecutor("done", true);
    const result = await executor("task");
    expect(result.success).toBe(true);
  });

  test("failure flag is preserved", async () => {
    const executor = makeExecutor("error occurred", false);
    const result = await executor("failing task");
    expect(result.success).toBe(false);
  });

  test("tokensUsed is forwarded", async () => {
    const executeFn = async (_opts: unknown) => ({
      output: "result",
      success: true,
      tokensUsed: 999,
      stepsCompleted: 2,
    });
    const executor = createSubAgentExecutor(
      { name: "token-test" },
      executeFn as Parameters<typeof createSubAgentExecutor>[1],
    );
    const result = await executor("task");
    expect(result.tokensUsed).toBe(999);
    expect(result.stepsCompleted).toBe(2);
  });
});
