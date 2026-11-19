// Run: bun run repo test packages/reasoning/tests/kernel/duplicate-guard-unread-input.test.ts
//
// Top-failures class 2 (2026-11-19): the duplicate-call refusal named only
// unwritten outputs, so a model wrote out-N from a source it never read. The
// refusal now names the first listed input with no read.
import { describe, expect, it } from "bun:test";
import type { ToolCallSpec } from "@reactive-agents/tools";
import { duplicateGuard } from "../../src/kernel/capabilities/act/guard.js";
import { deriveListedInputs } from "../../src/kernel/capabilities/verify/derive-inputs.js";
import { makeKernelInput, makeKernelState } from "../../src/testing/kernel-fixtures.js";
import { withEvidence } from "./tool-evidence-fixture.js";
import type { ReasoningStep } from "../../src/types/index.js";

const TASK =
  "Read notes-1.txt, notes-2.txt and notes-3.txt in your working directory. For each, write the line count to out-1.txt, out-2.txt and out-3.txt.";

let seq = 0;
function ranRead(path: string): ReasoningStep[] {
  const id = `c${++seq}`;
  return [
    { id: `a${seq}`, type: "action", content: "", timestamp: new Date(), metadata: { toolCall: { id, name: "file-read", arguments: { path } } } },
    {
      id: `o${seq}`,
      type: "observation",
      content: "12 lines",
      timestamp: new Date(),
      metadata: {
        toolCallId: id,
        observationResult: { success: true, toolName: "file-read", displayText: "12 lines", category: "file-read", resultKind: "data", preserveOnCompaction: true, trustLevel: "untrusted" },
      },
    },
  ] as unknown as ReasoningStep[];
}

const repeat: ToolCallSpec = { id: "dup", name: "file-read", arguments: { path: "notes-1.txt" } };

function refusal(paths: readonly string[]): string {
  const state = withEvidence(makeKernelState({ status: "acting", steps: paths.flatMap(ranRead) }));
  const outcome = duplicateGuard(repeat, state, makeKernelInput({ task: TASK }));
  expect(outcome.pass).toBe(false);
  return outcome.pass ? "" : outcome.observation;
}

describe("a written range expands to every member (cogito h3-todo-heavy, zoo-live addendum 4)", () => {
  const RANGE_TASK =
    "Six files in your working directory, notes-1.txt through notes-6.txt, each contain one integer. Track the work as a todo list with one item per file. For each notes-N.txt, write out-N.txt containing exactly double that integer (digits only). Finish all six.";

  it("deriveListedInputs yields notes-1..notes-6 in order", () => {
    expect(deriveListedInputs(RANGE_TASK).map((i) => i.entity)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `notes-${n}.txt`));
  });

  it("'to' ranges expand and a lone pair or reversed range does not", () => {
    expect(deriveListedInputs("Read a-1.md to a-3.md.").map((i) => i.entity)).toEqual(["a-1.md", "a-2.md", "a-3.md"]);
    expect(deriveListedInputs("Read a-1.md and a-3.md.").map((i) => i.entity)).toEqual(["a-1.md", "a-3.md"]);
    expect(deriveListedInputs("Read a-3.md through a-1.md.").map((i) => i.entity)).toEqual(["a-3.md", "a-1.md"]);
  });

  it("the duplicate refusal names notes-2.txt after notes-1.txt, not notes-6.txt", () => {
    const state = withEvidence(makeKernelState({ status: "acting", steps: ranRead("notes-1.txt") }));
    const outcome = duplicateGuard(repeat, state, makeKernelInput({ task: RANGE_TASK }));
    expect(outcome.pass).toBe(false);
    const text = outcome.pass ? "" : outcome.observation;
    // out-1 is owed first (pending-write-first); the next unread input follows it.
    expect(text).toContain("Write ./out-1.txt now");
    expect(text).toContain("Then read notes-2.txt.");
    expect(text).not.toContain("notes-6.txt");
  });
});

describe("duplicateGuard names the first unread listed input", () => {
  it("names notes-2.txt when only notes-1.txt was read", () => {
    const text = refusal(["notes-1.txt"]);
    expect(text).toContain("Already done");
    expect(text).toContain("Then read notes-2.txt.");
    expect(text).not.toContain("Give FINAL ANSWER");
  });

  it("names the next unread input after two reads", () => {
    expect(refusal(["notes-1.txt", "notes-2.txt"])).toContain("Then read notes-3.txt.");
  });

  it("keeps the current text when every listed input was read", () => {
    const text = refusal(["notes-1.txt", "notes-2.txt", "notes-3.txt"]);
    expect(text).not.toContain("Read notes-");
    expect(text).toContain("Give FINAL ANSWER");
  });
});
