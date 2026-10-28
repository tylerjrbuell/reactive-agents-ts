import { describe, expect, test } from "bun:test";
import {
  finishTurnTrace,
  foldTurnTrace,
  initialRunState,
  initialTurnTrace,
  parseUiStreamEvent,
  reduceRunState,
  type ChecklistSnapshotWire,
  type SeqStamped,
  type UiStreamEvent,
} from "../src/index.js";

const snap = (lastSeq: number, title = "a"): ChecklistSnapshotWire => ({
  lastSeq,
  root: {
    key: "root",
    label: "root",
    rows: [{ id: "r1", kind: "requirement", title, status: "pending" }],
    requirements: { done: 0, total: 1 },
    advisory: { done: 0, total: 0 },
    activeAdvisoryIds: [],
    children: [],
  },
});

const upd = (lastSeq: number, title?: string): SeqStamped<UiStreamEvent> => ({
  _tag: "ChecklistUpdated",
  checklist: snap(lastSeq, title),
  iteration: 1,
});

describe("checklist state", () => {
  test("RunState keeps highest lastSeq; stale event ignored", () => {
    let s = initialRunState();
    s = reduceRunState(s, upd(5, "new"));
    s = reduceRunState(s, upd(3, "stale"));
    expect(s.checklist?.lastSeq).toBe(5);
    expect(s.checklist?.root.rows[0]?.title).toBe("new");
    s = reduceRunState(s, upd(7, "newer"));
    expect(s.checklist?.lastSeq).toBe(7);
  });

  test("turn with only ChecklistUpdated + StreamCompleted persists checklist", () => {
    const events: UiStreamEvent[] = [
      upd(2),
      { _tag: "StreamCompleted", output: "done", metadata: {} },
    ];
    const trace = finishTurnTrace(events.reduce(foldTurnTrace, initialTurnTrace()));
    expect(trace).toEqual({ reasoningSteps: [], toolCalls: [], checklist: snap(2) });
  });

  test("no-checklist fixtures finish as before", () => {
    expect(finishTurnTrace(initialTurnTrace())).toBeUndefined();
    const s = [
      { _tag: "ToolCallStarted", toolName: "t", callId: "c" },
    ].reduce(foldTurnTrace, initialTurnTrace()) as ReturnType<typeof initialTurnTrace>;
    expect(finishTurnTrace(s)).not.toHaveProperty("checklist");
  });

  test("runtime JSON parses and narrows", () => {
    const e = parseUiStreamEvent(JSON.stringify({ _tag: "ChecklistUpdated", checklist: snap(4), iteration: 2 }));
    expect(e?._tag).toBe("ChecklistUpdated");
    if (e?._tag === "ChecklistUpdated") expect(e.checklist.root.rows[0]?.id).toBe("r1");
  });
});
