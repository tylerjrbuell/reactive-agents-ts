import { describe, expect, test } from "bun:test";
import {
  foldAdvisory,
  inferChecklistProgress,
  makeChecklistTracker,
  projectChecklist,
  type ChecklistInputFact,
  type ChecklistItemOp,
} from "../checklist.js";

const add = (seq: number, ...items: [string, string][]): ChecklistInputFact => ({
  kind: "checklist-item", seq, iteration: 0, change: { op: "add", items: items.map(([id, title]) => ({ id, title })) },
});
const mark = (seq: number, id: string, status: "pending" | "in_progress" | "completed"): ChecklistInputFact => ({
  kind: "checklist-item", seq, iteration: 0, change: { op: "status", id, status } satisfies ChecklistItemOp,
});
const call = (seq: number, toolName: string, args: Record<string, unknown>, id = `c${seq}`): ChecklistInputFact => ({
  kind: "tool-invocation", seq, iteration: 1, toolName, args, toolCallId: id,
});
const result = (seq: number, id: string, success = true, toolName?: string): ChecklistInputFact => ({
  kind: "tool-result", seq, iteration: 1, toolCallId: id, success, ...(toolName ? { toolName } : {}),
});
const artifact = (seq: number, path: string): ChecklistInputFact => ({ kind: "artifact", seq, iteration: 1, path, op: "write" });
const requirement = (seq: number, id: string, status: "declared" | "satisfied", description?: string): ChecklistInputFact => ({
  kind: "requirement", seq, iteration: 0, requirementId: id, status, ...(description ? { description } : {}),
});

const infer = (facts: readonly ChecklistInputFact[]) =>
  inferChecklistProgress(foldAdvisory(facts.filter((f) => f.kind === "requirement" || f.kind === "checklist-item") as never), facts);

describe("inferChecklistProgress — anchors", () => {
  test("successful tool call whose name is in the item text", () => {
    const m = infer([add(1, ["1", "Run the web-search"]), call(2, "web-search", { query: "x" }), result(3, "c2")]);
    expect(m.get("1")).toEqual({ seq: 3, kind: "tool-result", detail: "web-search" });
  });
  test("distinctive arg value (path) in the item text", () => {
    const m = infer([add(1, ["1", "Save notes to ./out/notes.md"]), call(2, "file-write", { path: "./out/notes.md", content: "hi" }), result(3, "c2")]);
    expect(m.get("1")?.kind).toBe("tool-result");
  });
  test("distinctive arg value (url / query)", () => {
    expect(infer([add(1, ["1", "Fetch https://example.com/a"]), call(2, "http-get", { url: "https://example.com/a" }), result(3, "c2")]).has("1")).toBe(true);
    expect(infer([add(1, ["1", "Look up bun test runner docs"]), call(2, "lookup", { q: "bun test runner" }), result(3, "c2")]).has("1")).toBe(true);
  });
  test("artifact path or its basename", () => {
    expect(infer([add(1, ["1", "Write report.md"]), artifact(2, "/tmp/out/report.md")]).get("1")).toEqual({ seq: 2, kind: "artifact", detail: "/tmp/out/report.md" });
  });
  test("satisfied requirement the item restates", () => {
    const m = infer([requirement(0, "r1", "declared", "Summarise the quarterly numbers"), add(1, ["1", "Summarise the quarterly numbers"]), requirement(2, "r1", "satisfied")]);
    expect(m.get("1")).toMatchObject({ seq: 2, kind: "requirement" });
  });
  test("tool result paired by name when ids are absent", () => {
    const facts: ChecklistInputFact[] = [
      add(1, ["1", "Use file-read"]),
      { kind: "tool-invocation", seq: 2, iteration: 1, toolName: "file-read" },
      { kind: "tool-result", seq: 3, iteration: 1, toolName: "file-read", success: true },
    ];
    expect(infer(facts).has("1")).toBe(true);
  });
});

describe("inferChecklistProgress — negatives", () => {
  test("no anchor -> none", () => {
    expect(infer([add(1, ["1", "Think about things"]), call(2, "file-write", { path: "./a.md" }), result(3, "c2")]).size).toBe(0);
  });
  test("generic / short arg values never anchor", () => {
    expect(infer([add(1, ["1", "write true text now"]), call(2, "x", { flag: "true", mode: "text" }), result(3, "c2")]).size).toBe(0);
  });
  test("substring of a longer word never anchors", () => {
    expect(infer([add(1, ["1", "Handle data.md.bak cleanup"]), artifact(2, "x/a.md")]).size).toBe(0);
  });
  test("ambiguous across several items -> none", () => {
    const m = infer([add(1, ["1", "Write ./a.md"], ["2", "Review ./a.md"]), call(2, "file-write", { path: "./a.md" }), result(3, "c2")]);
    expect(m.size).toBe(0);
  });
  test("failed tool call -> none; missing result -> none", () => {
    expect(infer([add(1, ["1", "Write ./a.md"]), call(2, "file-write", { path: "./a.md" }), result(3, "c2", false)]).size).toBe(0);
    expect(infer([add(1, ["1", "Write ./a.md"]), call(2, "file-write", { path: "./a.md" })]).size).toBe(0);
  });
  test("evidence recorded BEFORE the item was added -> none", () => {
    expect(infer([call(1, "file-write", { path: "./a.md" }), result(2, "c1"), add(3, ["1", "Write ./a.md"])]).size).toBe(0);
  });
  test("the todo tool itself is never evidence", () => {
    expect(infer([add(1, ["1", "Use todo to plan"]), call(2, "todo", { action: "add" }), result(3, "c2")]).size).toBe(0);
  });
  test("requirement without a description or satisfied status -> none", () => {
    expect(infer([requirement(0, "r1", "declared", "Summarise the quarterly numbers"), add(1, ["1", "Summarise the quarterly numbers"])]).size).toBe(0);
  });
});

