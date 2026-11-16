// Run: bun run repo test apps/cortex/server/tests/chat-plan-tools.test.ts
//
// Tool hints on a chat plan's steps follow the framework's checklist rules (`planStepToolHint`,
// the `tool` op), not a Cortex copy of them.
import { describe, expect, it } from "bun:test";
import { resolveStepTools, withTitleToolHints } from "../services/chat-plan-tools.js";
import { planOfStored } from "../services/chat-session-plan.js";

describe("resolveStepTools", () => {
  it("an explicit tool wins over the one a title names", () => {
    expect(resolveStepTools([{ title: "Search tool: web-search", tool: "http-get" }])).toEqual([{ title: "Search tool: web-search", tool: "http-get" }]);
  });
  it("a step with no tool takes the hint its title names; a plain title has none", () => {
    expect(resolveStepTools([{ title: "Fetch the page tool: http-get" }, { title: "Summarise" }])).toEqual([
      { title: "Fetch the page tool: http-get", tool: "http-get" },
      { title: "Summarise" },
    ]);
  });
  it("a cleared tool (the dropdown's No tool) leaves none on a plain title and falls back on a marked one", () => {
    expect(resolveStepTools([{ id: "a", title: "Plain" }])).toEqual([{ id: "a", title: "Plain" }]);
    expect(resolveStepTools([{ id: "a", title: "Go tool: shell-execute" }])[0]?.tool).toBe("shell-execute");
  });
  it("keeps ids and status", () => {
    expect(resolveStepTools([{ id: "7", title: "x", status: "done", tool: "t" }])).toEqual([{ id: "7", title: "x", status: "done", tool: "t" }]);
  });
});

// Repro (2026-11-16): model-written steps saved before the framework derived hints showed an empty tool dropdown.
describe("legacy plan rows", () => {
  it("planOfStored derives a missing hint from the step title without rewriting the row", () => {
    const todo = [{ id: "1", title: "Read the file tool: file-read", status: "pending" as const }, { id: "2", title: "Think", status: "pending" as const }];
    const plan = planOfStored("s", todo, null);
    expect(plan?.steps.map((s) => s.tool)).toEqual(["file-read", undefined]);
    expect(todo[0]).not.toHaveProperty("tool");
  });
  it("withTitleToolHints fills a live plan's unhinted steps and keeps explicit ones", () => {
    const plan = withTitleToolHints({
      id: "p", goal: "", createdAt: 0, source: "model",
      steps: [{ id: "1", title: "A tool: web-search", status: "pending" }, { id: "2", title: "B tool: x", status: "pending", tool: "explicit" }],
    });
    expect(plan.steps.map((s) => s.tool)).toEqual(["web-search", "explicit"]);
  });
});
