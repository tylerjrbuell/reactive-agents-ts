// Run: bun test packages/reasoning/src/kernel/capabilities/verify/derive-source-input.test.ts
//
// A path the task names as the SOURCE of the data is an input, never a write
// deliverable (2026-11-06, lh-a0 baseline).
//
// Live witness — H3 lh-pipeline-stages, all 6 A0 traces:
//
//   "Stage 1: write clean.csv with header order_id,region,amount: every row
//    from the batches pipeline.json lists, ..."
//
// The nearest preceding verb of `pipeline.json` is "write" (its object is
// clean.csv), more than WRITE_ADJACENT_WINDOW away, and no read verb follows,
// so the distant-write branch admitted it. The bench runner absolutizes fixture
// paths in the prompt, and the "./" anchoring then minted
// `artifact:.//home/.../pipeline.json` — "produce the file .//home/.../pipeline.json".
// In run 01M6REXPKJXWABQ9WB081BTBCR the model obeyed and overwrote its own
// input manifest.
//
// Two fixes, both at the boundary:
//   1. a source preposition ("from <path>", nothing but plain words between)
//      anchors its path as an INPUT, exactly like a read verb;
//   2. an absolute path stays absolute: "./" anchors only relative paths.

import { describe, expect, it } from "bun:test";
import { compileRunContract } from "../../contract/run-contract.js";
import { deriveDeliverablePaths } from "./derive-conditions.js";

const BATCHES = ["a", "b", "c", "d", "e", "f", "g", "h"].map((b) => `batches/orders-${b}.csv`);

/** Frozen lh-pipeline-stages prompt (packages/benchmarks/src/h3/long-horizon-tasks.ts). */
const PIPELINE_PROMPT = `Run a three-stage data pipeline in your working directory. pipeline.json says which order batches to use, the minimum amount, and the duplicate policy. The batches are:
${BATCHES.map((b) => `- ${b}`).join("\n")}
Each batch is a CSV with columns order_id,region,amount.
Stage 1: write clean.csv with header order_id,region,amount: every row from the batches pipeline.json lists, in that order, keeping only the FIRST row for each order_id, then dropping rows whose amount is below the minimum.
Stage 2: write by-region.json from clean.csv: {"<region>": {"orders": <row count>, "total": <sum of amount>}}.
Stage 3: write report.md containing a line "Total revenue: <sum of all amounts in clean.csv, 2 decimals>" and a line "Top region: <region with the largest total>".
Each stage reads the previous stage's output; finish all three.`;

/** The same prompt as the bench runner sends it: fixture paths absolutized (run-internal.ts). */
const WORK_DIR = "/tmp/.bench-run-p9Qywf";
const PIPELINE_PROMPT_ABS = `Working directory for this task: ${WORK_DIR}\n\n${[
  "pipeline.json",
  ...BATCHES,
].reduce(
  (s, p) => s.replace(new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), `${WORK_DIR}/${p}`),
  PIPELINE_PROMPT,
)}`;

const EXPECTED = ["./clean.csv", "./by-region.json", "./report.md"];

describe("source-preposition inputs are never deliverables (lh-pipeline-stages)", () => {
  it("frozen prompt derives the three stage outputs and not pipeline.json", () => {
    expect(deriveDeliverablePaths(PIPELINE_PROMPT)).toEqual(EXPECTED);
  });

  it("absolutized prompt derives the same three outputs, no phantom input", () => {
    expect(PIPELINE_PROMPT_ABS).toContain(`from the batches ${WORK_DIR}/pipeline.json lists`);
    expect(deriveDeliverablePaths(PIPELINE_PROMPT_ABS)).toEqual(EXPECTED);
  });

  it("the compiled contract carries no requirement on the input manifest", () => {
    const ids = compileRunContract(PIPELINE_PROMPT_ABS).requirements.map((r) => r.id);
    expect(ids.filter((id) => id.includes("pipeline.json"))).toEqual([]);
    expect(ids.filter((id) => id.startsWith("artifact:"))).toEqual(EXPECTED.map((p) => `artifact:${p}`));
  });

  it("a source preposition only governs its own path: the write target after it still derives", () => {
    expect(deriveDeliverablePaths("Save the results from analysis.csv to summary.md.")).toEqual(["./summary.md"]);
    expect(deriveDeliverablePaths("Write report.md from the data in notes.txt.")).toEqual(["./report.md"]);
  });

  it("a clause break ends the preposition's reach", () => {
    expect(
      deriveDeliverablePaths("Create the report with numbers pulled from the API, and write it to final.md."),
    ).toEqual(["./final.md"]);
  });
});

describe("absolute deliverable paths stay absolute", () => {
  it("never prefixes './' to an absolute path", () => {
    expect(deriveDeliverablePaths("Write the summary to /tmp/out/summary.md.")).toEqual(["/tmp/out/summary.md"]);
  });

  it("the contract describes the absolute file as written", () => {
    const req = compileRunContract("Write the summary to /tmp/out/summary.md.").requirements.find((r) =>
      r.id.startsWith("artifact:"),
    );
    expect(req?.id).toBe("artifact:/tmp/out/summary.md");
    expect(req?.spec.description).toBe("produce the file /tmp/out/summary.md");
  });
});
