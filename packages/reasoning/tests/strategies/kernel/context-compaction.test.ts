// Tests for decision-preserving context compaction
import { describe, it, expect } from "bun:test";
import {
  extractObservationFinding,
  extractThoughtDecision,
  summarizeTriplet,
  summarizeStepsTriplets,
  summarizeStepForContext,
} from "../../../src/strategies/kernel/context-utils.js";

const makeStep = (type: string, content: string, metadata?: Record<string, unknown>) => ({
  id: "01JTEST",
  type,
  content,
  timestamp: new Date(),
  metadata,
});

// ── extractObservationFinding ──────────────────────────────────────────────

describe("extractObservationFinding", () => {
  it("returns short content as-is with tool label", () => {
    expect(extractObservationFinding("42", "calculator")).toBe("calculator: 42");
  });

  it("extracts scalar findings from JSON objects", () => {
    const json = JSON.stringify({ name: "Alice", age: 30, city: "NYC" });
    const result = extractObservationFinding(json, "api");
    expect(result).toContain("api:");
    expect(result).toContain("name=Alice");
    expect(result).toContain("age=30");
  });

  it("handles JSON arrays with count and first item", () => {
    const json = JSON.stringify(["first item", "second item", "third item"]);
    const result = extractObservationFinding(json, "search");
    expect(result).toContain("search:");
    expect(result).toContain("3 items");
    expect(result).toContain("first item");
  });

  it("handles arrays of objects", () => {
    const json = JSON.stringify([{ title: "Article 1" }, { title: "Article 2" }]);
    const result = extractObservationFinding(json, "search");
    expect(result).toContain("2 items");
    expect(result).toContain("title=Article 1");
  });

  it("preserves error markers", () => {
    const result = extractObservationFinding("⚠️ Tool failed: timeout", "api");
    expect(result).toContain("⚠️");
    expect(result).toContain("timeout");
  });

  it("preserves STORED markers", () => {
    const result = extractObservationFinding("[STORED: _tool_result_1] data saved", "file-read");
    expect(result).toContain("stored");
    expect(result).toContain("_tool_result_1");
  });

  it("handles long plain text by extracting first meaningful line", () => {
    const longText = "The search returned the following results.\n" +
      "Result 1: Important finding about quantum computing.\n" +
      "Result 2: Another finding about machine learning.";
    const result = extractObservationFinding(longText, "web-search");
    expect(result).toContain("web-search:");
    expect(result.length).toBeLessThan(150);
  });

  it("truncates very long findings", () => {
    const json = JSON.stringify({ description: "A".repeat(200) });
    const result = extractObservationFinding(json, "api");
    expect(result.length).toBeLessThan(200);
  });
});

// ── extractThoughtDecision ─────────────────────────────────────────────────

describe("extractThoughtDecision", () => {
  it("returns short thoughts as-is", () => {
    expect(extractThoughtDecision("I should search for the answer.")).toBe(
      "I should search for the answer.",
    );
  });

  it("extracts 'I should' decisions", () => {
    const thought = "Looking at the task requirements, there are several options. " +
      "I should search the web for current pricing data. " +
      "That will give us what we need.";
    const result = extractThoughtDecision(thought);
    expect(result).toContain("search the web");
  });

  it("extracts 'Let me' decisions", () => {
    const thought = "The user wants to know about weather. There are multiple tools available. " +
      "Let me use the weather API to check the current conditions. " +
      "This should be straightforward.";
    const result = extractThoughtDecision(thought);
    expect(result).toContain("weather API");
  });

  it("falls back to last sentence for unstructured thoughts", () => {
    const thought = "First consideration here. Second point about the data. " +
      "Third observation about patterns. The conclusion is clear.";
    const result = extractThoughtDecision(thought);
    // Should get the last sentence as conclusion
    expect(result.length).toBeLessThan(160);
  });

  it("truncates very long thoughts without decision markers", () => {
    const thought = "A".repeat(200);
    const result = extractThoughtDecision(thought);
    expect(result.length).toBeLessThanOrEqual(104); // 100 + "..."
  });
});

// ── summarizeTriplet ───────────────────────────────────────────────────────

describe("summarizeTriplet", () => {
  it("collapses thought→action→observation into single line", () => {
    const thought = makeStep("thought", "I should search for AI news.");
    const action = makeStep("action", JSON.stringify({ tool: "web-search", input: '{"query":"AI news"}' }));
    const obs = makeStep("observation", "Found 5 articles about AI developments.", {
      toolUsed: "web-search",
      observationResult: { success: true, toolName: "web-search", resultKind: "data" },
    });

    const result = summarizeTriplet(thought as any, action as any, obs as any);
    expect(result).not.toBeNull();
    expect(result).toContain("web-search");
    expect(result).toContain("→");
  });

  it("shows failure icon for failed observations", () => {
    const thought = makeStep("thought", "I will try to read the file.");
    const action = makeStep("action", JSON.stringify({ tool: "file-read", input: '{"path":"/missing.txt"}' }));
    const obs = makeStep("observation", "Error: file not found", {
      toolUsed: "file-read",
      observationResult: { success: false, toolName: "file-read", resultKind: "error" },
    });

    const result = summarizeTriplet(thought as any, action as any, obs as any);
    expect(result).toContain("✗");
    expect(result).toContain("file-read");
  });

  it("returns null for non-triplet input", () => {
    const step1 = makeStep("thought", "thinking");
    const step2 = makeStep("thought", "more thinking");
    const step3 = makeStep("thought", "still thinking");
    expect(summarizeTriplet(step1 as any, step2 as any, step3 as any)).toBeNull();
  });

  it("truncates very long triplet summaries", () => {
    const thought = makeStep("thought", "thinking");
    const action = makeStep("action", JSON.stringify({ tool: "api-call", input: "{}" }));
    const obs = makeStep("observation", "A".repeat(200), {
      toolUsed: "api-call",
      observationResult: { success: true, toolName: "api-call", resultKind: "data" },
    });

    const result = summarizeTriplet(thought as any, action as any, obs as any);
    expect(result!.length).toBeLessThanOrEqual(150);
  });
});

