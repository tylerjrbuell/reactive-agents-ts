import { describe, it, expect } from "bun:test";
import { classifyTaskPhase } from "../../src/context/task-phase.js";
import type { ReasoningStep } from "../../src/types/index.js";

describe("classifyTaskPhase", () => {
  it("returns 'orient' on iteration 0 with no tools used", () => {
    expect(
      classifyTaskPhase({
        iteration: 0,
        toolsUsed: new Set(),
        requiredTools: ["web-search", "file-write"],
        steps: [],
      }),
    ).toBe("orient");
  });

  it("returns 'orient' on iteration 1 with no tools used", () => {
    expect(
      classifyTaskPhase({
        iteration: 1,
        toolsUsed: new Set(),
        requiredTools: ["web-search"],
        steps: [],
      }),
    ).toBe("orient");
  });

  it("returns 'gather' when required tools remain and no write yet", () => {
    expect(
      classifyTaskPhase({
        iteration: 2,
        toolsUsed: new Set(["web-search"]),
        requiredTools: ["web-search", "file-write"],
        steps: [],
      }),
    ).toBe("gather");
  });

  it("returns 'synthesize' when all required tools called but no output written", () => {
    expect(
      classifyTaskPhase({
        iteration: 3,
        toolsUsed: new Set(["web-search", "file-write"]),
        requiredTools: ["web-search", "file-write"],
        steps: [],
      }),
    ).toBe("synthesize");
  });

  it("returns 'verify' when output has been written", () => {
    const stepsWithWrite: ReasoningStep[] = [
      {
        id: "s1",
        type: "observation",
        content: "✓ Written to ./report.md",
        timestamp: new Date(),
        metadata: {
          observationResult: {
            success: true,
            toolName: "file-write",
            displayText: "ok",
            category: "file-write",
            resultKind: "side-effect",
            preserveOnCompaction: false,
          },
          toolCall: { id: "tc-fw", name: "file-write", arguments: {} },
        },
      },
    ];
    expect(
      classifyTaskPhase({
        iteration: 4,
        toolsUsed: new Set(["web-search", "file-write"]),
        requiredTools: ["web-search", "file-write"],
        steps: stepsWithWrite,
      }),
    ).toBe("verify");
  });

  it("returns 'produce' when no required tools and no write", () => {
    expect(
      classifyTaskPhase({
        iteration: 2,
        toolsUsed: new Set(["web-search"]),
        requiredTools: [],
        steps: [],
      }),
    ).toBe("produce");
  });

  it("returns 'gather' when iteration > 1 but tools not started yet with requireds", () => {
    expect(
      classifyTaskPhase({
        iteration: 3,
        toolsUsed: new Set(),
        requiredTools: ["web-search"],
        steps: [],
      }),
    ).toBe("gather");
  });
});
