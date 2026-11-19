import { describe, expect, it } from "bun:test";
import {
  applyRunLiveMessage,
  filterRuns,
  groupRuns,
  runDurationMs,
  runNameOf,
  runRowStatus,
  runSourceOf,
  runTotals,
  sortRuns,
  statusCounts,
  type RunRow,
} from "./runs-table.js";

const row = (over: Partial<RunRow> & { runId: string }): RunRow => ({
  agentId: "a",
  startedAt: 1000,
  status: "completed",
  iterationCount: 1,
  tokensUsed: 10,
  cost: 0.001,
  hasDebrief: false,
  ...over,
});

const rows = [
  row({ runId: "r1", status: "live", startedAt: 3000, model: "qwen3:14b", tokensUsed: 5 }),
  row({ runId: "r2", status: "failed", startedAt: 2000, displayName: "Save market.md", tokensUsed: 50, cost: 0.01 }),
  row({ runId: "r3", status: "stopped", startedAt: 1000, chatSessionId: "s1", chatSessionName: "Long multiplication" }),
  row({ runId: "r4", status: "completed", startedAt: 4000 }),
];

describe("filterRuns", () => {
  it("segments by the shared status tone", () => {
    expect(filterRuns(rows, "", "running").map((r) => r.runId)).toEqual(["r1"]);
    expect(filterRuns(rows, "", "stopped").map((r) => r.runId)).toEqual(["r3"]);
    expect(filterRuns(rows, "", "all")).toHaveLength(4);
  });
  it("the Can continue segment keeps only runs in the resumable set (none before it loads)", () => {
    expect(filterRuns(rows, "", "resumable", new Set(["r2", "r3"])).map((r) => r.runId)).toEqual(["r2", "r3"]);
    expect(filterRuns(rows, "", "resumable")).toEqual([]);
  });
  it("searches names, chats and models", () => {
    expect(filterRuns(rows, "market", "all").map((r) => r.runId)).toEqual(["r2"]);
    expect(filterRuns(rows, "multiplication", "all").map((r) => r.runId)).toEqual(["r3"]);
    expect(filterRuns(rows, "QWEN", "all").map((r) => r.runId)).toEqual(["r1"]);
  });
});

describe("statusCounts", () => {
  it("counts each segment, stopped runs apart from running ones (B3)", () => {
    expect(statusCounts(rows)).toEqual({ all: 4, running: 1, attention: 0, done: 1, failed: 1, stopped: 1, resumable: 0 });
  });
  it("counts the runs the framework can continue apart from their status", () => {
    expect(statusCounts(rows, new Set(["r2", "r3", "gone"])).resumable).toBe(2);
  });
});

describe("sort and group", () => {
  it("sorts newest first by default and by tokens", () => {
    expect(sortRuns(rows, "started-desc").map((r) => r.runId)).toEqual(["r4", "r1", "r2", "r3"]);
    expect(sortRuns(rows, "tokens-desc")[0]!.runId).toBe("r2");
    expect(sortRuns(rows, "started-asc")[0]!.runId).toBe("r3");
  });
  it("puts pinned runs in their own group, keeping order", () => {
    const g = groupRuns(sortRuns(rows, "started-desc"), new Set(["r2", "r3"]));
    expect(g.pinned.map((r) => r.runId)).toEqual(["r2", "r3"]);
    expect(g.recent.map((r) => r.runId)).toEqual(["r4", "r1"]);
  });
});

describe("runSourceOf / runNameOf", () => {
  it("names the source", () => {
    expect(runSourceOf(row({ runId: "x", chatSessionId: "s" }))).toBe("chat");
    expect(runSourceOf(row({ runId: "x", agentRecordName: "release-bot" }))).toBe("agent");
    expect(runSourceOf(row({ runId: "x", launchParams: { prompt: "p" } }))).toBe("desk");
    expect(runSourceOf(row({ runId: "x" }))).toBe("app");
  });
  it("names the run, never by a bare ULID", () => {
    expect(runNameOf(rows[1]!)).toBe("Save market.md");
    expect(runNameOf(rows[2]!)).toBe("Long multiplication");
    expect(runNameOf(row({ runId: "01M740X6MZ7A" }))).toBe("Run 01M740X6MZ7A");
    // Chat runs store the chat agent's ULID as their label: the chat's name wins.
    expect(runNameOf(row({ runId: "x", displayName: "01M7464PWBHXNK7FFAK7C96681", chatSessionName: "Hash explainer" }))).toBe("Hash explainer");
    expect(runNameOf(row({ runId: "01M740X6MZ7A", agentId: "agent-9", displayName: "agent-9" }))).toBe("Run 01M740X6MZ7A");
    // Runs started in the same second share a ULID's first 8 characters (its timestamp): the name tells them apart (2026-11-11 QA).
    expect(runNameOf(row({ runId: "01M766KBGEM2E38KBD0QDB989Z" }))).not.toBe(runNameOf(row({ runId: "01M766KBAYKH7G29XX7XCCQGGF" })));
  });
});

