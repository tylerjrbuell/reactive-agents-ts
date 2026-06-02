// File: tests/contracts/task-contract.test.ts
import { describe, it, expect } from "bun:test";
import { toolsToExpose } from "../../src/contracts/task-contract.js";
import type {
  TaskContract,
  ToolRequirement,
  FixtureContract,
  SuccessCriterion,
} from "../../src/contracts/task-contract.js";

describe("TaskContract — typed task → tool requirements", () => {
  it("compiles a contract with explicit required tools", () => {
    const c: TaskContract = {
      prompt: "read report.md and summarize",
      tools: [{ kind: "required", name: "file-read" }],
      success: { type: "regex", pattern: "## Summary" },
    };
    expect(c.tools[0].kind).toBe("required");
    expect(c.tools[0].name).toBe("file-read");
  });

  it("supports the three ToolRequirement kinds (required / available / forbidden)", () => {
    const required: ToolRequirement = { kind: "required", name: "file-read" };
    const available: ToolRequirement = { kind: "available", name: "find" };
    const forbidden: ToolRequirement = { kind: "forbidden", name: "shell-execute" };
    const tools: readonly ToolRequirement[] = [required, available, forbidden];
    expect(tools.map((t) => t.kind)).toEqual(["required", "available", "forbidden"]);
  });

  it("accepts optional fixtures with file content", () => {
    const fixture: FixtureContract = {
      path: "report.md",
      content: "## Section 1\nbody",
    };
    const c: TaskContract = {
      prompt: "read report.md",
      tools: [{ kind: "required", name: "file-read" }],
      fixtures: [fixture],
      success: { type: "regex", pattern: "## Summary" },
    };
    expect(c.fixtures?.[0].path).toBe("report.md");
  });

  it("supports regex / llm-judge / predicate success criteria as a discriminated union", () => {
    const regex: SuccessCriterion = { type: "regex", pattern: "OK" };
    const judge: SuccessCriterion = {
      type: "llm-judge",
      rubric: "Score 1 if honest, 0 otherwise.",
      passThreshold: 1,
    };
    const predicate: SuccessCriterion = {
      type: "predicate",
      fn: (out) => out.includes("OK"),
    };
    expect(regex.type).toBe("regex");
    expect(judge.type).toBe("llm-judge");
    expect(predicate.type).toBe("predicate");
    if (predicate.type === "predicate") {
      expect(predicate.fn("OK")).toBe(true);
    }
  });

  it("accepts an optional modelFloor capability requirement", () => {
    const c: TaskContract = {
      prompt: "complex multi-step task",
      tools: [{ kind: "required", name: "shell-execute" }],
      modelFloor: { window: 32_768, nativeFC: true },
      success: { type: "regex", pattern: "done" },
    };
    expect(c.modelFloor?.window).toBe(32_768);
    expect(c.modelFloor?.nativeFC).toBe(true);
  });

  it("accepts an optional outputShape declaration", () => {
    const c: TaskContract = {
      prompt: "render markdown report",
      tools: [],
      success: { type: "regex", pattern: "## " },
      outputShape: { format: "markdown", mustInclude: ["## Summary"] },
    };
    expect(c.outputShape?.format).toBe("markdown");
    expect(c.outputShape?.mustInclude).toEqual(["## Summary"]);
  });
});

describe("toolsToExpose — bridge to bench runner withTools()", () => {
  it("returns required + available tool names (forbidden excluded)", () => {
    const c: TaskContract = {
      prompt: "task",
      tools: [
        { kind: "required", name: "file-read" },
        { kind: "available", name: "find" },
        { kind: "forbidden", name: "shell-execute" },
      ],
      success: { type: "regex", pattern: "x" },
    };
    expect(toolsToExpose(c).sort()).toEqual(["file-read", "find"]);
  });

  it("auto-adds file-read when fixtures are declared and no explicit file-read", () => {
    const c: TaskContract = {
      prompt: "task",
      tools: [],
      fixtures: [{ path: "report.md", content: "x" }],
      success: { type: "regex", pattern: "x" },
    };
    expect(toolsToExpose(c)).toEqual(["file-read"]);
  });

  it("does not double-add file-read when caller already declared it", () => {
    const c: TaskContract = {
      prompt: "task",
      tools: [{ kind: "required", name: "file-read" }],
      fixtures: [{ path: "report.md", content: "x" }],
      success: { type: "regex", pattern: "x" },
    };
    expect(toolsToExpose(c)).toEqual(["file-read"]);
  });

  it("returns an empty list when no fixtures and no tools declared", () => {
    const c: TaskContract = {
      prompt: "trivial task",
      tools: [],
      success: { type: "regex", pattern: "x" },
    };
    expect(toolsToExpose(c)).toEqual([]);
  });
});
