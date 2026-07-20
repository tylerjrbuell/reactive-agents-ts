// Run: bun test packages/trace/tests/run-context-correlation.test.ts --timeout 15000
import { describe, expect, it } from "bun:test";
import { childContext, rootContext } from "@reactive-agents/core";
import { traceBaseFrom } from "../src/events.js";

describe("trace correlation", () => {
  it("stamps the delegation tree onto the event base", () => {
    const root = rootContext("run-1", "agent-a");
    const child = childContext(root, "researcher", "call-7");

    const base = traceBaseFrom(child, 3, 12);

    expect(base.runId).toBe(child.runId);
    expect(base.rootRunId).toBe("run-1");
    expect(base.parentRunId).toBe("run-1");
    expect(base.depth).toBe(1);
    expect(base.iter).toBe(3);
    expect(base.seq).toBe(12);
    expect(typeof base.timestamp).toBe("number");
  });

  it("a root run's base has depth 0 and no parent", () => {
    const base = traceBaseFrom(rootContext("run-1", "agent-a"), 0, 0);
    expect(base.depth).toBe(0);
    expect(base.parentRunId).toBeUndefined();
    expect(base.rootRunId).toBe("run-1");
  });
});
