import { describe, it, expect } from "bun:test";
import {
  heuristicClassify,
  parseStrategySelection,
} from "../../src/strategies/adaptive.js";
import { classifyTask } from "../../src/kernel/capabilities/comprehend/task-classification.js";
import { defaultReasoningConfig } from "../../src/types/config.js";

const inp = (taskDescription: string, tools: string[] = ["file-write", "file-read"]) => ({
  taskDescription,
  taskType: "task",
  memoryContext: "",
  availableTools: tools,
  config: defaultReasoningConfig,
});

const route = (task: string, tools?: string[]) =>
  heuristicClassify(inp(task, tools), classifyTask(task));

describe("adaptive routing → blueprint (static-decomposable domain)", () => {
  it("routes static local multi-artifact generation → blueprint", () => {
    expect(
      route(
        "Generate a TypeScript types file, a data generator module, and a validator function across multiple files for the schema.",
      ),
    ).toBe("blueprint");
  });

  it("does NOT route network/fetch tasks to blueprint (failure-prone → plan-execute/reactive)", () => {
    const r = route(
      "Fetch the latest prices for three tokens from the price API and write a summary report file.",
    );
    expect(r).not.toBe("blueprint");
  });

  it("does NOT route observation-driven tasks to blueprint (need mid-course adaptation)", () => {
    const r = route(
      "Debug the failing build: write tests to find the bugs and fix them until the suite passes.",
    );
    expect(r).not.toBe("blueprint");
  });

  it("static-gen with NO tools does not route to blueprint", () => {
    const r = route(
      "Generate several example components and modules for a tutorial article.",
      [],
    );
    expect(r).not.toBe("blueprint");
  });

  it("preserves existing routes (compare→ToT, no regression)", () => {
    expect(
      route(
        "Compare alternative approaches to state management in React: Redux vs Zustand vs Context API. Explore the trade-offs of each option in depth.",
        [],
      ),
    ).toBe("tree-of-thought");
  });
});

describe("parseStrategySelection recognizes BLUEPRINT", () => {
  it("BLUEPRINT → blueprint (before PLAN_EXECUTE)", () => {
    expect(parseStrategySelection("I recommend BLUEPRINT")).toBe("blueprint");
  });
  it("PLAN_EXECUTE still → plan-execute-reflect", () => {
    expect(parseStrategySelection("PLAN_EXECUTE")).toBe("plan-execute-reflect");
  });
  it("unknown → reactive", () => {
    expect(parseStrategySelection("hmm")).toBe("reactive");
  });
});
