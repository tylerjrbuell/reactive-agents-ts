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
