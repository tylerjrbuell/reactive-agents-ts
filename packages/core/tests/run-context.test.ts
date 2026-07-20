// Run: bun test packages/core/tests/run-context.test.ts --timeout 15000
import { describe, expect, it } from "bun:test";
import { childContext, rootContext } from "../src/run-context.js";

describe("RunContext", () => {
  it("root context is its own root and has depth 0", () => {
    const root = rootContext("run-1", "agent-a");
    expect(root.runId).toBe("run-1");
    expect(root.rootRunId).toBe("run-1");
    expect(root.parentRunId).toBeUndefined();
    expect(root.parentAgentId).toBeUndefined();
    expect(root.depth).toBe(0);
  });

  it("child increments depth, keeps rootRunId, and links to parent", () => {
    const root = rootContext("run-1", "agent-a");
    const child = childContext(root, "researcher", "call-7");
    expect(child.depth).toBe(1);
    expect(child.rootRunId).toBe("run-1");
    expect(child.parentRunId).toBe("run-1");
    expect(child.parentAgentId).toBe("agent-a");
    expect(child.runId).not.toBe("run-1");
    expect(child.agentId).toBe("researcher");
    expect(child.spawnToolCallId).toBe("call-7");
  });

  it("grandchild keeps the ORIGINAL rootRunId and reaches depth 2", () => {
    const root = rootContext("run-1", "agent-a");
    const child = childContext(root, "researcher", "call-7");
    const grandchild = childContext(child, "sub-researcher", "call-9");
    expect(grandchild.depth).toBe(2);
    expect(grandchild.rootRunId).toBe("run-1");
    expect(grandchild.parentRunId).toBe(child.runId);
    expect(grandchild.parentAgentId).toBe("researcher");
  });

  it("contextOrFallback prefers the explicit value, then the ambient, then null", () => {
    const explicit = rootContext("run-x", "agent-x");
    const ambient = rootContext("run-y", "agent-y");
    // dynamic import to avoid tight coupling if signature changes
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { contextOrFallback } = require("../src/run-context.js");
    expect(contextOrFallback(explicit, ambient)).toBe(explicit);
    expect(contextOrFallback(undefined, ambient)).toBe(ambient);
    expect(contextOrFallback(undefined, null)).toBeNull();
  });
});
