import { describe, expect, it } from "bun:test";
import type { ChecklistGroupWire, ChecklistRowWire, ChecklistSnapshotWire } from "@reactive-agents/ui-core";
import { checklistView } from "./checklist-view.js";

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
