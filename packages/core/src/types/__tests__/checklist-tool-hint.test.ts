import { describe, expect, test } from "bun:test";
import {
  foldAdvisory,
  planStepToolHint,
  planStepToolHints,
  projectChecklist,
  type ChecklistFact,
  type ChecklistItemOp,
} from "../checklist.js";

const T1 = "List all tracked websites (tool: umami/list_websites) to identify the targets";
const T2 = "Review session and event details (tools: umami/get_sessions, umami/get_events) for each site";

const add = (seq: number, items: { id: string; title: string; tool?: string }[]): ChecklistFact => ({
  kind: "checklist-item",
  seq,
  iteration: 1,
  change: { op: "add", items } as ChecklistItemOp,
});

describe("planStepToolHint(s)", () => {
  test("marker forms", () => {
    expect(planStepToolHint("do it, tool: web-search")).toBe("web-search");
    expect(planStepToolHint("do it (tool: file_read)")).toBe("file_read");
    expect(planStepToolHint("use tool: `umami/list_websites`.")).toBe("umami/list_websites");
    expect(planStepToolHint("Tool: x.")).toBe("x");
  });
  test("list variant", () => {
    expect(planStepToolHints(T2)).toEqual(["umami/get_sessions", "umami/get_events"]);
    expect(planStepToolHint(T2)).toBe("umami/get_sessions");
    expect(planStepToolHints("tools: `a`, `b-c`")).toEqual(["a", "b-c"]);
  });
  test("no marker, never throws", () => {
    expect(planStepToolHint("use the web-search tool to look")).toBeUndefined();
    expect(planStepToolHints("")).toEqual([]);
    expect(planStepToolHints(undefined as unknown as string)).toEqual([]);
  });
});

describe("foldAdvisory tool hint", () => {
  test("screenshot titles get a tool; titles unchanged", () => {
    const items = foldAdvisory([add(1, [{ id: "1", title: T1 }, { id: "2", title: T2 }])]);
    expect(items[0]?.tool).toBe("umami/list_websites");
    expect(items[0]?.title).toBe(T1);
    expect(items[1]?.tool).toBe("umami/get_sessions");
  });
  test("explicit tool wins", () => {
    const items = foldAdvisory([add(1, [{ id: "1", title: T1, tool: "other" }])]);
    expect(items[0]?.tool).toBe("other");
  });
  test("no marker leaves tool absent (key not present)", () => {
    const items = foldAdvisory([add(1, [{ id: "1", title: "Plain step" }])]);
    expect("tool" in items[0]!).toBe(false);
  });
  test("projected row carries the tool", () => {
    const snap = projectChecklist([add(1, [{ id: "1", title: T1 }])]);
    expect(snap.root.rows.find((r) => r.id === "1")?.tool).toBe("umami/list_websites");
  });
});

describe("foldAdvisory tool op", () => {
  const op = (seq: number, change: ChecklistItemOp): ChecklistFact => ({ kind: "checklist-item", seq, iteration: 1, change });
  const base = [
    add(1, [{ id: "1", title: "first" }, { id: "2", title: "second (tool: from-text)" }, { id: "3", title: "third" }]),
    op(2, { op: "status", id: "1", status: "in_progress" }),
  ];

  test("sets tool, preserves order/status/title", () => {
    const items = foldAdvisory([...base, op(3, { op: "tool", id: "1", tool: "web-search" })]);
    expect(items.map((i) => i.id)).toEqual(["1", "2", "3"]);
    expect(items[0]).toMatchObject({ id: "1", title: "first", status: "in_progress", tool: "web-search" });
  });
  test("explicit wins over text hint", () => {
    const items = foldAdvisory([...base, op(3, { op: "tool", id: "2", tool: "explicit" })]);
    expect(items[1]?.tool).toBe("explicit");
  });
  test("clear falls back to text hint, or none", () => {
    const cleared = foldAdvisory([...base, op(3, { op: "tool", id: "2", tool: "explicit" }), op(4, { op: "tool", id: "2" })]);
    expect(cleared[1]?.tool).toBe("from-text");
    const none = foldAdvisory([...base, op(3, { op: "tool", id: "1", tool: "x" }), op(4, { op: "tool", id: "1", tool: "  " })]);
    expect("tool" in none[0]!).toBe(false);
  });
  test("unknown id is a no-op; unused keeps snapshot identical", () => {
    const noop = [...base, op(3, { op: "tool", id: "zzz", tool: "x" })];
    expect(foldAdvisory(noop)).toEqual(foldAdvisory(base));
    expect(JSON.stringify(projectChecklist(noop).root)).toBe(JSON.stringify(projectChecklist(base).root));
  });
  test("projection row carries the tool", () => {
    const row = projectChecklist([...base, op(3, { op: "tool", id: "3", tool: "t" })]).root.rows.find((r) => r.id === "3");
    expect(row?.tool).toBe("t");
  });
});
