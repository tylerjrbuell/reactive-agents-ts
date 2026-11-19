/** Server-render of the to-do dock: in-progress rows reuse the header's spinner ring, not a rotated icon. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
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
