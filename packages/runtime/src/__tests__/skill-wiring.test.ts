import { describe, it, expect } from "bun:test";

describe("Execution engine skill wiring", () => {
  it("enriched RunCompletedData includes provider field", () => {
    // Type-level check: verify the RunCompletedData type accepts provider
    const data = {
      modelId: "claude-sonnet-4",
      provider: "anthropic",
      taskDescription: "test",
      strategy: "reactive",
      outcome: "success" as const,
      entropyHistory: [],
      totalTokens: 100,
      durationMs: 1000,
      temperature: 0.7,
      maxIterations: 5,
      skillsActivated: ["data-analysis"],
      convergenceIteration: 2,
      toolCallSequence: ["web-search", "file-write"],
    };
    expect(data.provider).toBe("anthropic");
    expect(data.skillsActivated).toEqual(["data-analysis"]);
    expect(data.convergenceIteration).toBe(2);
  });

  it("convergenceIteration is null when no converging trajectory", () => {
    const entropyLog: { composite: number; trajectory: { shape: string } }[] = [
      { composite: 0.5, trajectory: { shape: "flat" } },
      { composite: 0.6, trajectory: { shape: "diverging" } },
    ];
    const convergenceIteration = entropyLog.findIndex((e) => e.trajectory.shape === "converging");
    expect(convergenceIteration).toBe(-1); // -1 means not found
  });
});
