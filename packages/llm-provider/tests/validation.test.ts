import { describe, it, expect } from "bun:test";
import { validateAndRepairMessages } from "../src/validation.js";

describe("validateAndRepairMessages", () => {
  it("replaces empty user content with ellipsis", () => {
    const msgs = [{ role: "user" as const, content: "" }];
    const result = validateAndRepairMessages(msgs);
    expect((result[0] as any).content).toBe("...");
  });

  it("removes orphaned tool_result with no prior tool_call", () => {
    const msgs = [
      { role: "user" as const, content: "hello" },
      { role: "tool" as const, content: "result", toolCallId: "missing-id" } as any,
    ];
    const result = validateAndRepairMessages(msgs);
    expect(result.length).toBe(1);
  });

  it("keeps valid tool_result with matching tool_call", () => {
    const msgs = [
      { role: "user" as const, content: "hello" },
      { role: "assistant" as const, content: "", tool_calls: [{ id: "tc1", type: "function", function: { name: "test", arguments: "{}" } }] } as any,
      { role: "tool" as const, content: "result", tool_call_id: "tc1" } as any,
    ];
    const result = validateAndRepairMessages(msgs);
    expect(result.length).toBe(3);
  });

  it("passes valid conversation unchanged", () => {
    const msgs = [
      { role: "user" as const, content: "What is AI?" },
      { role: "assistant" as const, content: "AI is..." },
    ];
    const result = validateAndRepairMessages(msgs);
    expect(result).toEqual(msgs);
  });

  it("handles empty messages array", () => {
    expect(validateAndRepairMessages([])).toEqual([]);
  });
});
