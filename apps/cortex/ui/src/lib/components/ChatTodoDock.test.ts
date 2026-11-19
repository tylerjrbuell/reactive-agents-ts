/** Server-render of the to-do dock: in-progress rows reuse the header's spinner ring, not a rotated icon. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { checklistReconciliationOf } from "@reactive-agents/ui-core";
import { renderComponent } from "./kit/test-render.js";

const file = join(import.meta.dir, "ChatTodoDock.svelte");
const markup = (html: string): string => html.replace(/<!--[^]*?-->/g, "");

const g = globalThis as { localStorage?: unknown };
let saved: unknown;
beforeEach(() => {
  saved = g.localStorage;
  g.localStorage = { getItem: () => "1", setItem: () => undefined };
});
afterEach(() => {
  g.localStorage = saved;
});

describe("ChatTodoDock spinner", () => {
  test("an in-progress row renders the same .spin ring as the header", async () => {
    const html = markup(
      await renderComponent(file, {
        items: [
          { id: "1", title: "Fetch", status: "in_progress" },
          { id: "2", title: "Write", status: "pending" },
        ],
        enabled: true,
        onChange: () => undefined,
      }),
    );
    expect(html).toContain('data-testid="todo-now"');
    expect(html).toContain('data-testid="todo-row-spin"');
    // Header ring + row ring: both carry the one `spin` class.
    expect(html.match(/class="spin[ "]/g)?.length ?? 0).toBe(2);
  });

  test("a pending row gets no spinner", async () => {
    const html = markup(
      await renderComponent(file, {
        items: [{ id: "1", title: "Write", status: "pending" }],
        enabled: true,
        onChange: () => undefined,
      }),
    );
    expect(html).not.toContain("todo-row-spin");
  });
});

describe("ChatTodoDock run reconciliation", () => {
  test("shows where harness-closed rows came from and why unresolved rows stayed open", async () => {
    const reconciliation = checklistReconciliationOf({
      total: 3,
      done: 2,
      closedByHarness: [
        { id: "1", title: "Search", provenance: "harness:evidence" },
        { id: "2", title: "Write", provenance: "harness:answer" },
      ],
      unresolved: [{ id: "3", title: "Email", status: "pending", reason: "no evidence" }],
    });
    const html = markup(
      await renderComponent(file, {
        items: [
          { id: "1", title: "Search", status: "completed" },
          { id: "2", title: "Write", status: "completed" },
          { id: "3", title: "Email", status: "pending" },
        ],
        enabled: true,
        turnComplete: true,
        reconciliation,
        onChange: () => undefined,
      }),
    );
    expect(html).toContain("closed by the harness from a tool result");
    expect(html).toContain("closed by the harness: the answer delivered it");
    expect(html).toContain('data-testid="unresolved-note"');
    expect(html).toContain("not done: no evidence recorded");
    expect(html).not.toContain("not marked done");
  });
});
