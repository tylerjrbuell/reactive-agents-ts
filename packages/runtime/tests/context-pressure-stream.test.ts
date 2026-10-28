/**
 * Pins the bus -> public-stream projection of `ContextPressure`
 * (engine/context-pressure-stream.ts, wired in engine/execute-stream.ts, density "full").
 */
import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { toContextPressureStreamEvent } from "../src/engine/context-pressure-stream.js";

const bus = {
  _tag: "ContextPressure",
  taskId: "t1",
  tokensUsed: 1000,
  tokensAvailable: 3000,
  utilizationPct: 25,
  level: "low",
};

describe("toContextPressureStreamEvent", () => {
  test("matching taskId projects the gauge fields", () => {
    expect(toContextPressureStreamEvent(bus, "t1")).toEqual({
      _tag: "ContextPressure",
      tokensUsed: 1000,
      tokensAvailable: 3000,
      utilizationPct: 25,
      level: "low",
    });
  });
  test("carries iteration when present", () => {
    expect(toContextPressureStreamEvent({ ...bus, iteration: 2 }, "t1")).toMatchObject({ iteration: 2 });
  });
  test("other taskId or malformed payload yields nothing", () => {
    expect(toContextPressureStreamEvent(bus, "t2")).toBeUndefined();
    expect(toContextPressureStreamEvent({ ...bus, level: "bogus" }, "t1")).toBeUndefined();
    expect(toContextPressureStreamEvent({ ...bus, tokensUsed: "x" }, "t1")).toBeUndefined();
  });
  test("execute-stream subscribes only under density full", () => {
    const src = readFileSync(new URL("../src/engine/execute-stream.ts", import.meta.url), "utf8");
    expect(src).toMatch(/if \(eb && density === "full"\) \{\s*yield\* eb\s*\.on\("ContextPressure"/);
  });
});