// ── summarizeStepsTriplets ─────────────────────────────────────────────────

describe("summarizeStepsTriplets", () => {
  it("groups consecutive thought→action→observation into triplets", () => {
    const steps = [
      makeStep("thought", "Search for data"),
      makeStep("action", JSON.stringify({ tool: "web-search", input: '{"q":"test"}' })),
      makeStep("observation", "Found 3 results", {
        toolUsed: "web-search",
        observationResult: { success: true, toolName: "web-search", resultKind: "data" },
      }),
      makeStep("thought", "Now write to file"),
      makeStep("action", JSON.stringify({ tool: "file-write", input: '{"path":"out.txt"}' })),
      makeStep("observation", "File written successfully", {
        toolUsed: "file-write",
        observationResult: { success: true, toolName: "file-write", resultKind: "data" },
      }),
    ];

    const result = summarizeStepsTriplets(steps as any);
    expect(result.length).toBe(2);
    expect(result[0]).toContain("web-search");
    expect(result[1]).toContain("file-write");
  });

  it("handles action→observation pairs (missing thought)", () => {
    const steps = [
      makeStep("action", JSON.stringify({ tool: "calc", input: '{"expr":"2+2"}' })),
      makeStep("observation", "4", {
        toolUsed: "calc",
        observationResult: { success: true, toolName: "calc", resultKind: "data" },
      }),
    ];

    const result = summarizeStepsTriplets(steps as any);
    expect(result.length).toBe(1);
    expect(result[0]).toContain("calc");
    expect(result[0]).toContain("→");
  });

  it("handles orphan steps individually", () => {
    const steps = [
      makeStep("thought", "I'm thinking about this."),
      makeStep("thought", "Another thought."),
    ];

    const result = summarizeStepsTriplets(steps as any);
    expect(result.length).toBe(2);
  });

  it("handles mixed triplets and orphans", () => {
    const steps = [
      makeStep("thought", "Planning"),
      makeStep("thought", "Searching for info"),
      makeStep("action", JSON.stringify({ tool: "search", input: "{}" })),
      makeStep("observation", "Results found", {
        toolUsed: "search",
        observationResult: { success: true, toolName: "search", resultKind: "data" },
      }),
    ];

    const result = summarizeStepsTriplets(steps as any);
    // First thought is orphan, then thought→action→obs triplet
    expect(result.length).toBe(2);
  });

  it("produces fewer lines than individual summarization for triplet sequences", () => {
    const steps = Array.from({ length: 9 }, (_, i) => {
      const mod = i % 3;
      if (mod === 0) return makeStep("thought", `Thinking about step ${i / 3}`);
      if (mod === 1) return makeStep("action", JSON.stringify({ tool: `tool-${Math.floor(i / 3)}`, input: "{}" }));
      return makeStep("observation", `Result ${Math.floor(i / 3)}`, {
        toolUsed: `tool-${Math.floor(i / 3)}`,
        observationResult: { success: true, toolName: `tool-${Math.floor(i / 3)}`, resultKind: "data" },
      });
    });

    const tripletLines = summarizeStepsTriplets(steps as any);
    // 9 steps should collapse to 3 triplet lines (67% reduction)
    expect(tripletLines.length).toBe(3);
    expect(tripletLines.length).toBeLessThan(steps.length);
  });
});

// ── summarizeStepForContext (improved) ──────────────────────────────────────

describe("summarizeStepForContext (improved)", () => {
  it("extracts key findings from JSON observations", () => {
    const step = makeStep("observation", JSON.stringify({ status: "ok", count: 42 }), {
      toolUsed: "api-check",
    });
    const result = summarizeStepForContext(step as any);
    expect(result).toContain("api-check:");
    expect(result).toContain("status=ok");
  });

  it("extracts decisions from thoughts", () => {
    const step = makeStep("thought",
      "There are many options available. I should use the web-search tool to find the answer. This will be efficient.");
    const result = summarizeStepForContext(step as any);
    expect(result).toContain("web-search");
    expect(result.length).toBeLessThan(150);
  });

  it("keeps actions compact", () => {
    const step = makeStep("action", JSON.stringify({ tool: "file-read", input: '{"path":"/etc/hosts"}' }));
    const result = summarizeStepForContext(step as any);
    expect(result).toBe("Action: file-read");
  });
});
