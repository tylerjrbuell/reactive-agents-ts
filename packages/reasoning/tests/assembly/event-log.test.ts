import { describe, it, expect } from "bun:test";
import { EventLog, type AgentEvent } from "../../src/assembly/event-log.js";

describe("EventLog — append-only single source", () => {
  it("appends events immutably and preserves order", () => {
    const log = new EventLog();
    const l2 = log.append({ kind: "goal", text: "do X" });
    const l3 = l2.append({ kind: "tool_called", tool: "list_commits", callId: "c1", args: {} });
    expect(log.events.length).toBe(0);        // original unchanged (immutable)
    expect(l3.events.length).toBe(2);
    expect(l3.events[0]!.kind).toBe("goal");
    expect(l3.events[1]!.kind).toBe("tool_called");
  });

  it("selects events by kind", () => {
    const log = new EventLog()
      .append({ kind: "goal", text: "g" })
      .append({ kind: "tool_result", callId: "c1", ref: "r1", shape: "Array(20)" });
    expect(log.byKind("tool_result").length).toBe(1);
    expect(log.byKind("thought").length).toBe(0);
  });
});
