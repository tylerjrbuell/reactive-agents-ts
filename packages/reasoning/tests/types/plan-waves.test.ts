// File: tests/types/plan-waves.test.ts
import { describe, it, expect } from "bun:test";
import { extractDependencies, computeWaves } from "../../src/types/plan.js";
import type { PlanStep } from "../../src/types/plan.js";

const makeStep = (
  id: string,
  overrides: Partial<PlanStep> = {},
): PlanStep => ({
  id,
  seq: parseInt(id.replace("s", ""), 10),
  title: `Step ${id}`,
  instruction: `Do step ${id}`,
  type: "analysis",
  status: "pending",
  retries: 0,
  tokensUsed: 0,
  ...overrides,
});

describe("extractDependencies", () => {
  it("returns empty set for step with no deps", () => {
    const step = makeStep("s1");
    expect(extractDependencies(step).size).toBe(0);
  });

  it("extracts from dependsOn field", () => {
    const step = makeStep("s3", { dependsOn: ["s1", "s2"] });
    const deps = extractDependencies(step);
    expect(deps.has("s1")).toBe(true);
    expect(deps.has("s2")).toBe(true);
    expect(deps.size).toBe(2);
  });

  it("extracts from {{from_step:sN}} in toolArgs", () => {
    const step = makeStep("s2", {
      type: "tool_call",
      toolName: "write",
      toolArgs: { content: "Result: {{from_step:s1}}" },
    });
    const deps = extractDependencies(step);
    expect(deps.has("s1")).toBe(true);
  });

  it("extracts from {{from_step:sN:summary}} in instruction", () => {
    const step = makeStep("s3", {
      instruction: "Use {{from_step:s1:summary}} and {{from_step:s2}}",
    });
    const deps = extractDependencies(step);
    expect(deps.has("s1")).toBe(true);
    expect(deps.has("s2")).toBe(true);
    expect(deps.size).toBe(2);
  });

  it("deduplicates across dependsOn and references", () => {
    const step = makeStep("s3", {
      dependsOn: ["s1"],
      instruction: "Use {{from_step:s1}}",
    });
    const deps = extractDependencies(step);
    expect(deps.size).toBe(1);
  });
});

describe("computeWaves", () => {
  it("returns single wave for independent steps", () => {
    const steps = [makeStep("s1"), makeStep("s2"), makeStep("s3")];
    const waves = computeWaves(steps, new Set());
    expect(waves.length).toBe(1);
    expect(waves[0]!.length).toBe(3);
  });

  it("respects dependency ordering", () => {
    const steps = [
      makeStep("s1"),
      makeStep("s2", { dependsOn: ["s1"] }),
      makeStep("s3", { dependsOn: ["s2"] }),
    ];
    const waves = computeWaves(steps, new Set());
    expect(waves.length).toBe(3);
    expect(waves[0]!.map((s) => s.id)).toEqual(["s1"]);
    expect(waves[1]!.map((s) => s.id)).toEqual(["s2"]);
    expect(waves[2]!.map((s) => s.id)).toEqual(["s3"]);
  });

  it("parallelizes independent branches", () => {
    // s1 → s3, s2 → s3 (s1 and s2 can run in parallel)
    const steps = [
      makeStep("s1"),
      makeStep("s2"),
      makeStep("s3", { dependsOn: ["s1", "s2"] }),
    ];
    const waves = computeWaves(steps, new Set());
    expect(waves.length).toBe(2);
    expect(waves[0]!.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
    expect(waves[1]!.map((s) => s.id)).toEqual(["s3"]);
  });

  it("skips already-completed steps", () => {
    const steps = [
      makeStep("s1", { status: "completed" }),
      makeStep("s2", { dependsOn: ["s1"] }),
    ];
    const waves = computeWaves(steps, new Set(["s1"]));
    expect(waves.length).toBe(1);
    expect(waves[0]!.map((s) => s.id)).toEqual(["s2"]);
  });

  it("falls back to sequential on cycles", () => {
    const steps = [
      makeStep("s1", { dependsOn: ["s2"] }),
      makeStep("s2", { dependsOn: ["s1"] }),
    ];
    const waves = computeWaves(steps, new Set());
    // Cycle: no step can be scheduled → fallback dumps all remaining
    expect(waves.length).toBe(1);
    expect(waves[0]!.length).toBe(2);
  });

  it("handles {{from_step}} reference-based deps", () => {
    const steps = [
      makeStep("s1"),
      makeStep("s2", { instruction: "Use {{from_step:s1}}" }),
    ];
    const waves = computeWaves(steps, new Set());
    expect(waves.length).toBe(2);
    expect(waves[0]!.map((s) => s.id)).toEqual(["s1"]);
    expect(waves[1]!.map((s) => s.id)).toEqual(["s2"]);
  });

  it("returns empty for all-completed plan", () => {
    const steps = [
      makeStep("s1", { status: "completed" }),
      makeStep("s2", { status: "completed" }),
    ];
    const waves = computeWaves(steps, new Set(["s1", "s2"]));
    expect(waves.length).toBe(0);
  });
});
