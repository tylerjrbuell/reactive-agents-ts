import { describe, expect, test } from "bun:test";
import { foldAdvisory, type AdvisoryItem, type ChecklistItemFact } from "@reactive-agents/core";
import { applyTodoChecklistAction, todoTool } from "../src/skills/todo.js";
import { isNearDuplicateTitle, normalizeTitle } from "@reactive-agents/core";
import { extractAddItems } from "../src/skills/todo-add.js";

function makeSession() {
  const facts: ChecklistItemFact[] = [];
  let seq = 0;
  return {
    items: (): readonly AdvisoryItem[] => foldAdvisory(facts),
    run(args: Record<string, unknown>, posture: "execute" | "plan" = "execute") {
      const r = applyTodoChecklistAction(foldAdvisory(facts), args, posture, facts.map((f) => f.change));
      for (const c of r.changes) facts.push({ kind: "checklist-item", seq: ++seq, iteration: 1, change: c });
      return r;
    },
  };
}

describe("todo add: structured per-item tool", () => {
  test("object items carry tool into the op and the fold", () => {
    const s = makeSession();
    const r = s.run({ action: "add", items: [{ text: "list sites", tool: "umami/list_websites" }, { text: "summarize" }] });
    expect(r.changes[0]).toEqual({
      op: "add",
      items: [{ id: "1", title: "list sites", tool: "umami/list_websites" }, { id: "2", title: "summarize" }],
    });
    expect(s.items()[0]?.tool).toBe("umami/list_websites");
    expect(s.items()[1]?.tool).toBeUndefined();
  });

  test("parallel tools array aligns by index; empty string means none", () => {
    const s = makeSession();
    s.run({ action: "add", items: ["a step", "b step"], tools: ["", "tool-b"] });
    expect(s.items().map((t) => t.tool)).toEqual([undefined, "tool-b"]);
  });

  test("healed alias `tool` and a `tool:` label prefix", () => {
    const s = makeSession();
    s.run({ action: "add", items: ["only step"], tool: "tool: web-search" });
    expect(s.items()[0]?.tool).toBe("web-search");
  });

  test("plain string items stay byte-compatible (no tool key)", () => {
    const s = makeSession();
    const r = s.run({ action: "add", items: ["x", "y"] });
    expect(r.changes).toEqual([{ op: "add", items: [{ id: "1", title: "x" }, { id: "2", title: "y" }] }]);
  });

  test("tool schema advertises tools param and description names it", () => {
    expect(todoTool.parameters.some((p) => p.name === "tools")).toBe(true);
    expect(todoTool.description).toContain("tools array");
  });

  test("extractAddItems tolerates junk entries", () => {
    expect(extractAddItems([1, null, { nope: 1 }, { text: "  " }, { title: "t", tool: 5 }])).toEqual([{ text: "t" }]);
  });
});

describe("todo add: near-duplicate dedupe", () => {
  test("rephrased restatement of an existing row is skipped (plan wording)", () => {
    const s = makeSession();
    s.run({ action: "add", items: ["List all websites in Umami"] }, "plan");
    const r = s.run({ action: "add", items: ["list the websites in umami."] }, "plan");
    expect(r.changes).toEqual([]);
    expect(r.rendered).toContain("Nothing new added: these are already on the plan.");
    expect(s.items().length).toBe(1);
  });

  test("candidate wholly inside a 3+ word existing title is skipped", () => {
    const s = makeSession();
    s.run({ action: "add", items: ["Fetch the page view stats for each site"] });
    const r = s.run({ action: "add", items: ["fetch page view stats"] });
    expect(r.changes).toEqual([]);
  });

  test("near-duplicates inside one call collapse", () => {
    const s = makeSession();
    const r = s.run({ action: "add", items: ["Summarize traffic trends", "summarize the traffic trends"] });
    expect(s.items().length).toBe(1);
    expect(r.rendered).toContain("Repeated in this call");
  });

  test("distinct steps are not merged", () => {
    const s = makeSession();
    s.run({ action: "add", items: ["List websites", "Fetch pageviews for site", "Write summary report"] });
    expect(s.items().length).toBe(3);
  });

  test("one-word candidate never matches by containment", () => {
    expect(isNearDuplicateTitle("test", "run the test suite now")).toBe(false);
    expect(isNearDuplicateTitle("run tests", "run the test suite now")).toBe(false);
  });
});

