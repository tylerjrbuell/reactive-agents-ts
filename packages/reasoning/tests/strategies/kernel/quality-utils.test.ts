import { describe, it, expect } from "bun:test";
import { isSatisfied, isCritiqueStagnant, parseScore, sanitizeAgentOutput } from "../../../src/strategies/kernel/quality-utils.js";

describe("isSatisfied", () => {
  it("returns true for SATISFIED: prefix", () => {
    expect(isSatisfied("SATISFIED: The response is complete and accurate.")).toBe(true);
  });

  it("returns true for SATISFIED with space", () => {
    expect(isSatisfied("SATISFIED The result meets requirements.")).toBe(true);
  });

  it("returns false for improvement-needed text", () => {
    expect(isSatisfied("The response needs more examples.")).toBe(false);
  });

  it("returns false for text that contains SATISFIED mid-sentence", () => {
    expect(isSatisfied("I am not satisfied with this response.")).toBe(false);
  });

  it("returns true when SATISFIED: is buried after analysis (thinking model)", () => {
    const thinkingCritique = `Thinking Process:

1. The agent called github/list_commits correctly.
2. The agent called signal/send_message_to_user correctly.
3. All required actions were taken.

SATISFIED: All required actions completed successfully.`;
    expect(isSatisfied(thinkingCritique)).toBe(true);
  });

  it("returns false when only UNSATISFIED appears in full text", () => {
    const critique = `After analysis:

UNSATISFIED: The response is missing key details about the feature.`;
    expect(isSatisfied(critique)).toBe(false);
  });

  it("returns false when text discusses 'satisfied' conceptually but verdict is UNSATISFIED", () => {
    const critique = `The user may not be satisfied with this answer.

UNSATISFIED: Needs more detail.`;
    expect(isSatisfied(critique)).toBe(false);
  });
});

describe("isCritiqueStagnant", () => {
  it("returns false when no previous critiques", () => {
    expect(isCritiqueStagnant([], "new critique")).toBe(false);
  });

  it("returns true when critique is identical to last", () => {
    const prev = ["The response lacks examples."];
    expect(isCritiqueStagnant(prev, "The response lacks examples.")).toBe(true);
  });

  it("returns true for normalized match (different whitespace/case)", () => {
    const prev = ["The response  lacks  examples."];
    expect(isCritiqueStagnant(prev, "the response lacks examples.")).toBe(true);
  });

  it("returns true when critique is 80%+ substring overlap with last", () => {
    const prev = ["The response is missing detail about quantum states and entanglement"];
    // New critique is mostly the same (first 80% matches)
    expect(isCritiqueStagnant(prev, "The response is missing detail about quantum states and entanglement phenomena")).toBe(true);
  });

  it("returns false for genuinely different critiques", () => {
    const prev = ["Lacks concrete examples"];
    expect(isCritiqueStagnant(prev, "Grammar and spelling errors throughout the text")).toBe(false);
  });

  it("only compares against the LAST critique, not all previous ones", () => {
    const prev = ["Old critique 1", "Old critique 2", "Recent: lacks depth"];
    // Same as "Old critique 1" but not same as most recent
    expect(isCritiqueStagnant(prev, "Old critique 1")).toBe(false);
  });
});

describe("parseScore", () => {
  it("parses percentage: '75%' → 0.75", () => {
    expect(parseScore("75%")).toBe(0.75);
  });

  it("parses ratio: '3/4' → 0.75", () => {
    expect(parseScore("3/4")).toBeCloseTo(0.75);
  });

  it("parses decimal: '0.8' → 0.8", () => {
    expect(parseScore("0.8")).toBe(0.8);
  });

  it("parses labeled decimal: 'Score: 0.7' → 0.7", () => {
    expect(parseScore("Score: 0.7")).toBe(0.7);
  });

  it("parses labeled integer (0–10 scale): 'Rating: 7' → 0.7", () => {
    expect(parseScore("Rating: 7")).toBeCloseTo(0.7);
  });

  it("clamps to [0, 1]: '150%' → 1.0", () => {
    expect(parseScore("150%")).toBe(1.0);
  });

  it("strips <think>...</think> tags before parsing", () => {
    expect(parseScore("<think>Some reasoning here</think>\n0.8")).toBe(0.8);
  });

  it("returns 0.5 as safe default for unparseable input", () => {
    expect(parseScore("I think this response is quite good")).toBe(0.5);
  });

  it("returns 0.5 for empty string", () => {
    expect(parseScore("")).toBe(0.5);
  });
});

