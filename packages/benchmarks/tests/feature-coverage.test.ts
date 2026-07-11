// Run: bun test packages/benchmarks/tests/feature-coverage.test.ts
//
// "Does the bench actually test the framework?"
//
// Audited 2026-07-09: the builder declares 90 `with*`/`without*` methods; the
// bench runner could toggle 10. Nothing detected that, and nothing stopped it
// growing — a new capability could ship with zero benchmark coverage forever and
// the suite would stay green. A benchmark blind to most of the harness cannot
// answer "are the agents getting more capable".
//
// This test reads REAL SOURCE (`runtime/src/builder.ts`, `benchmarks/src/runner.ts`)
// rather than trusting a hand-maintained list, and enforces:
//
//   1. DRIFT   — every builder method is classified in FEATURE_MATRIX, both ways.
//                A new `withX()` fails until someone decides what it is.
//   2. WIRING  — a feature claimed as `covered` has a real `builder.withX(` call
//                site in runner.ts. Claiming coverage without wiring fails.
//   3. RATCHET — uncovered capability count may only DECREASE.
//
// (3) is the honest form of progress here: wiring 38 features at once would be a
// lie dressed as a milestone. A monotonically shrinking gap cannot be faked.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FEATURE_MATRIX,
  UNCOVERED_CAPABILITY_CEILING,
  coveredCapabilityFeatures,
  uncoveredCapabilityFeatures,
} from "../src/feature-matrix.js";

const REPO = join(import.meta.dir, "..", "..", "..");
const BUILDER_SRC = join(REPO, "packages", "runtime", "src", "builder.ts");
const RUNNER_SRC = join(REPO, "packages", "benchmarks", "src", "runner.ts");

/**
 * Every `with*`/`without*` method DECLARED on the builder (4-space class indent).
 *
 * The optional `<...>` clause matches generic methods (e.g.
 * `withOutputSchema<A>(`). Without it the regex silently skipped every generic
 * method, so `withOutputSchema` escaped classification entirely (G2 drift-test
 * hole). The prototype-reflection guard (`builder-methods.test.ts`) saw it, but
 * this source-regex gate did not.
 */
function declaredBuilderMethods(): readonly string[] {
  const src = readFileSync(BUILDER_SRC, "utf8");
  const found = new Set<string>();
  for (const m of src.matchAll(/^ {4}(with(?:out)?[A-Za-z0-9]+)(?:<[^>]*>)?\(/gm)) {
    found.add(m[1]!);
  }
  return [...found].sort();
}

/** Every builder method the bench runner actually CALLS. */
function runnerToggledMethods(): ReadonlySet<string> {
  const src = readFileSync(RUNNER_SRC, "utf8");
  const found = new Set<string>();
  for (const m of src.matchAll(/builder\.(with(?:out)?[A-Za-z0-9]+)\(/g)) {
    found.add(m[1]!);
  }
  return found;
}

describe("the builder surface cannot drift away from the bench's knowledge of it", () => {
  it("finds a real, non-trivial builder surface (the regex cannot silently match nothing)", () => {
    // Guards the guard: if the class indentation changes, this test must not
    // pass vacuously by 'discovering' zero methods.
    const methods = declaredBuilderMethods();
    expect(methods.length).toBeGreaterThan(50);
    expect(methods).toContain("withTools");
    expect(methods).toContain("withGrounding");
  });

  it("every builder method is classified in FEATURE_MATRIX", () => {
    const unclassified = declaredBuilderMethods().filter((m) => !(m in FEATURE_MATRIX));
    expect(unclassified).toEqual([]);
  });

  it("FEATURE_MATRIX names no method the builder does not declare", () => {
    const declared = new Set(declaredBuilderMethods());
    const phantom = Object.keys(FEATURE_MATRIX).filter((m) => !declared.has(m));
    expect(phantom).toEqual([]);
  });

  it("every uncovered capability feature carries a reason (no silent gaps)", () => {
    const reasonless = Object.entries(FEATURE_MATRIX)
      .filter(([, e]) => e.featureClass === "capability" && e.gapReason === "")
      .map(([n]) => n);
    expect(reasonless).toEqual([]);
  });
});

describe("a feature claimed as covered must actually be wired into the runner", () => {
  it("every covered capability feature has a builder.<method>( call in runner.ts", () => {
    const toggled = runnerToggledMethods();
    const claimedButUnwired = coveredCapabilityFeatures().filter((f) => !toggled.has(f));
    // This is the anti-lie clause: marking a feature `covered` in the matrix
    // without a call site in runner.ts fails here.
    expect(claimedButUnwired).toEqual([]);
  });

  it("the runner's toggles are all classified as capability (it should not toggle plumbing to fake coverage)", () => {
    const toggled = [...runnerToggledMethods()];
    const plumbingToggles = toggled.filter(
      (m) => FEATURE_MATRIX[m]?.featureClass === "plumbing" && m !== "withTracing",
    );
    // withTracing is the sanctioned exception: the runner enables it to capture
    // traces, not to exercise a capability.
    expect(plumbingToggles).toEqual([]);
  });
});

describe("the coverage gap is a RATCHET — it may only shrink", () => {
  it("uncovered capability count is at or below the recorded ceiling", () => {
    const uncovered = uncoveredCapabilityFeatures();
    // If this fails UPWARD, a new capability shipped that the bench cannot see.
    // Wire it, or reclassify it as plumbing with a justification in review.
    expect(uncovered.length).toBeLessThanOrEqual(UNCOVERED_CAPABILITY_CEILING);
  });

  it("the ceiling is not stale — lower it when features get wired", () => {
    // Keeps the ratchet honest: once the real gap drops below the ceiling, this
    // fails and forces the constant down, so the ceiling can never drift into
    // meaninglessness the way a permanently-generous bound would.
    const uncovered = uncoveredCapabilityFeatures();
    expect(uncovered.length).toBe(UNCOVERED_CAPABILITY_CEILING);
  });
});
