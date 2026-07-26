// Run: bun test packages/reasoning/src/kernel/capabilities/verify/derive-bare-filename.test.ts
//
// A named deliverable file is derived even when the task never says "file"
// (2026-07-26).
//
// Live witness — bench rw-4, repeatably 0% across every sweep:
//
//   "…and write a TypeScript module to output.ts that exports a typed
//    EnrichedPost[] array as a const."
//
//   compileRunContract(rw4Prompt).deliverables  →  []
//
// So the run had NO declared deliverable: the terminal gate could not require
// output.ts, the receipt could not report it missing, and the early-exit guards
// had nothing to protect. The agent fetched the posts, fetched the comments and
// computed the enriched array — then `low_delta_guard` ended the run before the
// write, and the task scored 0 ("output.ts exports no array").
//
// Cause: `passesPathPrecision` demanded `hasSeparator || FILE_NOUN.test(task)`,
// where FILE_NOUN is /\b(file|document|report|markdown|md|json|csv|txt)\b/. A
// BARE `output.ts` therefore needed the TASK to also contain a generic file
// noun somewhere. rw-4 says "module", and its only "json" is inside
// "JSONPlaceholder" (no word boundary) — so a task that names its deliverable
// precisely was rejected for not naming it twice.
//
// That gate bought no precision: for a separator-less candidate the
// REAL_FILE_EXTENSIONS check on the following line is the real guard. What it
// did buy is protection from "Node.js"-shaped prose, so that class is now
// denied by name (the existing PROSE_ABBREVIATIONS idiom) instead of by a
// task-wide keyword requirement.
//
// RED-ON-CUT: restore `|| FILE_NOUN.test(task)` as a prerequisite and the rw-4
// case fails; drop TECH_NAME_TOKENS and the framework-prose cases fail.
import { describe, expect, it } from "bun:test";
import { deriveDeliverablePaths } from "./derive-conditions.js";

const RW4 =
  "Using the JSONPlaceholder API at https://jsonplaceholder.typicode.com, fetch all posts " +
  "by user ID 3, enrich each post with its comment count, and write a TypeScript module to " +
  "output.ts that exports a typed EnrichedPost[] array as a const. The module must compile " +
  "without errors.";

describe("bare filenames are derived without a task-wide file noun", () => {
  it("derives output.ts from the rw-4 prompt (the live witness)", () => {
    expect(deriveDeliverablePaths(RW4)).toEqual(["./output.ts"]);
  });

  it("CONTROL: still derives when the task DOES say file", () => {
    expect(deriveDeliverablePaths("Write a report file to summary.md")).toEqual(["./summary.md"]);
  });

  it("CONTROL: a read-anchored path is still an INPUT, never a deliverable", () => {
    expect(deriveDeliverablePaths("Analyze input.csv and summarize it")).toEqual([]);
  });

  it("CONTROL: the read-then-write shape still picks only the written path", () => {
    expect(deriveDeliverablePaths("Read data.csv and write results.json")).toEqual([
      "./results.json",
    ]);
  });

  it("derives a bare script name", () => {
    expect(deriveDeliverablePaths("Create a validator at validate.py")).toEqual(["./validate.py"]);
  });
});

describe("framework prose is not a deliverable", () => {
  it("does not derive Node.js from a write-verb sentence", () => {
    expect(deriveDeliverablePaths("Generate a summary using Node.js")).toEqual([]);
  });

  it("does not derive React.js / Next.js", () => {
    expect(deriveDeliverablePaths("Create a component with React.js and Next.js")).toEqual([]);
  });

  it("still derives the real deliverable alongside framework prose", () => {
    expect(deriveDeliverablePaths("Using Node.js, write the results to out.json")).toEqual([
      "./out.json",
    ]);
  });

  it("CONTROL: a prose abbreviation is still excluded", () => {
    expect(deriveDeliverablePaths("Write a summary, e.g. something short")).toEqual([]);
  });

  it("CONTROL: a version number is not a path", () => {
    expect(deriveDeliverablePaths("Produce output for version 2.14")).toEqual([]);
  });
});
