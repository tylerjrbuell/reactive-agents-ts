// task-horizon.test.ts — the horizon axis (audit 04-#8, first upward gear).
import { describe, expect, it } from "bun:test";
import { classifyHorizon, classifyTaskHorizon } from "../../../../src/kernel/capabilities/comprehend/task-horizon.js";
import { classifyTask } from "../../../../src/kernel/capabilities/comprehend/task-classification.js";

describe("classifyTaskHorizon", () => {
  it("classifies an explicit long-running research task as long", () => {
    const task =
      "You are conducting a multi-source research investigation. Answer ALL SIX questions below. " +
      "This is a long task: plan your searches. Q1: ... Q2: ... Q3: ... Q4: ... Q5: ... Q6: ...";
    expect(classifyTaskHorizon(task).horizon).toBe("long");
  });

  it("classifies a 5-phase pipeline build as long (multi-phase)", () => {
    const task =
      "Complete all 5 phases in order. Phase 1 ... Phase 2 ... Phase 3 ... Phase 4 ... Phase 5 ...";
    expect(classifyTaskHorizon(task).horizon).toBe("long");
  });

  it("classifies a bare Q&A / trivial task as short", () => {
    expect(classifyHorizon("What is the capital of France?")).toBe("short");
    expect(classifyHorizon("Analyze sales.csv and write report.md.")).toBe("short");
  });

  it("is deterministic", () => {
    const t = "This is a long task with many steps.";
    expect(classifyTaskHorizon(t)).toEqual(classifyTaskHorizon(t));
  });
});

describe("classifyTask — horizon is additive (existing fields unchanged)", () => {
  it("carries the horizon axis without disturbing complexity/intent/shape", () => {
    const c = classifyTask("What is 17 × 23?");
    // The pre-existing axes keep their exact prior verdicts.
    expect(c.complexity.complexity).toBe("trivial");
    expect(c.shape.complexity).toBe("trivial");
    // The new axis is present and short for a trivial task.
    expect(c.horizon.horizon).toBe("short");
  });
});
