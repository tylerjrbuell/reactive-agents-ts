import { afterEach, describe, expect, test } from "bun:test";
import { exportSessionPlan, parseSessionPlan, putSessionPlan } from "./plan-api.js";
import { importFailureLine, importTextBlank, importTextTooLarge, PLAN_EXPORT_ITEMS, PLAN_IMPORT_MAX_CHARS } from "./plan-transfer.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const stub = (res: Response, seen?: { url?: string; init?: RequestInit }) => {
  globalThis.fetch = (async (u: unknown, init?: RequestInit) => {
    if (seen) { seen.url = String(u); seen.init = init; }
    return res;
  }) as typeof fetch;
};

describe("plan transfer wording", () => {
  test("the menu offers a Markdown copy first and each download format once", () => {
    expect(PLAN_EXPORT_ITEMS[0]).toMatchObject({ format: "markdown", action: "copy" });
    expect(PLAN_EXPORT_ITEMS.filter((i) => i.action === "download").map((i) => i.format)).toEqual(["markdown", "html", "json"]);
    expect(new Set(PLAN_EXPORT_ITEMS.map((i) => i.key)).size).toBe(PLAN_EXPORT_ITEMS.length);
  });

  test("every parse reason reads as a sentence; a JSON syntax detail is kept, a network error is shown as given", () => {
    expect(importFailureLine({ error: "x", reason: "no-steps" })).toContain("No steps found");
    expect(importFailureLine({ error: "x", reason: "invalid-shape" })).toContain("not a plan");
    expect(importFailureLine({ error: "x", reason: "unsupported-version" })).toContain("newer version");
    expect(importFailureLine({ error: "Unexpected token } at 3", reason: "invalid-json" })).toBe("That is not valid JSON. Unexpected token } at 3");
    expect(importFailureLine({ error: "Invalid JSON.", reason: "invalid-json" })).toBe("That is not valid JSON.");
    expect(importFailureLine({ error: "Failed to fetch" })).toBe("Failed to fetch");
  });

  test("blank and oversized text are caught before a call", () => {
    expect(importTextBlank("  \n ")).toBe(true);
    expect(importTextBlank("- a")).toBe(false);
    expect(importTextTooLarge("x".repeat(PLAN_IMPORT_MAX_CHARS + 1))).toBe(true);
  });
});

describe("plan calls", () => {
  test("export returns the text and the server's file name", async () => {
    const seen: { url?: string } = {};
    stub(new Response("# G\n", { headers: { "content-type": "text/markdown", "content-disposition": 'attachment; filename="plan-s1.md"' } }), seen);
    const res = await exportSessionPlan("s 1", "markdown");
    expect(res).toEqual({ ok: true, text: "# G\n", filename: "plan-s1.md", mime: "text/markdown" });
    expect(seen.url).toContain("/api/chat/sessions/s%201/plan/export?format=markdown");
  });

  test("export carries the server's error", async () => {
    stub(new Response(JSON.stringify({ error: "This session has no plan yet" }), { status: 404 }));
    expect(await exportSessionPlan("s", "json")).toEqual({ ok: false, error: "This session has no plan yet" });
  });

  test("parse surfaces the framework reason, and success hands back the plan", async () => {
    stub(new Response(JSON.stringify({ error: "No checklist or list items found in the Markdown.", reason: "no-steps" }), { status: 422 }));
    expect(await parseSessionPlan("s", "prose")).toEqual({ ok: false, error: "No checklist or list items found in the Markdown.", reason: "no-steps" });
    const plan = { id: "p", goal: "g", steps: [], createdAt: 1, source: "user-edited" as const };
    stub(new Response(JSON.stringify({ plan })));
    expect(await parseSessionPlan("s", "- a")).toEqual({ ok: true, plan });
  });

  test("a network failure is a failure, not a throw", async () => {
    globalThis.fetch = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const res = await parseSessionPlan("s", "- a");
    expect(res.ok).toBe(false);
  });

  test("putSessionPlan sends the goal only when given", async () => {
    const seen: { init?: RequestInit } = {};
    stub(new Response(JSON.stringify({ plan: null })), seen);
    await putSessionPlan("s", [{ id: "1", title: "a", status: "pending" }]);
    expect(JSON.parse(String(seen.init?.body))).toEqual({ steps: [{ id: "1", title: "a", status: "pending" }] });
    await putSessionPlan("s", [{ id: "1", title: "a", status: "pending" }], "Goal");
    expect(JSON.parse(String(seen.init?.body)).goal).toBe("Goal");
  });

  test("putSessionPlan sends findings only when given (an empty list clears them)", async () => {
    const seen: { init?: RequestInit } = {};
    stub(new Response(JSON.stringify({ plan: null })), seen);
    const step = [{ id: "1", title: "a", status: "pending" as const }];
    await putSessionPlan("s", step);
    expect("findings" in JSON.parse(String(seen.init?.body))).toBe(false);
    await putSessionPlan("s", step, undefined, []);
    expect(JSON.parse(String(seen.init?.body)).findings).toEqual([]);
  });
});
