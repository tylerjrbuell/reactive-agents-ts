/**
 * Duplicate-call refusal leads with the write owed (cogito:8b h3-todo-heavy, 2026-11-19).
 *
 * The model read notes-2, did not write out-2, re-read it (refused with "Read
 * notes-3 first"), then wrote out-2 from notes-3's value: every later write was
 * shifted by one. Pairing rule: a listed input pairs with the deliverable
 * sharing its numbered-family index (notes-N -> out-N), only when exactly one
 * of each carries that index.
 */
import { describe, it, expect } from "bun:test";
import type { ToolCallSpec } from "@reactive-agents/tools";
import { duplicateGuard } from "../../../../src/kernel/capabilities/act/guard.js";
import { pairedOutputForInput } from "../../../../src/kernel/capabilities/verify/derive-inputs.js";
import { makeStep } from "../../../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../../../src/kernel/utils/observation-helpers.js";
import { initialKernelState, type KernelState, type KernelInput } from "../../../../src/kernel/state/kernel-state.js";
import type { ReasoningStep } from "../../../../src/types/index.js";
import { withEvidence } from "../../tool-evidence-fixture.js";

const TASK = `Six files in your working directory, notes-1.txt through notes-6.txt, each contain one integer. Track the work as a todo list with one item per file. For each notes-N.txt, write out-N.txt containing exactly double that integer (digits only). Finish all six.`;

const read = (id: string, path: string): ToolCallSpec => ({ id, name: "file-read", arguments: { path } });
const write = (id: string, path: string): ToolCallSpec => ({ id, name: "file-write", arguments: { path, content: "2" } });

function ran(call: ToolCallSpec, result: string): ReasoningStep[] {
  return [
    makeStep("action", `${call.name}(${JSON.stringify(call.arguments)})`, { toolCall: call }),
    makeStep("observation", result, {
      toolCallId: call.id,
      observationResult: makeObservationResult(call.name, true, result),
    }),
  ];
}

const stateOf = (steps: ReasoningStep[]): KernelState =>
  withEvidence({
    ...initialKernelState({ maxIterations: 10, strategy: "react-kernel", kernelType: "react", taskId: "pending-write" }),
    steps,
  });

const input = { task: TASK, requiredTools: [], requiredToolQuantities: {} } as unknown as KernelInput;

function refusal(steps: ReasoningStep[]): string {
  const out = duplicateGuard(read("dup", "notes-2.txt"), stateOf(steps), input);
  expect(out.pass).toBe(false);
  return out.pass ? "" : out.observation;
}

describe("duplicateGuard — pending write leads the refusal", () => {
  it("names out-2 as the write owed after notes-2 was read and not written", () => {
    const text = refusal([
      ...ran(read("r1", "notes-1.txt"), "3"),
      ...ran(write("w1", "out-1.txt"), "ok"),
      ...ran(read("r2", "notes-2.txt"), "5"),
    ]);
    expect(text).toContain("Write ./out-2.txt now from the value you just read in notes-2.txt");
    expect(text).not.toContain("Read notes-3.txt first");
  });

  it("keeps the read-first text when every read input's output is written", () => {
    const text = refusal([
      ...ran(write("w1", "out-1.txt"), "ok"),
      ...ran(write("w2", "out-2.txt"), "ok"),
      ...ran(read("r1", "notes-1.txt"), "3"),
      ...ran(read("r2", "notes-2.txt"), "5"),
    ]);
    expect(text).toContain("Read notes-3.txt first: it is a listed input you have not read yet.");
    expect(text).not.toContain("now from the value you just read");
  });

  it("pairs nothing when the task has no numbered output family", () => {
    expect(pairedOutputForInput("Read a.txt and b.txt then write summary.txt", "a.txt")).toBeUndefined();
    expect(pairedOutputForInput(TASK, "notes-2.txt")).toBe("./out-2.txt");
  });
});