describe("explicit beats inferred", () => {
  const base = (extra: ChecklistInputFact[]) => [add(1, ["1", "Write ./a.md"]), call(2, "file-write", { path: "./a.md" }), result(3, "c2"), ...extra];
  test("explicit completed: nothing inferred", () => {
    expect(infer(base([mark(4, "1", "completed")])).size).toBe(0);
  });
  test("explicit pending AFTER evidence reverses the inference", () => {
    expect(infer(base([mark(4, "1", "pending")])).size).toBe(0);
  });
  test("explicit pending BEFORE evidence still blocks (user un-ticked)", () => {
    expect(infer([add(1, ["1", "Write ./a.md"]), mark(2, "1", "pending"), call(3, "file-write", { path: "./a.md" }), result(4, "c3")]).size).toBe(0);
  });
  test("explicit in_progress before evidence does not block", () => {
    expect(infer([add(1, ["1", "Write ./a.md"]), mark(2, "1", "in_progress"), call(3, "file-write", { path: "./a.md" }), result(4, "c3")]).size).toBe(1);
  });
  test("explicit in_progress AFTER evidence wins over inference", () => {
    expect(infer(base([mark(4, "1", "in_progress")])).size).toBe(0);
  });
});

describe("projection", () => {
  const facts: ChecklistInputFact[] = [
    requirement(0, "r1", "declared", "Answer"),
    add(1, ["1", "Write ./a.md"], ["2", "Ponder"]),
    call(2, "file-write", { path: "./a.md" }), result(3, "c2"),
  ];
  test("inferred row is done+inferred with evidence; advisory never decides done-ness", () => {
    const root = projectChecklist(facts).root;
    expect(root.rows.find((r) => r.id === "1")).toMatchObject({ status: "done", source: "inferred", evidence: { seq: 3, kind: "tool-result" } });
    expect(root.rows.find((r) => r.id === "2")).toMatchObject({ status: "pending", source: "explicit" });
    expect(root.requirements).toEqual({ done: 0, total: 1 });
  });
  test("an inferred row is not active; unmarked items stay pending (never force-completed)", () => {
    const root = projectChecklist([add(1, ["1", "Write ./a.md"], ["2", "Ponder"]), mark(2, "2", "in_progress")]).root;
    expect(root.activeAdvisoryIds).toEqual(["2"]);
    expect(root.rows.every((r) => r.status !== "done")).toBe(true);
  });
  test("tracker folds evidence entries from LedgerEntryAppended and infers at the terminal batch", () => {
    const t = makeChecklistTracker("t1");
    const ev = (entries: unknown[], extra = {}) => ({ _tag: "LedgerEntryAppended", taskId: "t1", entries, ...extra });
    const s1 = t.track(ev([facts[1]]));
    expect(s1?.root.rows[0]).toMatchObject({ status: "pending" });
    const s2 = t.track(ev([facts[2], facts[3]]));
    expect(s2?.root.rows[0]).toMatchObject({ status: "done", source: "inferred" });
  });
});

describe("inferChecklistProgress — restated steps (Cortex D3)", () => {
  // Real shape from a Cortex chat: the plan was re-added across turns, so several rows restate the same step.
  const plan = add(
    0,
    ["1", "Fetch the current BTC price using a suitable API or tool."],
    ["2", "Write the retrieved BTC price value into a file named btc.txt."],
    ["3", "Fetch the current BTC price."],
  );
  test("evidence goes to the one restated row it covers most; the looser restatement stays pending", () => {
    const m = infer([plan, call(3, "web-search", { query: "current BTC price" }), result(4, "c3")]);
    expect([...m.keys()]).toEqual(["3"]);
    expect(m.get("3")).toMatchObject({ kind: "tool-result", seq: 4 });
  });
  test("a tie in coverage stays ambiguous (no guess)", () => {
    const tied = add(0, ["1", "Fetch the current BTC price."], ["2", "Fetch the current BTC price."]);
    expect(infer([tied, call(3, "web-search", { query: "current BTC price" }), result(4, "c3")]).size).toBe(0);
  });
  test("weak cover stays ambiguous", () => {
    const weak = add(0, ["1", "Compare the current BTC price across many exchanges and venues today"], ["2", "Chart the current BTC price over several long timeframes in detail"]);
    expect(infer([weak, call(3, "web-search", { query: "current BTC price" }), result(4, "c3")]).size).toBe(0);
  });
});