describe("local fold mirrors core tool-hint fallback", () => {
  test("hint in title becomes row tool in the local fold; explicit tool wins", async () => {
    const { applyTodoOps } = await import("../src/skills/todo-manage.js");
    const { planStepToolHint } = await import("@reactive-agents/core");
    const title = "List sites (tool: umami/list_websites)";
    const items = applyTodoOps([], [
      { op: "add", items: [{ id: "1", title }, { id: "2", title, tool: "other/tool" }] },
    ]);
    expect(items[0]?.tool).toBe(planStepToolHint(title));
    expect(items[0]?.tool).toBe("umami/list_websites");
    expect(items[1]?.tool).toBe("other/tool");
  });
});

describe("near-duplicate: each branch pinned on its own", () => {
  test("overlap-only: 8 of 9 shared words (0.89), neither title contains the other", () => {
    const a = "w1 w2 w3 w4 w5 w6 w7 w8 xa";
    const b = "w1 w2 w3 w4 w5 w6 w7 w8 xb";
    expect(isNearDuplicateTitle(a, b)).toBe(true);
    expect(isNearDuplicateTitle(b, a)).toBe(true);
    const s = makeSession();
    s.run({ action: "add", items: [a] });
    expect(s.run({ action: "add", items: [b] }).changes).toEqual([]);
  });
  test("just under the overlap bar (3 of 5 = 0.6; 4 of 6 = 0.67) does not dedupe", () => {
    // Unified core rule is shared/max (old tools rule was Jaccard): 7 of 8 shared now dedupes.
    expect(isNearDuplicateTitle("w1 w2 w3 w4 w5 w6 w7 xa", "w1 w2 w3 w4 w5 w6 w7 xb")).toBe(true);
    expect(isNearDuplicateTitle("w1 w2 w3 w4 yy zz", "w1 w2 w3 w4 xa xb")).toBe(false);
    expect(isNearDuplicateTitle("a1 a2 a3 b1 b2", "a1 a2 a3 c1 c2")).toBe(false);
    const s = makeSession();
    s.run({ action: "add", items: ["a1 a2 a3 b1 b2"] });
    expect(s.run({ action: "add", items: ["a1 a2 a3 c1 c2"] }).changes.length).toBe(1);
  });
  test("containment-only: low overlap but smaller title (2+ words) wholly inside the larger", () => {
    const cand = normalizeTitle("fetch stats");
    const ex = normalizeTitle("fetch the page view stats for each site");
    expect(cand.size / ex.size).toBeLessThan(0.8);
    expect(isNearDuplicateTitle("fetch stats", "fetch the page view stats for each site")).toBe(true);
    expect(isNearDuplicateTitle("fetch stats", "fetch stats")).toBe(true);
    // Unified rule: 2+ tokens contained in a 2-token-larger title also dedupes (old tools rule needed 3+).
    expect(isNearDuplicateTitle("x y z", "x y")).toBe(true);
    // single-token smaller title never matches by containment
    expect(isNearDuplicateTitle("x y z", "x")).toBe(false);
  });
  test("umami trace: re-sent step without its inline tool hint dedupes", () => {
    const s = makeSession();
    s.run({ action: "add", items: [{ text: "Identify which website(s) to analyze. (tool: umami/list_websites)" }] });
    const r = s.run({ action: "add", items: ["Identify which website(s) to analyze"] });
    expect(r.changes).toEqual([]);
    expect(s.items().length).toBe(1);
  });
});

describe("near-duplicate: tool hints never count as words (both directions)", () => {
  const plain = "Identify which website(s) to analyze";
  const hinted = "Identify which website(s) to analyze (tool: umami/list_websites)";
  test("hinted re-sent over plain row adds no row; only attaches the tool", () => {
    const s = makeSession();
    s.run({ action: "add", items: [plain] });
    expect(s.run({ action: "add", items: [hinted] }).changes).toEqual([
      { op: "tool", id: "1", tool: "umami/list_websites" },
    ]);
    expect(s.items().length).toBe(1);
  });
  test("plain re-sent over hinted row changes nothing", () => {
    const s = makeSession();
    s.run({ action: "add", items: [hinted] });
    expect(s.run({ action: "add", items: [plain] }).changes).toEqual([]);
    expect(s.items().length).toBe(1);
  });
  test("hint forms are stripped: bare, parenthesised, list", () => {
    const base = normalizeTitle("Fetch page views for the site");
    for (const h of ["tool: a/b", "(tool: a/b)", "(tools: a, b-c)", "Tool: `x_y`"]) {
      expect(normalizeTitle(`Fetch page views for the site ${h}`)).toEqual(base);
    }
  });
});
