// File: tests/context/compaction.test.ts
import { describe, it, expect } from "bun:test";
import { ulid } from "ulid";
import type { ReasoningStep } from "../../src/types/step.js";
import type { StepId } from "../../src/types/step.js";
import type { ObservationResult } from "../../src/types/observation.js";
import {
  formatStepFull,
  formatStepSummary,
  shouldPreserve,
  clearOldToolResults,
  groupToolSequences,
  progressiveSummarize,
} from "../../src/context/compaction.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";
import { allocateBudget } from "../../src/context/context-budget.js";

// ─── Helpers ───

const step = (
  type: ReasoningStep["type"],
  content: string,
  metadata?: ReasoningStep["metadata"],
): ReasoningStep => ({
  id: ulid() as StepId,
  type,
  content,
  timestamp: new Date(),
  metadata,
});

const obsResult = (overrides: Partial<ObservationResult> = {}): ObservationResult => ({
  success: true,
  toolName: "file-read",
  displayText: "read data",
  category: "file-read",
  resultKind: "data",
  preserveOnCompaction: false,
  ...overrides,
});

// ─── Tests ───

describe("formatStepFull", () => {
  it("formats observations with Observation: prefix", () => {
    expect(formatStepFull(step("observation", "file contents here"))).toBe(
      "Observation: file contents here",
    );
  });

  it("formats actions with tool name", () => {
    const s = step("action", JSON.stringify({ tool: "file-read", input: '{"path":"x"}' }));
    expect(formatStepFull(s)).toContain("Action: file-read");
  });

  it("renders thoughts as-is", () => {
    expect(formatStepFull(step("thought", "I need to think"))).toBe("I need to think");
  });
});

describe("formatStepSummary", () => {
  it("truncates long steps to 120 chars + ellipsis", () => {
    const s = step("thought", "x".repeat(200));
    const summary = formatStepSummary(s);
    expect(summary.length).toBeLessThanOrEqual(123);
    expect(summary).toContain("...");
  });

  it("keeps short steps intact", () => {
    const s = step("thought", "short thought");
    expect(formatStepSummary(s)).toBe("short thought");
  });
});

describe("shouldPreserve", () => {
  it("preserves error observations", () => {
    const s = step("observation", "error", {
      observationResult: obsResult({ success: false, resultKind: "error" }),
    });
    expect(shouldPreserve(s)).toBe(true);
  });

  it("preserves steps with preserveOnCompaction flag", () => {
    const s = step("observation", "important", {
      observationResult: obsResult({ preserveOnCompaction: true }),
    });
    expect(shouldPreserve(s)).toBe(true);
  });

  it("does not preserve regular data observations", () => {
    const s = step("observation", "data", {
      observationResult: obsResult(),
    });
    expect(shouldPreserve(s)).toBe(false);
  });

  it("does not preserve non-observation steps", () => {
    expect(shouldPreserve(step("thought", "think"))).toBe(false);
    expect(shouldPreserve(step("action", "act"))).toBe(false);
  });
});

describe("clearOldToolResults", () => {
  it("replaces old data observations with summaries", () => {
    const steps = [
      step("action", JSON.stringify({ tool: "file-read" }), { toolUsed: "file-read" }),
      step("observation", "x".repeat(500), {
        observationResult: obsResult({ toolName: "file-read", resultKind: "data" }),
      }),
      step("thought", "final thought"),
    ];

    const cleared = clearOldToolResults(steps, 2);
    expect(cleared[1]!.content).toContain("[file-read: data received");
    expect(cleared[1]!.content.length).toBeLessThan(100);
    // Step at index 2 (at cutoff) should be unchanged
    expect(cleared[2]!.content).toBe("final thought");
  });

  it("preserves error observations", () => {
    const steps = [
      step("observation", "error details", {
        observationResult: obsResult({ success: false, resultKind: "error" }),
      }),
    ];
    const cleared = clearOldToolResults(steps, 1);
    expect(cleared[0]!.content).toBe("error details"); // unchanged
  });

  it("preserves side-effect observations", () => {
    const steps = [
      step("observation", "Written to ./out.md", {
        observationResult: obsResult({ resultKind: "side-effect", toolName: "file-write" }),
      }),
    ];
    const cleared = clearOldToolResults(steps, 1);
    expect(cleared[0]!.content).toBe("Written to ./out.md"); // unchanged
  });
});

describe("groupToolSequences", () => {
  it("groups actions into compact summary", () => {
    const steps = [
      step("action", '{"tool":"file-read"}', { toolUsed: "file-read" }),
      step("observation", "data"),
      step("action", '{"tool":"file-read"}', { toolUsed: "file-read" }),
      step("observation", "more data"),
      step("action", '{"tool":"web-search"}', { toolUsed: "web-search" }),
      step("observation", "results"),
    ];

    const grouped = groupToolSequences(steps);
    expect(grouped).toContain("file-read x2");
    expect(grouped).toContain("web-search x1");
  });

  it("returns empty string when no actions", () => {
    const steps = [step("thought", "thinking"), step("observation", "obs")];
    expect(groupToolSequences(steps)).toBe("");
  });
});

describe("progressiveSummarize", () => {
  const profile = CONTEXT_PROFILES.mid; // compactAfterSteps: 6, fullDetailSteps: 4

  it("returns full detail when under threshold", () => {
    const steps = [step("thought", "think"), step("action", '{"tool":"echo"}')];
    const result = progressiveSummarize("Context:", steps, profile);
    expect(result).toContain("think");
    expect(result).not.toContain("summary");
  });

  it("compacts old steps when over threshold", () => {
    const manySteps = Array.from({ length: 10 }, (_, i) =>
      step("thought", `Step ${i}: thinking about ${i}`),
    );
    const result = progressiveSummarize("Context:", manySteps, profile);
    expect(result).toContain("[Recent steps]");
    expect(result).toContain("[Earlier steps summary");
  });

  it("uses profile thresholds for compaction boundaries", () => {
    const localProfile = CONTEXT_PROFILES.local; // compactAfterSteps: 5, fullDetailSteps: 3
    const steps = Array.from({ length: 6 }, (_, i) => step("thought", `Step ${i}`));
    const result = progressiveSummarize("Ctx:", steps, localProfile);
    // With local profile (compactAfterSteps=5), 6 steps should trigger compaction
    expect(result).toContain("[Recent steps]");
  });

  it("frontier profile allows more steps before compaction", () => {
    const frontierProfile = CONTEXT_PROFILES.frontier; // compactAfterSteps: 12
    const steps = Array.from({ length: 10 }, (_, i) => step("thought", `Step ${i}`));
    const result = progressiveSummarize("Ctx:", steps, frontierProfile);
    // 10 steps < 12 threshold, should NOT compact
    expect(result).not.toContain("[Recent steps]");
  });

  it("handles budget pressure with Level 4 compaction", () => {
    const manySteps = Array.from({ length: 15 }, (_, i) =>
      step("thought", `Step ${i}: ${"x".repeat(100)}`),
    );
    // Create a tight budget where remaining < 20% of total
    const budget = {
      totalBudget: 1000,
      reserveOutput: 200,
      allocated: { systemPrompt: 50, toolSchemas: 50, memoryContext: 100, stepHistory: 400, rules: 50 },
      used: { systemPrompt: 50, toolSchemas: 50, memoryContext: 100, stepHistory: 350, rules: 50 },
      remaining: 50, // < 200 (20% of 1000) → budget pressure
    };
    const result = progressiveSummarize("Ctx:", manySteps, profile, budget);
    expect(result).toContain("details dropped");
  });
});
