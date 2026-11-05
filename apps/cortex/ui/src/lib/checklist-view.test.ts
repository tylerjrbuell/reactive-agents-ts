import { describe, expect, it } from "bun:test";
import type { ChecklistGroupWire, ChecklistRowWire, ChecklistSnapshotWire } from "@reactive-agents/ui-core";
import { checklistView, rowNote } from "./checklist-view.js";

const row = (id: string, kind: ChecklistRowWire["kind"], status: ChecklistRowWire["status"], reason?: string): ChecklistRowWire => ({
  id, kind, title: id, status, ...(reason ? { reason } : {}),
});

function group(key: string, rows: ChecklistRowWire[], children: ChecklistGroupWire[] = [], live?: boolean): ChecklistGroupWire {
  const count = (k: ChecklistRowWire["kind"]) => {
    const r = rows.filter((x) => x.kind === k);
    return { done: r.filter((x) => x.status === "done").length, total: r.length };
  };
  return {
    key, label: key, rows, requirements: count("requirement"), advisory: count("advisory"),
    activeAdvisoryIds: rows.filter((r) => r.status === "in_progress").map((r) => r.id), children,
    ...(live !== undefined ? { live } : {}),
  };
}
const snap = (root: ChecklistGroupWire): ChecklistSnapshotWire => ({ root, lastSeq: 1 });

describe("checklistView", () => {
  it("plan rows (source plan) get their own section and label, separate from to-do rows", () => {
    const plan = (id: string, status: ChecklistRowWire["status"]): ChecklistRowWire => ({ ...row(id, "advisory", status), source: "plan" });
    const v = checklistView(snap(group("root", [row("r1", "requirement", "pending"), plan("s1", "done"), plan("s2", "in_progress"), row("a1", "advisory", "pending")])));
    expect(v.sections.plan.map((r) => r.id)).toEqual(["s1", "s2"]);
    expect(v.sections.advisory.map((r) => r.id)).toEqual(["a1"]);
    expect(v.planLabel).toBe("Plan 1/2");
    expect(checklistView(snap(group("root", [row("r1", "requirement", "pending")]))).planLabel).toBe("");
  });
  it("advisory all done but requirement pending: progress < 100, no collapse", () => {
    const v = checklistView(snap(group("root", [row("r1", "requirement", "pending"), row("a1", "advisory", "done"), row("a2", "advisory", "done")])));
    expect(v.progressPct).toBeLessThan(100);
    expect(v.collapsedByDefault).toBe(false);
  });
  it("collapses once every requirement is done", () => {
    const v = checklistView(snap(group("root", [row("r1", "requirement", "done"), row("a1", "advisory", "pending")])));
    expect(v.progressPct).toBe(100);
    expect(v.collapsedByDefault).toBe(true);
  });
  it("no requirements: progress from advisory and label says to-do", () => {
    const v = checklistView(snap(group("root", [row("a1", "advisory", "done"), row("a2", "advisory", "pending")])));
    expect(v.progressPct).toBe(50);
    expect(v.label.toLowerCase()).toContain("to-do");
    expect(v.collapsedByDefault).toBe(false);
  });
  it("blocked row carries reason", () => {
    const v = checklistView(snap(group("root", [row("a1", "advisory", "blocked", "needs key")])));
    expect(v.sections.advisory[0]?.reason).toBe("needs key");
  });
  it("children nested with own progress; root ignores them", () => {
    const kidA = group("a", [row("x", "advisory", "done"), row("y", "advisory", "done")], [], true);
    const kidB = group("b", [row("z", "requirement", "pending")], [], false);
    const v = checklistView(snap(group("root", [row("r1", "requirement", "done")], [kidA, kidB])));
    expect(v.progressPct).toBe(100);
    expect(v.children.map((c) => c.key)).toEqual(["a", "b"]);
    expect(v.children[0]?.progressPct).toBe(100);
    expect(v.children[1]?.progressPct).toBe(0);
    expect(v.children[0]?.live).toBe(true);
  });
  it("currentAdvisory is the first in-progress advisory row; extras stay plain rows", () => {
    const v = checklistView(snap(group("root", [row("a1", "advisory", "done"), row("a2", "advisory", "in_progress"), row("a3", "advisory", "in_progress")])));
    expect(v.currentAdvisory?.id).toBe("a2");
    expect(v.sections.advisory.map((r) => r.id)).toEqual(["a1", "a2", "a3"]);
  });
  it("currentAdvisory ignores requirement rows and is undefined when none active", () => {
    const v = checklistView(snap(group("root", [row("r1", "requirement", "in_progress"), row("a1", "advisory", "pending")])));
    expect(v.currentAdvisory).toBeUndefined();
  });
  it("advisoryDone only when advisory rows exist and all are done; never affects goal progress", () => {
    const all = checklistView(snap(group("root", [row("r1", "requirement", "pending"), row("a1", "advisory", "done")])));
    expect(all.advisoryDone).toBe(true);
    expect(all.progressPct).toBe(0);
    expect(all.collapsedByDefault).toBe(false);
    expect(checklistView(snap(group("root", [row("a1", "advisory", "done"), row("a2", "advisory", "pending")]))).advisoryDone).toBe(false);
    expect(checklistView(snap(group("root", [row("r1", "requirement", "done")]))).advisoryDone).toBe(false);
  });
});

describe("rowNote", () => {
  const ev = { seq: 4, kind: "tool-result" as const, detail: "file-read ./cfg.json" };
  it("inferred advisory row: tooltip names evidence kind and detail; counts stay advisory-done", () => {
    const r: ChecklistRowWire = { id: "a1", kind: "advisory", title: "a1", status: "done", source: "inferred", evidence: ev };
    expect(rowNote(r, true)).toEqual({ kind: "inferred", tooltip: "Inferred from tool-result: file-read ./cfg.json" });
    const v = checklistView(snap(group("root", [r, row("a2", "advisory", "pending")])));
    expect(v.label).toBe("To-do 1/2");
  });
  it("pending explicit/absent source is unmarked only after the turn completed", () => {
    const p = row("a1", "advisory", "pending");
    expect(rowNote(p, false)).toBeUndefined();
    expect(rowNote(p, true)).toEqual({ kind: "unmarked" });
    expect(rowNote({ ...p, source: "explicit" }, true)).toEqual({ kind: "unmarked" });
  });
  it("done explicit, in-progress and requirement rows get no note; old snapshots unaffected", () => {
    expect(rowNote(row("a1", "advisory", "done"), true)).toBeUndefined();
    expect(rowNote(row("a1", "advisory", "in_progress"), true)).toBeUndefined();
    expect(rowNote(row("r1", "requirement", "pending"), true)).toBeUndefined();
  });
  it("inferred without evidence (malformed) degrades to no note", () => {
    expect(rowNote({ id: "a", kind: "advisory", title: "a", status: "done", source: "inferred" }, true)).toBeUndefined();
  });
});
