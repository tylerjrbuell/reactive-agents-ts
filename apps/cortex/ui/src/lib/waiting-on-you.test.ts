import { describe, expect, it } from "bun:test";
import { statusOfRun } from "@reactive-agents/ui-core";
import { approvalDetail, choiceOptions, formFields, waitingItemsOf, waitingRunsOf, waitingStatusOf, withWaitingStatus } from "./waiting-on-you.js";
import { filterRuns, type RunRow } from "./runs-table.js";

const run = (over: Partial<RunRow> & { runId: string }): RunRow => ({
  agentId: "a",
  startedAt: 1,
  status: "paused",
  iterationCount: 0,
  tokensUsed: 0,
  cost: 0,
  hasDebrief: false,
  ...over,
});

describe("waitingItemsOf", () => {
  it("is empty when nothing waits (the strip does not render)", () => {
    expect(waitingItemsOf([], [], [])).toEqual([]);
  });

  it("lists approvals then questions, with the run's name and source", () => {
    const items = waitingItemsOf(
      [{ runId: "r1", agentId: "a", gateId: "g", toolName: "shell-execute", args: { command: "rm -rf build/" } }],
      [{ runId: "r2", interactionId: "i1", kind: "choice", prompt: "Which branch?", schema: { options: ["main", "dev"] } }],
      [run({ runId: "r1", agentRecordName: "release-bot", displayName: "release-bot" }), run({ runId: "r2", chatSessionId: "s", chatSessionName: "Release notes draft" })],
    );
    expect(items.map((i) => i.kind)).toEqual(["approval", "question"]);
    const a = items[0]!;
    if (a.kind !== "approval") throw new Error("approval first");
    expect(a.detail).toBe("rm -rf build/");
    expect(a.context).toBe("release-bot · gateway");
    expect(a.openRunId).toBe("r1");
    expect(items[1]!.context).toBe("Release notes draft · chat");
  });

  it("keeps a chat approval's session and marks runs that are not in the list", () => {
    const [a] = waitingItemsOf([{ runId: "d1", agentId: "a", gateId: "g", toolName: "", args: null, chatSessionId: "s1" }], [], []);
    if (a?.kind !== "approval") throw new Error("approval");
    expect(a.chatSessionId).toBe("s1");
    expect(a.openRunId).toBeUndefined();
    expect(a.toolName).toBe("Tool call");
    expect(a.context).toBe("chat");
  });

  it("finds a desk approval's run through its agent (the approval carries the durable run id)", () => {
    const [a] = waitingItemsOf(
      [{ runId: "515ce693-durable", agentId: "Note writer-1", gateId: "g", toolName: "file-write", args: { path: "./note.txt" } }],
      [],
      [
        run({ runId: "old", agentId: "Note writer-1", startedAt: 1, displayName: "Note writer", launchParams: { prompt: "p" } }),
        run({ runId: "new", agentId: "Note writer-1", startedAt: 9, displayName: "Note writer", launchParams: { prompt: "p" } }),
      ],
    );
    if (a?.kind !== "approval") throw new Error("approval");
    expect(a.openRunId).toBe("new");
    expect(a.context).toBe("Note writer · desk run");
    expect(a.detail).toBe("./note.txt");
  });
});

describe("approvalDetail", () => {
  it("shows the field that names the call", () => {
    expect(approvalDetail({ path: "/tmp/x", content: "…" })).toBe("/tmp/x");
    expect(approvalDetail({ command: ["git", "push"] })).toBe("git push");
  });
  it("falls back to clipped JSON", () => {
    expect(approvalDetail({ a: 1 })).toBe('{"a":1}');
    expect(approvalDetail({ big: "x".repeat(300) }).length).toBe(120);
  });
});

describe("interaction schemas", () => {
  it("reads choice options and form fields", () => {
    expect(choiceOptions({ options: ["a", 2, "b"] })).toEqual(["a", "b"]);
    expect(formFields({ fields: [{ name: "n", type: "number" }, { label: "no name" }, { name: "b", label: "Bool", type: "boolean" }] })).toEqual([
      { name: "n", label: "n", type: "number" },
      { name: "b", label: "Bool", type: "boolean" },
    ]);
  });
});

describe("waitingRunsOf / waitingStatusOf: a paused run reads Waiting on you, not Running", () => {
  const deskApproval = { runId: "durable-1", agentId: "desk-agent", gateId: "g", toolName: "shell-execute", args: {} };

  it("a live desk run whose agent holds an approval waits on you (the approval carries the durable id)", () => {
    const rows = [run({ runId: "old", agentId: "desk-agent", startedAt: 1, status: "failed" }), run({ runId: "r1", agentId: "desk-agent", startedAt: 5, status: "live" })];
    const waiting = waitingRunsOf(rows, [deskApproval], []);
    expect(waiting.get("r1")?.kind).toBe("approval");
    expect(waiting.has("old")).toBe(false);
    const shown = withWaitingStatus(rows, waiting);
    expect(shown.map((r) => r.status)).toEqual(["failed", "awaiting-approval"]);
    expect(statusOfRun(shown[1]!.status)).toEqual({ tone: "attention", label: "Waiting on you" });
    expect(filterRuns(shown, "", "running")).toHaveLength(0);
    expect(filterRuns(shown, "", "attention").map((r) => r.runId)).toEqual(["r1"]);
  });

  it("a question matches its run id; a sub-agent never takes its parent's approval", () => {
    const rows = [run({ runId: "q", status: "live" }), run({ runId: "child", agentId: "desk-agent", parentRunId: "p", startedAt: 9, status: "live" })];
    const waiting = waitingRunsOf(rows, [deskApproval], [{ runId: "q", interactionId: "i", kind: "confirmation", prompt: "?", schema: {} }]);
    expect(waiting.get("q")?.kind).toBe("question");
    expect(waiting.has("child")).toBe(false);
    expect(waitingStatusOf("live", waiting.get("q"))).toBe("awaiting-interaction");
  });

  it("an ended run keeps its status; nothing waiting returns the same rows", () => {
    expect(waitingStatusOf("completed", { kind: "approval", approval: deskApproval })).toBe("completed");
    expect(waitingStatusOf("live", undefined)).toBe("live");
    const rows = [run({ runId: "a", status: "live" })];
    expect(withWaitingStatus(rows, new Map())).toBe(rows);
  });
});
