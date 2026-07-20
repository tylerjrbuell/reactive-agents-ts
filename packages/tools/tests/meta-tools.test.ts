import { describe, it, expect } from "bun:test";
import { Effect } from "effect";

import {
  contextStatusTool,
  makeContextStatusHandler,
  type ContextStatusState,
} from "../src/skills/context-status.js";

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
