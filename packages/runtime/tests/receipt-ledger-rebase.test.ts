import { describe, expect, test } from "bun:test";
import { deriveReceiptDeliverables, deriveReceiptToolCalls } from "../src/builder/helpers.js";

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

describe("deliverable evidence prefers ledger artifact entries", () => {
  // NOTE: `taskContract` has no `.deliverables` field on the real TaskContract
  // shape (packages/core/src/contracts/task-contract.ts) — the RunContract's
  // deliverables are derived from the TASK PROSE by `deriveDeliverablePaths`
  // (kernel/capabilities/verify/derive-conditions.ts), same as every existing
  // `computeDeliverableReport` test (rw-8's fixtures never pass a taskContract
  // either). The `taskContract` field below is kept `as never` per the brief —
  // harmlessly unread — and the task string "...out/report.md" is what
  // actually derives the "./out/report.md" ArtifactProduced deliverable.
  // `DeliverableReceipt` carries `{spec, produced}` (no `.path` field —
  // packages/core/src/types/receipt.ts), so assertions match on `spec`
  // containing the declared path rather than a nonexistent `.path` property.
  test("artifact entry marks a declared deliverable produced without step evidence", () => {
    const out = deriveReceiptDeliverables({
      task: "Write the summary to out/report.md",
      taskContract: { deliverables: [{ path: "out/report.md" }] } as never,
      reasoningSteps: [], // NO step evidence — ledger alone must carry it
      output: "done",
      runLedger: [
        { kind: "artifact", path: "out/report.md", op: "write", toolCallId: "c1" },
      ] as never,
    });
    expect(out).toBeDefined();
    expect(out!.find((d) => d.spec.includes("out/report.md"))?.produced).toBe(true);
  });

  test("missing artifact still reports unproduced", () => {
    const out = deriveReceiptDeliverables({
      task: "Write the summary to out/report.md",
      taskContract: { deliverables: [{ path: "out/report.md" }] } as never,
      reasoningSteps: [],
      output: "done",
      runLedger: [] as never,
    });
    expect(out!.find((d) => d.spec.includes("out/report.md"))?.produced).toBe(false);
  });
});
