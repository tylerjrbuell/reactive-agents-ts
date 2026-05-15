import { describe, it, expect } from "bun:test";
import {
  formatObservationMessage,
  type ToolCallRecord,
} from "../code-action-observe.js";

describe("formatObservationMessage", () => {
  it("includes tool call names in the observation", () => {
    const toolCalls: ToolCallRecord[] = [
      { name: "add", args: { a: 1, b: 2 }, result: 3 },
      { name: "multiply", args: { a: 3, b: 4 }, result: 12 },
    ];
    const msg = formatObservationMessage(toolCalls, 42);
    expect(msg).toContain("add");
    expect(msg).toContain("multiply");
  });

  it("includes the final result in the observation", () => {
    const msg = formatObservationMessage([], "hello world");
    expect(msg).toContain("hello world");
  });

  it("handles zero tool calls gracefully", () => {
    const msg = formatObservationMessage([], 99);
    expect(msg).toContain("99");
  });

  it("formats args and result for each tool call", () => {
    const toolCalls: ToolCallRecord[] = [
      { name: "search", args: { query: "foo" }, result: "bar" },
    ];
    const msg = formatObservationMessage(toolCalls, "bar");
    expect(msg).toContain('"query"');
    expect(msg).toContain("bar");
  });
});
