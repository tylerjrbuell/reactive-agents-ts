// Run: bun test packages/benchmarks/tests/longhorizon-apply.test.ts --timeout 15000
//
// A4 — the bench runner auto-applies `.withLongHorizon()` for tasks tagged
// `horizon:long` (the lh-1 long-horizon instrument carries that tag) and leaves
// every other task untouched. The decision lives in the pure `shouldUseLongHorizon`
// predicate so it is unit-testable without spinning up a real agent build.
import { describe, test, expect } from "bun:test";
import { shouldUseLongHorizon } from "../src/runner.js";

describe("shouldUseLongHorizon", () => {
  test("true when tags include horizon:long", () => {
    expect(shouldUseLongHorizon({ tags: ["research", "horizon:long"] })).toBe(true);
  });

  test("false when horizon:long tag is absent", () => {
    expect(shouldUseLongHorizon({ tags: ["research", "multi-file-deliverable"] })).toBe(false);
  });

  test("false when a task carries no tags", () => {
    expect(shouldUseLongHorizon({})).toBe(false);
  });
});
