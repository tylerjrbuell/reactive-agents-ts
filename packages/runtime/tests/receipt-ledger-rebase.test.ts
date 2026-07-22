import { describe, expect, test } from "bun:test";
import { deriveReceiptToolCalls } from "../src/builder/helpers.js";

const inv = (id: string, name: string, args?: Record<string, unknown>) =>
  ({ kind: "tool-invocation", toolCallId: id, toolName: name, ...(args ? { args } : {}) });
const res = (id: string, name: string, success: boolean) =>
  ({ kind: "tool-result", toolCallId: id, toolName: name, success });

describe("receipt tool-call evidence re-bases onto the ledger", () => {
  test("ledger pairs win over steps when present", () => {
    const out = deriveReceiptToolCalls({
      runLedger: [
        inv("c1", "file-read", { path: "a.txt" }),
        res("c1", "file-read", true),
        inv("c2", "file-write", { path: "b.txt" }),
        res("c2", "file-write", false),
      ],
      // steps deliberately CONTRADICT the ledger — ledger must win:
      reasoningSteps: [
        { type: "action", metadata: { toolCall: { id: "c9", name: "wrong-tool", arguments: {} } } },
      ],
    } as never);
    expect(out).toEqual([
      { name: "file-read", ok: true, target: JSON.stringify([["path", "a.txt"]]) },
      { name: "file-write", ok: false, target: JSON.stringify([["path", "b.txt"]]) },
    ]);
  });

  test("steps fallback intact when no ledger crosses", () => {
    const out = deriveReceiptToolCalls({
      reasoningSteps: [
        { type: "action", metadata: { toolCall: { id: "c1", name: "file-read", arguments: { path: "a.txt" } }, } },
        { type: "observation", metadata: { toolCallId: "c1", observationResult: { success: true } } },
      ],
    } as never);
    expect(out.length).toBe(1);
    expect(out[0]).toMatchObject({ name: "file-read", ok: true });
  });

  test("meta tools excluded from ledger path too (final-answer is not evidence)", () => {
    const out = deriveReceiptToolCalls({
      runLedger: [inv("c1", "final-answer"), res("c1", "final-answer", true)],
    } as never);
    expect(out).toEqual([]);
  });
});
