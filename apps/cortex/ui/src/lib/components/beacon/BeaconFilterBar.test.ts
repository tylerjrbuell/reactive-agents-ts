/**
 * Rendering test for the Field's filter bar: the chips with counts, the search
 * box, the "12 of 48" count while narrowed, and Clear only while narrowed.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { renderComponent } from "../kit/test-render.js";

const bar = join(import.meta.dir, "BeaconFilterBar.svelte");
const text = (html: string): string => html.replace(/<!--[^]*?-->/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const counts = { all: 48, running: 5, "needs-you": 0, failed: 2, idle: 41 };

describe("BeaconFilterBar", () => {
  test("shows every chip, counts for non-empty ones, and the whole total when not narrowed", async () => {
    const html = await renderComponent(bar, {
      filter: { status: "all", query: "" },
      counts,
      shown: 48,
      total: 48,
      onfilter: () => {},
    });
    const t = text(html);
    for (const label of ["All", "Running5", "Needs you", "Failed2", "Idle41"]) expect(t).toContain(label);
    expect(t).not.toContain("Needs you0");
    expect(html).toContain('aria-label="Search agents"');
    expect(t).toContain("48");
    expect(t).not.toContain("Clear");
  });

  test("narrowed: reads '12 of 48', marks the chip pressed and offers Clear", async () => {
    const html = await renderComponent(bar, {
      filter: { status: "running", query: "sol" },
      counts,
      shown: 12,
      total: 48,
      onfilter: () => {},
    });
    expect(text(html)).toContain("12 of 48");
    expect(text(html)).toContain("Clear");
    expect(html).toMatch(/aria-pressed="true"[^>]*>[^]*?Running/);
    expect(html).toContain('value="sol"');
  });
});
