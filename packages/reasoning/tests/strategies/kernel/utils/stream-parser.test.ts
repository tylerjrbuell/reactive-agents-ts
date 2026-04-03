// File: tests/strategies/kernel/utils/stream-parser.test.ts
import { describe, it, expect } from "bun:test";
import {
  extractThinking,
  stripThinking,
} from "../../../../src/strategies/kernel/utils/stream-parser.js";

describe("thinking-utils", () => {
  describe("extractThinking", () => {
    it("extracts a standard <think>...</think> block", () => {
      const input = "<think>I need to figure out the answer</think>The answer is 42.";
      const result = extractThinking(input);
      expect(result.thinking).toBe("I need to figure out the answer");
      expect(result.content).toBe("The answer is 42.");
    });

    it("extracts multiple thinking blocks", () => {
      const input =
        "<think>First thought</think>Some content<think>Second thought</think>More content";
      const result = extractThinking(input);
      expect(result.thinking).toBe("First thought\n\nSecond thought");
      expect(result.content).toBe("Some contentMore content");
    });

    it("handles unclosed <think> tag by stripping to end", () => {
      const input = "Some content\n<think>This is my reasoning that never closes";
      const result = extractThinking(input);
      expect(result.thinking).toBe("This is my reasoning that never closes");
      expect(result.content).toBe("Some content");
    });

    it("passes through text with no thinking blocks", () => {
      const input = "ACTION: web-search({\"query\": \"test\"})\nFINAL ANSWER: done";
      const result = extractThinking(input);
      expect(result.thinking).toBeNull();
      expect(result.content).toBe(input);
    });

    it("handles empty thinking blocks", () => {
      const input = "<think></think>The actual content";
      const result = extractThinking(input);
      expect(result.thinking).toBeNull();
      expect(result.content).toBe("The actual content");
    });

    it("strips ACTION and FINAL ANSWER inside thinking (parser poisoning prevention)", () => {
      const input = [
        "<think>",
        "Let me think... I could try ACTION: web-search({\"query\": \"test\"})",
        "Or maybe FINAL ANSWER: some preliminary answer",
        "</think>",
        "ACTION: file-read({\"path\": \"./data.txt\"})",
      ].join("\n");
      const result = extractThinking(input);

      // The ACTION inside <think> should NOT appear in content
      expect(result.content).not.toContain("web-search");
      expect(result.content).not.toContain("FINAL ANSWER: some preliminary answer");

      // The real ACTION outside <think> SHOULD remain
      expect(result.content).toContain("ACTION: file-read");

      // Thinking should contain the internal reasoning
      expect(result.thinking).toContain("ACTION: web-search");
      expect(result.thinking).toContain("FINAL ANSWER: some preliminary answer");
    });

    it("is case insensitive (<Think>, <THINK>)", () => {
      const input = "<Think>reasoning here</Think>The result";
      const result = extractThinking(input);
      expect(result.thinking).toBe("reasoning here");
      expect(result.content).toBe("The result");

      const input2 = "<THINK>more reasoning</THINK>Another result";
      const result2 = extractThinking(input2);
      expect(result2.thinking).toBe("more reasoning");
      expect(result2.content).toBe("Another result");
    });

    it("handles multiline thinking content", () => {
      const input = [
        "<think>",
        "Step 1: Analyze the task",
        "Step 2: Determine approach",
        "Step 3: Execute",
        "</think>",
        "I will use the web-search tool.",
      ].join("\n");
      const result = extractThinking(input);
      expect(result.thinking).toContain("Step 1: Analyze the task");
      expect(result.thinking).toContain("Step 3: Execute");
      expect(result.content).toBe("I will use the web-search tool.");
    });

    it("handles empty string input", () => {
      const result = extractThinking("");
      expect(result.thinking).toBeNull();
      expect(result.content).toBe("");
    });
  });

  describe("stripThinking", () => {
    it("returns clean content without thinking blocks", () => {
      const input = "<think>internal reasoning</think>Clean output";
      expect(stripThinking(input)).toBe("Clean output");
    });

    it("passes through text with no thinking blocks", () => {
      const input = "No thinking here";
      expect(stripThinking(input)).toBe(input);
    });
  });
});
