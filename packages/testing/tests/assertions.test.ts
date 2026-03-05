import { describe, test, expect } from "bun:test";
import {
  assertToolCalled,
  assertStepCount,
  assertCostUnder,
} from "../src/helpers/assertions.js";
import type { CapturedToolCall } from "../src/types.js";

const makeCalls = (...names: string[]): CapturedToolCall[] =>
  names.map((toolName) => ({
    toolName,
    arguments: {},
    timestamp: Date.now(),
  }));

// ─── assertToolCalled ───────────────────────────────────────────────────────

describe("assertToolCalled", () => {
  test("passes when tool was called", () => {
    const calls = makeCalls("web-search", "file-read");
    expect(() => assertToolCalled(calls, "web-search")).not.toThrow();
  });

  test("throws when tool was never called", () => {
    const calls = makeCalls("file-read");
    expect(() => assertToolCalled(calls, "web-search")).toThrow(
      /never called/,
    );
  });

  test("checks exact count with times option", () => {
    const calls = makeCalls("web-search", "web-search", "file-read");

    expect(() =>
      assertToolCalled(calls, "web-search", { times: 2 }),
    ).not.toThrow();

    expect(() =>
      assertToolCalled(calls, "web-search", { times: 1 }),
    ).toThrow(/exactly 1/);

    expect(() =>
      assertToolCalled(calls, "web-search", { times: 3 }),
    ).toThrow(/exactly 3/);
  });

  test("checks min count", () => {
    const calls = makeCalls("web-search", "web-search");

    expect(() =>
      assertToolCalled(calls, "web-search", { min: 1 }),
    ).not.toThrow();

    expect(() =>
      assertToolCalled(calls, "web-search", { min: 2 }),
    ).not.toThrow();

    expect(() =>
      assertToolCalled(calls, "web-search", { min: 3 }),
    ).toThrow(/at least 3/);
  });

  test("checks max count", () => {
    const calls = makeCalls("web-search", "web-search", "web-search");

    expect(() =>
      assertToolCalled(calls, "web-search", { max: 3 }),
    ).not.toThrow();

    expect(() =>
      assertToolCalled(calls, "web-search", { max: 2 }),
    ).toThrow(/at most 2/);
  });
});

// ─── assertStepCount ────────────────────────────────────────────────────────

describe("assertStepCount", () => {
  test("checks exact count", () => {
    expect(() => assertStepCount(5, { exact: 5 })).not.toThrow();
    expect(() => assertStepCount(5, { exact: 3 })).toThrow(/exactly 3/);
  });

  test("checks min bound", () => {
    expect(() => assertStepCount(5, { min: 3 })).not.toThrow();
    expect(() => assertStepCount(5, { min: 5 })).not.toThrow();
    expect(() => assertStepCount(5, { min: 6 })).toThrow(/at least 6/);
  });

  test("checks max bound", () => {
    expect(() => assertStepCount(5, { max: 10 })).not.toThrow();
    expect(() => assertStepCount(5, { max: 5 })).not.toThrow();
    expect(() => assertStepCount(5, { max: 4 })).toThrow(/at most 4/);
  });

  test("checks combined min and max", () => {
    expect(() => assertStepCount(5, { min: 3, max: 7 })).not.toThrow();
    expect(() => assertStepCount(2, { min: 3, max: 7 })).toThrow(
      /at least 3/,
    );
    expect(() => assertStepCount(10, { min: 3, max: 7 })).toThrow(
      /at most 7/,
    );
  });
});

// ─── assertCostUnder ────────────────────────────────────────────────────────

describe("assertCostUnder", () => {
  test("passes when cost is under threshold", () => {
    expect(() => assertCostUnder(0.001, 0.01)).not.toThrow();
  });

  test("passes when cost equals threshold", () => {
    expect(() => assertCostUnder(0.01, 0.01)).not.toThrow();
  });

  test("throws when cost exceeds threshold", () => {
    expect(() => assertCostUnder(0.05, 0.01)).toThrow(/under \$0\.01/);
  });

  test("works with zero cost", () => {
    expect(() => assertCostUnder(0, 0.01)).not.toThrow();
  });
});
