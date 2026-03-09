import { describe, it, expect } from "bun:test";
import { Effect } from "effect";

import {
  contextStatusTool,
  makeContextStatusHandler,
  type ContextStatusState,
} from "../src/skills/context-status.js";
import {
  taskCompleteTool,
  makeTaskCompleteHandler,
  shouldShowTaskComplete,
  type TaskCompleteState,
  type TaskCompleteVisibility,
} from "../src/skills/task-complete.js";

// ─── context-status tests ───

describe("context-status tool definition", () => {
  it("has the correct metadata", () => {
    expect(contextStatusTool.name).toBe("context-status");
    expect(contextStatusTool.parameters).toHaveLength(0);
    expect(contextStatusTool.riskLevel).toBe("low");
    expect(contextStatusTool.requiresApproval).toBe(false);
    expect(contextStatusTool.source).toBe("function");
  });
});

describe("makeContextStatusHandler", () => {
  it("returns correct state fields", async () => {
    const state: ContextStatusState = {
      iteration: 3,
      maxIterations: 10,
      toolsUsed: new Set(["file-write", "web-search"]),
      requiredTools: ["file-write", "web-search", "http-get"],
      storedKeys: ["plan", "findings"],
      tokensUsed: 450,
    };

    const handler = makeContextStatusHandler(state);
    const result = await Effect.runPromise(handler({}));

    const typed = result as Record<string, unknown>;
    expect(typed.iteration).toBe(3);
    expect(typed.maxIterations).toBe(10);
    expect(typed.remaining).toBe(7);
    expect(typed.toolsUsed).toEqual(expect.arrayContaining(["file-write", "web-search"]));
    expect(typed.storedKeys).toEqual(["plan", "findings"]);
    expect(typed.tokensUsed).toBe(450);
  });

  it("correctly identifies pending tools (required minus used)", async () => {
    const state: ContextStatusState = {
      iteration: 2,
      maxIterations: 8,
      toolsUsed: new Set(["file-write"]),
      requiredTools: ["file-write", "web-search", "http-get"],
    };

    const handler = makeContextStatusHandler(state);
    const result = await Effect.runPromise(handler({}));

    const typed = result as Record<string, unknown>;
    const pending = typed.toolsPending as string[];
    expect(pending).toHaveLength(2);
    expect(pending).toContain("web-search");
    expect(pending).toContain("http-get");
    expect(pending).not.toContain("file-write");
  });

  it("returns empty arrays when optional state fields are absent", async () => {
    const state: ContextStatusState = {
      iteration: 1,
      maxIterations: 5,
      toolsUsed: new Set(),
    };

    const handler = makeContextStatusHandler(state);
    const result = await Effect.runPromise(handler({}));

    const typed = result as Record<string, unknown>;
    expect(typed.toolsPending).toEqual([]);
    expect(typed.storedKeys).toEqual([]);
    expect(typed.tokensUsed).toBe(0);
  });
});

// ─── task-complete tests ───

describe("task-complete tool definition", () => {
  it("has the correct metadata", () => {
    expect(taskCompleteTool.name).toBe("task-complete");
    expect(taskCompleteTool.riskLevel).toBe("low");
    expect(taskCompleteTool.requiresApproval).toBe(false);
    expect(taskCompleteTool.source).toBe("function");

    const summaryParam = taskCompleteTool.parameters.find((p) => p.name === "summary");
    expect(summaryParam).toBeDefined();
    expect(summaryParam?.required).toBe(true);
    expect(summaryParam?.type).toBe("string");
  });
});

describe("shouldShowTaskComplete", () => {
  const baseInput: TaskCompleteVisibility = {
    requiredToolsCalled: new Set(["file-write", "web-search"]),
    requiredTools: ["file-write", "web-search"],
    iteration: 3,
    hasErrors: false,
    hasNonMetaToolCalled: true,
  };

  it("returns true when all conditions are met", () => {
    expect(shouldShowTaskComplete(baseInput)).toBe(true);
  });

  it("returns false when required tools are not all called", () => {
    const input: TaskCompleteVisibility = {
      ...baseInput,
      requiredToolsCalled: new Set(["file-write"]), // missing web-search
      requiredTools: ["file-write", "web-search"],
    };
    expect(shouldShowTaskComplete(input)).toBe(false);
  });

  it("returns false on iteration < 2", () => {
    expect(shouldShowTaskComplete({ ...baseInput, iteration: 1 })).toBe(false);
    expect(shouldShowTaskComplete({ ...baseInput, iteration: 0 })).toBe(false);
  });

  it("returns false when hasErrors is true", () => {
    expect(shouldShowTaskComplete({ ...baseInput, hasErrors: true })).toBe(false);
  });

  it("returns false when no non-meta tool has been called", () => {
    expect(shouldShowTaskComplete({ ...baseInput, hasNonMetaToolCalled: false })).toBe(false);
  });

  it("returns true when requiredTools is empty and other conditions are met", () => {
    const input: TaskCompleteVisibility = {
      requiredToolsCalled: new Set(),
      requiredTools: [],
      iteration: 2,
      hasErrors: false,
      hasNonMetaToolCalled: true,
    };
    expect(shouldShowTaskComplete(input)).toBe(true);
  });
});

describe("makeTaskCompleteHandler", () => {
  it("rejects with pending tool list when canComplete=false", async () => {
    const state: TaskCompleteState = {
      canComplete: false,
      pendingTools: ["web-search", "http-get"],
    };

    const handler = makeTaskCompleteHandler(state);
    const result = await Effect.runPromise(handler({ summary: "done" }));

    const typed = result as Record<string, unknown>;
    expect(typed.canComplete).toBe(false);
    expect(typed.error).toContain("web-search");
    expect(typed.error).toContain("http-get");
  });

  it("returns {completed: true, summary} when canComplete=true", async () => {
    const state: TaskCompleteState = {
      canComplete: true,
    };

    const handler = makeTaskCompleteHandler(state);
    const result = await Effect.runPromise(
      handler({ summary: "Wrote the report and searched the web." }),
    );

    const typed = result as Record<string, unknown>;
    expect(typed.completed).toBe(true);
    expect(typed.summary).toBe("Wrote the report and searched the web.");
  });
});
