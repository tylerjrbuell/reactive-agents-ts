// File: tests/kernel/utils/stream-parser.test.ts
import { describe, it, expect } from "bun:test";
import {
  extractThinking,
  extractThinkingSafeContent,
  stripThinking,
  THINKING_SAFE_MIN_TOKENS,
} from "../../../../src/kernel/utils/stream-parser.js";

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

  describe("extractThinkingSafeContent", () => {
    // Generalizes the gold-standard fallback pattern from reflexion.ts:271-279.
    // These tests pin the cascading-fallback semantics consumed by
    // tool-execution / strategy-evaluator / runner synthesis sites.

    it("THINKING_SAFE_MIN_TOKENS exports the 2048 floor", () => {
      // Aligned with structured-output budget bumped 500→2048 (commit 6da177e5).
      expect(THINKING_SAFE_MIN_TOKENS).toBe(2048);
    });

    it("1. clean content, no think tags → content unchanged, recovered=false", () => {
      const result = extractThinkingSafeContent({
        content: "ACTION: web-search({\"query\": \"hello\"})",
      });
      expect(result.content).toBe("ACTION: web-search({\"query\": \"hello\"})");
      expect(result.recovered).toBe(false);
      expect(result.thinking).toBeNull();
    });

    it("2. closed <think>…</think> + content after → cleaned content + recovered + thinking extracted", () => {
      const result = extractThinkingSafeContent({
        content: "<think>let me reason</think>The final answer is 42.",
      });
      expect(result.content).toBe("The final answer is 42.");
      expect(result.recovered).toBe(true);
      expect(result.thinking).toBe("let me reason");
    });

    it("3. ONLY <think> content with empty cleaned → falls back to thinking content", () => {
      const result = extractThinkingSafeContent({
        content: "<think>the answer hidden in thinking</think>",
      });
      expect(result.content).toBe("the answer hidden in thinking");
      expect(result.recovered).toBe(true);
      expect(result.thinking).toBe("the answer hidden in thinking");
    });

    it("4. unclosed <think> (truncated mid-reasoning) → strips to end, returns survivor", () => {
      // Common qwen3 truncation: budget ran out mid-think with no closing tag.
      const result = extractThinkingSafeContent({
        content: "Header line\n<think>I was reasoning but got cut off mid-",
      });
      expect(result.content).toBe("Header line");
      expect(result.recovered).toBe(true);
      expect(result.thinking).toContain("I was reasoning but got cut off");
    });

    it("4b. unclosed <think> with NOTHING before → falls back to thinking content", () => {
      // Edge case: entire response is unclosed <think>; clean is empty.
      const result = extractThinkingSafeContent({
        content: "<think>reasoning that never closes",
      });
      expect(result.content).toBe("reasoning that never closes");
      expect(result.recovered).toBe(true);
      expect(result.thinking).toBe("reasoning that never closes");
    });

    it("5. empty cleaned + provider response.thinking → uses provider.thinking", () => {
      // Ollama think:true separates thinking into response.thinking.
      const result = extractThinkingSafeContent({
        content: "",
        thinking: "provider-supplied reasoning",
      });
      expect(result.content).toBe("provider-supplied reasoning");
      expect(result.recovered).toBe(true);
      expect(result.thinking).toBe("provider-supplied reasoning");
    });

    it("6. empty everything → returns raw content (empty string), recovered=true, thinking=null", () => {
      const result = extractThinkingSafeContent({ content: "" });
      expect(result.content).toBe("");
      // Safety net engaged: anything besides "clean non-empty + no think tags"
      // sets recovered=true so call sites can log the degraded case.
      expect(result.recovered).toBe(true);
      expect(result.thinking).toBeNull();
    });

    it("6b. only think tags producing empty cleaned AND empty extracted → raw fallback", () => {
      // <think></think> alone: extracted is null (empty-block guard) and clean is "".
      const result = extractThinkingSafeContent({
        content: "<think></think>",
      });
      // Raw content "<think></think>" survives only if no other fallback fires.
      expect(result.recovered).toBe(true);
      // thinking stays null because empty blocks aren't recorded.
      expect(result.thinking).toBeNull();
      // content falls through to raw response.content per fallback step 4.
      expect(result.content).toBe("<think></think>");
    });

    it("7. extracted thinking AND provider.thinking present → extracted wins for thinking; content cascade prefers cleaned", () => {
      const result = extractThinkingSafeContent({
        content: "<think>in-band reasoning</think>real answer",
        thinking: "provider trace",
      });
      // Content cascade prefers cleaned (real answer).
      expect(result.content).toBe("real answer");
      // Thinking field: extracted in-band wins for consistency with reflexion
      // precedent (in-band is closer to the actual emission).
      expect(result.thinking).toBe("in-band reasoning");
      expect(result.recovered).toBe(true);
    });

    it("non-string content field is tolerated (defensive)", () => {
      // Some adapters return malformed responses; helper must not throw.
      const result = extractThinkingSafeContent({
        content: undefined as unknown as string,
      });
      expect(result.content).toBe("");
      // Defensive empty path is treated as "degraded": recovered=true so
      // callers can route to fallback logging.
      expect(result.recovered).toBe(true);
      expect(result.thinking).toBeNull();
    });
  });
});
