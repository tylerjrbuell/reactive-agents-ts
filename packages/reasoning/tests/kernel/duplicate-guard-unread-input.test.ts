// Run: bun run repo test packages/reasoning/tests/kernel/duplicate-guard-unread-input.test.ts
//
// Top-failures class 2 (2026-11-19): the duplicate-call refusal named only
// unwritten outputs, so a model wrote out-N from a source it never read. The
// refusal now names the first listed input with no read.
import { describe, expect, it } from "bun:test";
import type { ToolCallSpec } from "@reactive-agents/tools";
import { duplicateGuard } from "../../src/kernel/capabilities/act/guard.js";
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

describe("duplicateGuard names the first unread listed input", () => {
  it("names notes-2.txt when only notes-1.txt was read", () => {
    const text = refusal(["notes-1.txt"]);
    expect(text).toContain("Already done");
    expect(text).toContain("Read notes-2.txt first");
    expect(text).not.toContain("Give FINAL ANSWER");
  });

  it("names the next unread input after two reads", () => {
    expect(refusal(["notes-1.txt", "notes-2.txt"])).toContain("Read notes-3.txt first");
  });

  it("keeps the current text when every listed input was read", () => {
    const text = refusal(["notes-1.txt", "notes-2.txt", "notes-3.txt"]);
    expect(text).not.toContain("Read notes-");
    expect(text).toContain("Give FINAL ANSWER");
  });
});
