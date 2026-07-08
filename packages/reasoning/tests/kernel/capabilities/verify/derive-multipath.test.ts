// derive-multipath.test.ts — the audit 01-F5 fix: deriveDeliverablePaths must
// catch ALL literal deliverable paths (multi-path), while the single-path
// deriveConditions stays byte-identical (asserted in derive-conditions.test.ts).
import { describe, expect, it } from "bun:test";
import { deriveDeliverablePaths } from "../../../../src/kernel/capabilities/verify/derive-conditions.js";

describe("deriveDeliverablePaths — multi-path (audit 01-F5)", () => {
  it("catches all THREE write-anchored files (rw-8 shape)", () => {
    const task =
      "Phase 2: Write a TypeScript type definition file (types.ts) for User, Order, Product\n" +
      "Phase 3: Write a data generator (generate.ts) that creates 5 sample records of each type\n" +
      "Phase 4: Write a validator (validate.ts) that checks all constraints are met\n" +
      "Phase 5: Run the validator against the generated data and report results";
    expect(deriveDeliverablePaths(task)).toEqual([
      "./types.ts",
      "./generate.ts",
      "./validate.ts",
    ]);
  });

  it("catches all THREE deliverable-list files (lh-1 shape)", () => {
    const task =
      "Produce THREE deliverable files in your working directory. The exact filenames and formats are REQUIRED:\n\n" +
      '1. findings.json — a JSON array with one object per question.\n' +
      '2. report.md — a Markdown report with one section per question.\n' +
      "3. sources.md — a Markdown list of EVERY source URL you cited in findings.json.";
    expect(deriveDeliverablePaths(task)).toEqual([
      "./findings.json",
      "./report.md",
      "./sources.md",
    ]);
  });

  it("does NOT derive read-side inputs (read-then-write)", () => {
    expect(deriveDeliverablePaths("Read ./in.md then write ./out.md")).toEqual([
      "./out.md",
    ]);
  });

  it("does NOT derive an analyzed input file (rw-2/rw-3 shape)", () => {
    // The analyzed CSV is an input; only the written report is a deliverable.
    expect(
      deriveDeliverablePaths(
        "Analyze employees.csv and write a report to report.md surfacing findings.",
      ),
    ).toEqual(["./report.md"]);
  });

  it("returns empty for a pure Q&A task (no deliverable paths)", () => {
    expect(deriveDeliverablePaths("Summarize the concept of recursion.")).toEqual([]);
  });

  it("is deterministic (same input → same output)", () => {
    const t =
      "Write a report to out.md and also save a summary to summary.md when done.";
    expect(deriveDeliverablePaths(t)).toEqual(deriveDeliverablePaths(t));
  });
});
