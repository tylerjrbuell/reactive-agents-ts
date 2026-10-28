import { describe, expect, test } from "bun:test";
import {
  checklistChanged,
  foldAdvisory,
  isChecklistFact,
  makeChecklistTracker,
  nextAdvisoryIds,
  projectChecklist,
  type ChecklistFact,
  type ChecklistItemFact,
  type ChecklistItemOp,
  type RequirementFact,
} from "../checklist.js";

const req = (seq: number, id: string, status: RequirementFact["status"], description?: string): RequirementFact =>
  ({ kind: "requirement", seq, iteration: 0, requirementId: id, status, ...(description ? { description } : {}) });
const item = (seq: number, change: ChecklistItemOp): ChecklistItemFact => ({ kind: "checklist-item", seq, iteration: 1, change });

describe("checklist projector", () => {
  test("requirement rows carry gate truth; advisory ticks never complete the run", () => {
    const s = projectChecklist([
      req(0, "r1", "declared", "Answer the question"),
      item(1, { op: "add", items: [{ id: "1", title: "a" }] }),
      item(2, { op: "status", id: "1", status: "completed" }),
    ]);
    expect(s.root.rows.map((r) => [r.kind, r.title, r.status])).toEqual([
      ["requirement", "Answer the question", "pending"], ["advisory", "a", "done"],
    ]);
    expect(s.root.requirements).toEqual({ done: 0, total: 1 });
    expect(s.root.advisory).toEqual({ done: 1, total: 1 });
  });

  test("latest requirement status wins; blocked carries reason", () => {
    const s = projectChecklist([req(0, "r1", "declared", "x"), { ...req(3, "r1", "blocked"), reason: "no tool" }]);
    expect(s.root.rows[0]).toMatchObject({ status: "blocked", reason: "no tool" });
  });

  test("advisory fold: ids from max seq, same-status no-op, gaps preserved", () => {
    const items = foldAdvisory([
      item(1, { op: "add", items: [{ id: "1", title: "a" }, { id: "3", title: "b" }] }),
      item(2, { op: "status", id: "1", status: "in_progress" }),
    ]);
    expect(items.map((i) => [i.id, i.status])).toEqual([["1", "in_progress"], ["3", "pending"]]);
    expect(nextAdvisoryIds(items, 2)).toEqual(["4", "5"]);
  });

  test("sub-agent facts group by provenance; only root requirements decide done; merged replaces live", () => {
    const child = (f: ChecklistFact): ChecklistFact => ({ ...f, pass: "sub-agent:research" });
    const merged = [req(0, "r1", "declared", "Root"), child(req(1, "c1", "declared", "Child")), child({ ...req(2, "c1", "satisfied") })];
    const s = projectChecklist(merged);
    expect(s.root.requirements).toEqual({ done: 0, total: 1 });
    expect(s.root.children.map((g) => [g.key, g.requirements.done, g.requirements.total])).toEqual([["sub-agent:research", 1, 1]]);
    const liveOnly = projectChecklist([req(0, "r1", "declared", "Root")], new Map([["sub-agent:research", [req(0, "c1", "declared", "Child")]]]));
    expect(liveOnly.root.children[0]).toMatchObject({ key: "sub-agent:research", live: true });
    const both = projectChecklist(merged, new Map([["sub-agent:research", [req(0, "c1", "declared", "Child")]]]));
    expect(both.root.children).toHaveLength(1);
    expect(both.root.children[0]!.live).toBeUndefined();
    expect(both.root.children[0]!.requirements.done).toBe(1);
  });

  test("retry/continuation passes fold into the owning group; parallel advisory items can both be active", () => {
    const s = projectChecklist([
      item(1, { op: "add", items: [{ id: "1", title: "a" }, { id: "2", title: "b" }] }),
      { ...item(2, { op: "status", id: "1", status: "in_progress" }), pass: "continuation" },
      item(3, { op: "status", id: "2", status: "in_progress" }),
    ]);
    expect(s.root.children).toHaveLength(0);
    expect(s.root.activeAdvisoryIds).toEqual(["1", "2"]);
  });

  test("checklistChanged ignores lastSeq-only differences", () => {
    const a = projectChecklist([req(0, "r1", "declared", "x")]);
    const b = projectChecklist([req(0, "r1", "declared", "x"), item(5, { op: "status", id: "9", status: "completed" })]);
    expect(checklistChanged(undefined, a)).toBe(true);
    expect(checklistChanged(a, b)).toBe(false);
    expect(checklistChanged(a, projectChecklist([req(0, "r1", "declared", "x"), req(1, "r1", "satisfied")]))).toBe(true);
  });

  test("guard accepts only checklist facts", () => {
    expect(isChecklistFact({ kind: "requirement", seq: 0, iteration: 0, requirementId: "r", status: "declared" })).toBe(true);
    expect(isChecklistFact({ kind: "tool-result", seq: 1 })).toBe(false);
  });

  test("tracker builds the live tree from bus events and ignores foreign runs", () => {
    const t = makeChecklistTracker("root");
    t.track({ _tag: "LedgerEntryAppended", taskId: "root", entries: [req(0, "r1", "declared", "Root")] });
    t.track({ _tag: "AgentStarted", taskId: "c1", rootRunId: "root", parentRunId: "root", agentDisplayName: "research" });
    const s = t.track({ _tag: "LedgerEntryAppended", taskId: "c1", entries: [req(0, "x", "declared", "Child")] });
    expect(s!.root.children.map((g) => [g.key, g.live])).toEqual([["sub-agent:research#c1", true]]);
    expect(t.track({ _tag: "LedgerEntryAppended", taskId: "other", entries: [req(0, "z", "declared", "Z")] })).toBeUndefined();
  });

  test("tracker: restored batch seeds (replaces), unchanged snapshot returns undefined", () => {
    const t = makeChecklistTracker("root");
    t.track({ _tag: "LedgerEntryAppended", taskId: "root", entries: [req(0, "r1", "declared", "Old")] });
    const s = t.track({ _tag: "LedgerEntryAppended", taskId: "root", restored: true, entries: [req(0, "r2", "declared", "Seed")] });
    expect(s!.root.rows.map((r) => r.title)).toEqual(["Seed"]);
    expect(t.track({ _tag: "LedgerEntryAppended", taskId: "root", entries: [] })).toBeUndefined();
  });
});

