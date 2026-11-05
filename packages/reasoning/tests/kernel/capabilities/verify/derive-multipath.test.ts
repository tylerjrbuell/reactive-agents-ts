// derive-multipath.test.ts — the audit 01-F5 fix: deriveDeliverablePaths must
// catch ALL literal deliverable paths (multi-path), while the single-path
// deriveConditions stays byte-identical (asserted in derive-conditions.test.ts).
import { describe, expect, it } from "bun:test";
import {
  deriveDeliverablePaths,
  expandBoundTemplate,
  MAX_BOUND_FAMILY,
} from "../../../../src/kernel/capabilities/verify/derive-conditions.js";

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

// ── Bound template expansion (H3 h3-todo-heavy, 2026-11-04) ──────────────────
// A template output (out-N.txt) expands ONLY when the task binds N: an input
// template with the same variable (notes-N.txt) plus literal instances of it.
describe("expandBoundTemplate — explicit binding only", () => {
  const sixOut = [1, 2, 3, 4, 5, 6].map((n) => `./out-${n}.txt`);

  it.each([
    ["notes-1.txt through notes-6.txt. For each notes-N.txt, write out-N.txt.", sixOut],
    ["notes-1.txt thru notes-6.txt. For each notes-N.txt, write out-N.txt.", sixOut],
    ["notes-1.txt to notes-6.txt. For each notes-N.txt, write out-N.txt.", sixOut],
    ["notes-1.txt..notes-6.txt. For each notes-N.txt, write out-N.txt.", sixOut],
    ["Inputs ./notes-1.txt through ./notes-6.txt. For each notes-N.txt, write out-N.txt.", sixOut],
    ["Read notes-1.txt, notes-2.txt and notes-4.txt. For each notes-N.txt, write out-N.txt.", ["./out-1.txt", "./out-2.txt", "./out-4.txt"]],
    ["data/in-1.csv through data/in-3.csv. For each data/in-N.csv write reports/ch-N-notes.md.", ["./reports/ch-1-notes.md", "./reports/ch-2-notes.md", "./reports/ch-3-notes.md"]],
  ])("binds: %s", (task, expected) => {
    const template = task.includes("ch-N-notes.md") ? "reports/ch-N-notes.md" : "out-N.txt";
    expect(expandBoundTemplate(template, task)).toEqual(expected);
  });

  it.each([
    ["unbound: no literal instances", "For each notes-N.txt, write out-N.txt."],
    ["unbound: no input template", "notes-1.txt through notes-6.txt. Write out-N.txt for each."],
    ["unbound: input template uses another variable", "notes-1.txt through notes-6.txt. For each notes-K.txt, write out-N.txt."],
    ["one instance is not a binding", "notes-3.txt is ready. For each notes-N.txt, write out-N.txt."],
    ["mismatched endpoints (extension)", "notes-1.txt through notes-6.md. For each notes-N.txt, write out-N.txt."],
    ["mismatched endpoints (segment)", "notes-1.txt through notes-final-6.txt. For each notes-N.txt, write out-N.txt."],
    ["reversed range", "notes-6.txt through notes-1.txt. For each notes-N.txt, write out-N.txt."],
    ["more than 50 items", "notes-1.txt through notes-51.txt. For each notes-N.txt, write out-N.txt."],
    ["zero-padded values", "notes-01.txt through notes-06.txt. For each notes-N.txt, write out-N.txt."],
    ["two inputs bind different domains", "notes-1.txt through notes-3.txt and data-1.csv through data-6.csv. For each notes-N.txt and data-N.csv, write out-N.txt."],
  ])("%s → undefined", (_label, task) => {
    expect(expandBoundTemplate("out-N.txt", task)).toBeUndefined();
  });

  // The H3 bench runner absolutizes fixture paths and prefixes the workdir, so
  // the kernel receives THIS text (live INERT run, 2026-11-04): instances carry
  // a directory the template does not. Binding is by file name.
  const W = "/home/u/Documents/AIProjects/reactive-agents-ts/packages/benchmarks/.bench-run-6hEd5T";
  const H3_AS_RUN = `Working directory for this task: ${W}\n\nSix files in your working directory, ${W}/notes-1.txt through ${W}/notes-6.txt, each contain one integer. Track the work as a todo list with one item per file. For each notes-N.txt, write out-N.txt containing exactly double that integer (digits only). Finish all six.`;

  it("binds directory-prefixed instances by file name; outputs keep the template's own directory", () => {
    expect(expandBoundTemplate("out-N.txt", H3_AS_RUN)).toEqual(sixOut);
    expect(deriveDeliverablePaths(H3_AS_RUN)).toEqual(sixOut);
    expect(expandBoundTemplate("out-N.txt", "data/notes-1.txt through data/notes-3.txt. For each notes-N.txt, write out-N.txt.")).toEqual(
      ["./out-1.txt", "./out-2.txt", "./out-3.txt"],
    );
    expect(expandBoundTemplate("out-N.txt", "./notes-1.txt through notes-3.txt. For each notes-N.txt, write out-N.txt.")).toEqual(
      ["./out-1.txt", "./out-2.txt", "./out-3.txt"],
    );
  });

  it("instances in different directories bind nothing", () => {
    expect(expandBoundTemplate("out-N.txt", "a/notes-1.txt through b/notes-6.txt. For each notes-N.txt, write out-N.txt.")).toBeUndefined();
    expect(deriveDeliverablePaths("a/notes-1.txt through b/notes-6.txt. For each notes-N.txt, write out-N.txt.")).toEqual([]);
    expect(expandBoundTemplate("out-N.txt", `${W}/notes-1.txt through notes-6.txt. For each notes-N.txt, write out-N.txt.`)).toBeUndefined();
  });

  it("exactly 50 items still binds", () => {
    const task = "notes-1.txt through notes-50.txt. For each notes-N.txt, write out-N.txt.";
    expect(expandBoundTemplate("out-N.txt", task)).toHaveLength(MAX_BOUND_FAMILY);
  });

  it("a literal path is never a template: v2/X-ray.md stays literal", () => {
    const task = "Write the findings to v2/X-ray.md.";
    expect(expandBoundTemplate("v2/X-ray.md", task)).toBeUndefined();
    expect(deriveDeliverablePaths(task)).toEqual(["./v2/X-ray.md"]);
    // even next to a bindable family, a one-letter stem segment that no input shares stays literal
    expect(expandBoundTemplate("src/A.ts", "a-1.ts through a-3.ts. For each a-N.ts write src/A.ts")).toBeUndefined();
  });

  it("delimiter forms are not expanded (only the single-uppercase-letter variable)", () => {
    const task = "notes-1.txt through notes-6.txt. For each notes-{i}.txt, write out-{i}.txt.";
    expect(deriveDeliverablePaths(task)).toEqual([]);
  });

  it("deriveDeliverablePaths admits the members only where the template is write-anchored", () => {
    expect(
      deriveDeliverablePaths("notes-1.txt through notes-3.txt. For each notes-N.txt, write out-N.txt."),
    ).toEqual(["./out-1.txt", "./out-2.txt", "./out-3.txt"]);
    // The bound INPUT template is read-anchored: never a deliverable.
    expect(
      deriveDeliverablePaths("notes-1.txt through notes-3.txt. Read each notes-N.txt and reply with the sum."),
    ).toEqual([]);
  });
});
