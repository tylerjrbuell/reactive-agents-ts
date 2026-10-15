// Run: bun test packages/reasoning/src/kernel/capabilities/verify/derive-s3-listmode.test.ts
//
// GH #251: the contract compiler minted task INPUT files as deliverables via
// the listMode fallback. S3 task shape — "there are two files, sales-q1.txt
// and sales-q2.txt ... Read both files. Then write a file named report.md"
// — derived ["./sales-q1.txt", "./sales-q2.txt", "./report.md"]; only
// "./report.md" is produced this run. The forward "Read both files"
// disambiguator was never consulted (arbitration is backward-only) and the
// singular "write a file" still trips DELIVERABLE_LIST_INTRO.
//
// RED-ON-CUT: restore `admit = listMode` and the S3 case yields 3 paths.
import { describe, expect, it } from "bun:test";
import { deriveDeliverablePaths } from "./derive-conditions.js";

const S3_TASK =
  "In the current directory there are two files, sales-q1.txt and sales-q2.txt, " +
  "containing quarterly sales data. Read both files. Then write a file named " +
  "report.md that summarizes total sales.";

describe("GH #251 — task inputs are not deliverables", () => {
  it("S3 shape yields only the written report", () => {
    expect(deriveDeliverablePaths(S3_TASK)).toEqual(["./report.md"]);
  });

  it("forward read-verb veto: verb-free listed inputs consumed by a later read are excluded", () => {
    // "Write" precedes the inputs (so a before-only anchor is not enough to
    // exclude them); the forward "read" is what marks them as inputs.
    const task =
      "Write a summary of the data. The source files data-a.txt and data-b.txt " +
      "must be read first, then save the summary to summary.md.";
    expect(deriveDeliverablePaths(task)).toEqual(["./summary.md"]);
  });

  it("NO REGRESSION: genuine write-anchored lists still admit every file", () => {
    expect(
      deriveDeliverablePaths("Write three files: alpha.txt, beta.txt and gamma.txt."),
    ).toEqual(["./alpha.txt", "./beta.txt", "./gamma.txt"]);
  });
});