describe("sanitizeAgentOutput", () => {
  it("strips FINAL ANSWER: prefix", () => {
    expect(sanitizeAgentOutput("FINAL ANSWER: The result is 42.")).toBe("The result is 42.");
  });

  it("strips FINAL ANSWER: case-insensitively", () => {
    expect(sanitizeAgentOutput("Final Answer: Hello world")).toBe("Hello world");
  });

  it("strips <think>...</think> tags", () => {
    expect(sanitizeAgentOutput("<think>internal reasoning</think>\nThe answer is 42.")).toBe("The answer is 42.");
  });

  it("strips internal step markers", () => {
    expect(sanitizeAgentOutput("[STEP 1/3] Fetched data\n[EXEC s1] Done")).toBe("Fetched data\nDone");
  });

  it("strips [SYNTHESIS] marker", () => {
    expect(sanitizeAgentOutput("[SYNTHESIS] Here is your briefing.")).toBe("Here is your briefing.");
  });

  it("strips [REFLECT N] marker", () => {
    expect(sanitizeAgentOutput("[REFLECT 1] All steps completed.")).toBe("All steps completed.");
  });

  it("strips ReAct protocol prefixes", () => {
    const input = "Thought: I need to search\nAction: web_search\nAction Input: query\nThe final result.";
    const result = sanitizeAgentOutput(input);
    expect(result).not.toContain("Thought:");
    expect(result).not.toContain("Action:");
    expect(result).not.toContain("Action Input:");
    expect(result).toContain("The final result.");
  });

  it("strips tool call echo lines (tool/name: {json})", () => {
    const input = 'signal/send_message_to_user: {"recipient": "+1234", "message": "hi"}\nMessage sent.';
    expect(sanitizeAgentOutput(input)).toBe("Message sent.");
  });

  it("strips raw JSON with internal keys", () => {
    const input = '{"recipient": "+1234", "toolName": "signal/send"}\nDone.';
    expect(sanitizeAgentOutput(input)).toBe("Done.");
  });

  it("collapses multiple blank lines", () => {
    expect(sanitizeAgentOutput("Hello\n\n\n\n\nWorld")).toBe("Hello\n\nWorld");
  });

  it("preserves clean user-facing content unchanged", () => {
    const clean = "Here is your daily briefing:\n\n- PR #42 merged\n- 3 new issues opened";
    expect(sanitizeAgentOutput(clean)).toBe(clean);
  });

  it("handles empty string", () => {
    expect(sanitizeAgentOutput("")).toBe("");
  });

  it("handles non-string input gracefully", () => {
    // Type coercion edge case — function should handle undefined/null
    expect(sanitizeAgentOutput(null as any)).toBe(null);
    expect(sanitizeAgentOutput(undefined as any)).toBe(undefined);
  });

  it("strips combined internal artifacts in real-world output", () => {
    const messy = [
      "FINAL ANSWER:",
      "<think>Let me think about this</think>",
      "[SYNTHESIS] Here is your briefing:",
      "",
      "signal/send_message_to_user: {\"recipient\": \"+126973710543\", \"message\": \"test\"}",
      "",
      "- 3 commits merged yesterday",
      "- Build is green",
    ].join("\n");
    const result = sanitizeAgentOutput(messy);
    expect(result).not.toContain("FINAL ANSWER");
    expect(result).not.toContain("<think>");
    expect(result).not.toContain("[SYNTHESIS]");
    expect(result).not.toContain("signal/send_message_to_user");
    expect(result).not.toContain("recipient");
    expect(result).toContain("Here is your briefing:");
    expect(result).toContain("- 3 commits merged yesterday");
    expect(result).toContain("- Build is green");
  });
});
