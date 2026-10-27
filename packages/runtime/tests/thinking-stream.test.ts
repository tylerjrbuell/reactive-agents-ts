/**
 * Pins the bus -> public-stream projection of `ThinkingEmitted`
 * (engine/thinking-stream.ts, wired in engine/execute-stream.ts, density "full").
 */
import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { toThinkingStreamEvent } from "../src/engine/thinking-stream.js";

describe("toThinkingStreamEvent", () => {
  test("matching taskId projects content/iteration/truncated", () => {
    expect(
      toThinkingStreamEvent(
        { _tag: "ThinkingEmitted", taskId: "t1", iteration: 3, content: "hmm", truncated: true },
        "t1",
      ),
    ).toEqual({ _tag: "ThinkingEmitted", content: "hmm", iteration: 3, truncated: true });
  });
  test("omits truncated when absent", () => {
    const out = toThinkingStreamEvent({ taskId: "t1", iteration: 1, content: "x" }, "t1");
    expect(out).toEqual({ _tag: "ThinkingEmitted", content: "x", iteration: 1 });
  });
  test("other taskId or empty content yields nothing", () => {
    expect(toThinkingStreamEvent({ taskId: "t2", iteration: 1, content: "x" }, "t1")).toBeUndefined();
    expect(toThinkingStreamEvent({ taskId: "t1", iteration: 1, content: "" }, "t1")).toBeUndefined();
  });
  test("execute-stream subscribes only under density full", () => {
    const src = readFileSync(new URL("../src/engine/execute-stream.ts", import.meta.url), "utf8");
    expect(src).toMatch(/if \(eb && density === "full"\) \{\s*yield\* eb\s*\.on\("ThinkingEmitted"/);
  });
});