describe("runTotals / runDurationMs", () => {
  it("totals tokens and cost", () => {
    const t = runTotals(rows);
    expect(t.tokens).toBe(75);
    expect(t.cost).toBeCloseTo(0.013);
    expect(t.costComplete).toBe(true);
    expect(runTotals([...rows, row({ runId: "p", cost: 0.5, costComplete: false })]).costComplete).toBe(false);
  });
  it("a live unpriced call marks the row partial without adding dollars", () => {
    const start = [row({ runId: "r9", status: "live", cost: 0.1 })];
    const next = applyRunLiveMessage(start, { agentId: "a", runId: "r9", type: "LLMRequestCompleted", payload: { tokensUsed: 5, priceSource: "unknown" } }, 1);
    expect(next[0]?.cost).toBe(0.1);
    expect(next[0]?.costComplete).toBe(false);
    // AgentCompleted.totalCostUsd excludes the debrief call: the row keeps the provisional sum.
    const done = applyRunLiveMessage(next, { agentId: "a", runId: "r9", type: "AgentCompleted", payload: { success: true, totalCostUsd: 0.3 } }, 2);
    expect(done[0]?.cost).toBe(0.1);
    expect(done[0]?.costComplete).toBe(false);
    // RunCostFinalized (after the debrief) sets the run's total and completeness.
    const billed = applyRunLiveMessage(done, { agentId: "a", runId: "r9", type: "RunCostFinalized", payload: { totalCostUsd: 0.35, costComplete: false } }, 3);
    expect(billed[0]?.cost).toBe(0.35);
    expect(billed[0]?.costComplete).toBe(false);
    const priced = applyRunLiveMessage(done, { agentId: "a", runId: "r9", type: "RunCostFinalized", payload: { totalCostUsd: 0.35, costComplete: true } }, 3);
    expect(priced[0]?.costComplete).toBeUndefined();
  });
  it("times finished runs and live runs so far", () => {
    expect(runDurationMs(row({ runId: "x", startedAt: 1000, completedAt: 3500 }), 9999)).toBe(2500);
    expect(runDurationMs(row({ runId: "x", status: "live", startedAt: 1000 }), 4000)).toBe(3000);
    expect(runDurationMs(row({ runId: "x", status: "failed" }), 4000)).toBeUndefined();
  });
});

describe("applyRunLiveMessage", () => {
  it("adds an unknown run as a live row", () => {
    const out = applyRunLiveMessage([], { agentId: "a", runId: "new", type: "AgentStarted", payload: { model: "m" }, ts: 5 }, 9);
    expect(out[0]).toMatchObject({ runId: "new", status: "live", model: "m", startedAt: 5 });
  });
  it("accumulates tokens and cost", () => {
    const out = applyRunLiveMessage([rows[0]!], { agentId: "a", runId: "r1", type: "LLMRequestCompleted", payload: { tokensUsed: { total: 7 }, estimatedCost: 0.5 } }, 9);
    expect(out[0]!.tokensUsed).toBe(12);
    expect(out[0]!.cost).toBeCloseTo(0.501);
  });
  it("closes a cancelled run as stopped, and a later failure keeps it stopped (B3)", () => {
    const stopped = applyRunLiveMessage([rows[0]!], { agentId: "a", runId: "r1", type: "ExecutionCancelled", payload: {} }, 7000);
    expect(stopped[0]).toMatchObject({ status: "stopped", completedAt: 7000 });
    const after = applyRunLiveMessage(stopped, { agentId: "a", runId: "r1", type: "TaskFailed", payload: {} }, 8000);
    expect(after).toBe(stopped);
  });
  it("an abstained AgentCompleted records the ending; the row reads Abstained, segmented as attention", () => {
    const out = applyRunLiveMessage([rows[0]!], {
      agentId: "a", runId: "r1", type: "AgentCompleted",
      payload: { success: false, terminatedBy: "abstained", abstention: { reason: "no statement" } },
    }, 7000);
    expect(out[0]).toMatchObject({ status: "failed", ending: "abstained" });
    expect(runRowStatus(out[0]!)).toEqual({ tone: "attention", label: "Abstained" });
    expect(filterRuns(out, "", "failed")).toHaveLength(0);
    expect(statusCounts(out)).toMatchObject({ attention: 1, failed: 0 });
    expect(runRowStatus(row({ runId: "x", status: "failed", ending: "failed" })).label).toBe("Failed");
  });
  it("returns the same rows when nothing changed", () => {
    const same = [rows[0]!];
    expect(applyRunLiveMessage(same, { agentId: "a", runId: "r1", type: "ToolCallStarted", payload: {} }, 1)).toBe(same);
  });
});