test("tracker emits nothing for an empty first snapshot", () => {
  const t = makeChecklistTracker("root");
  expect(t.track({ _tag: "AgentStarted", taskId: "root", rootRunId: "root" })).toBeUndefined();
  const s = t.track({ _tag: "LedgerEntryAppended", taskId: "root", entries: [req(0, "r1", "declared", "Root")] });
  expect(s!.root.rows).toHaveLength(1);
});

test("tracker keeps rows for same-name sibling sub-agents (keyed by taskId)", () => {
  const t = makeChecklistTracker("root");
  t.track({ _tag: "AgentStarted", taskId: "c1", rootRunId: "root", parentRunId: "root", agentDisplayName: "worker" });
  t.track({ _tag: "AgentStarted", taskId: "c2", rootRunId: "root", parentRunId: "root", agentDisplayName: "worker" });
  t.track({ _tag: "LedgerEntryAppended", taskId: "c1", entries: [req(0, "a", "declared", "First")] });
  const s = t.track({ _tag: "LedgerEntryAppended", taskId: "c2", entries: [req(0, "b", "declared", "Second")] });
  expect(s!.root.children.map((g) => [g.label, g.rows.map((r) => r.title)])).toEqual([
    ["worker", ["First"]],
    ["worker", ["Second"]],
  ]);
});

test("merged ledger facts replace the live entry for that name", () => {
  const live = new Map([["sub-agent:worker#c1", [req(0, "a", "declared", "Live")]]]);
  const s = projectChecklist([{ ...req(0, "m", "satisfied", "Merged"), pass: "sub-agent:worker" }], live);
  expect(s.root.children.map((g) => g.rows.map((r) => r.title))).toEqual([["Merged"]]);
});
