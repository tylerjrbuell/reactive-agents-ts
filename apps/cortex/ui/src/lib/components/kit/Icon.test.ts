import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ICON_NAMES, ICON_PATHS } from "../../icons.js";
import { renderComponent } from "./test-render.js";

const FILE = join(import.meta.dir, "Icon.svelte");

describe("Icon", () => {
  test("every icon has SVG content and no ligature text", () => {
    for (const name of ICON_NAMES) {
      expect(ICON_PATHS[name]).toMatch(/^<(path|circle|rect)/);
    }
  });

  test("renders an aria-hidden inline SVG at the size step", async () => {
    const html = await renderComponent(FILE, { name: "search", size: "sm" });
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('width="14"');
    expect(html).toContain('data-icon="search"');
    expect(html).toContain("<circle");
    // No visible text node: the icon never contributes to an accessible name.
    expect(html.replace(/<[^>]+>/g, "").trim()).toBe("");
  });

  test("defaults to 16px", async () => {
    const html = await renderComponent(FILE, { name: "check" });
    expect(html).toContain('width="16"');
  });
});
