import { describe, it, expect } from "bun:test";
import { shouldTerminate, type ReflectInput } from "../code-action-reflect.js";

describe("shouldTerminate", () => {
  it("returns true when verifier verdict is PASS", () => {
    const input: ReflectInput = { verdict: "PASS", iteration: 1, maxIterations: 3 };
    expect(shouldTerminate(input)).toBe(true);
  });

  it("returns false when verifier verdict is FAIL and iterations remain", () => {
    const input: ReflectInput = { verdict: "FAIL", iteration: 1, maxIterations: 3 };
    expect(shouldTerminate(input)).toBe(false);
  });

  it("returns true when max iterations exhausted regardless of verdict", () => {
    const input: ReflectInput = { verdict: "FAIL", iteration: 3, maxIterations: 3 };
    expect(shouldTerminate(input)).toBe(true);
  });

  it("returns true at iteration 1 when maxIterations is 1", () => {
    const input: ReflectInput = { verdict: "FAIL", iteration: 1, maxIterations: 1 };
    expect(shouldTerminate(input)).toBe(true);
  });
});
