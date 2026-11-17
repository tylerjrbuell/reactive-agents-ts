import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { MARK_NODES, markRingPath, markSpokesPath, markStroke } from "../../neural-mark.js";
import { renderComponent } from "./test-render.js";

const FILE = join(import.meta.dir, "NeuralMark.svelte");

describe("neural mark geometry", () => {
  test("eight nodes, a closed ring and one spoke per node", () => {
    expect(MARK_NODES).toHaveLength(8);
    expect(markRingPath().match(/M/g)).toHaveLength(8);
    expect(markRingPath().endsWith("L14 6")).toBe(true);
    expect(markSpokesPath().match(/M24 24/g)).toHaveLength(8);
  });

  test("strokes are heavier below 32px", () => {
    expect(markStroke(22).ring).toBeGreaterThan(markStroke(64).ring);
  });
});

describe("NeuralMark", () => {
  test("bar size: no halo, no twinkle, theme tokens for colour", async () => {
    const html = await renderComponent(FILE, { size: 22 });
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('viewBox="0 0 48 48"');
    expect(html).not.toContain("cx-mark-tw");
    expect(html).not.toContain("radialGradient");
    expect(html).toContain("var(--cortex-mk-violet)");
    expect(html).not.toMatch(/#[0-9a-f]{6}/i);
  });

  test("hero: halo and staggered twinkle", async () => {
    const html = await renderComponent(FILE, { size: 96, hero: true });
    expect(html).toContain("radialGradient");
    expect(html.match(/cx-mark-tw/g)?.length).toBe(8);
    expect(html).toContain("animation-delay:-0.9s");
  });

  test("hero: core drift and orbit breathing; the mark itself draws no sonar", async () => {
    const html = await renderComponent(FILE, { size: 96, hero: true });
    expect(html).toContain("cx-mark-core");
    expect(html).toContain("cx-mark-orbit");
    expect(html).not.toContain("sonar");
    const bar = await renderComponent(FILE, { size: 22 });
    expect(bar).not.toContain("cx-mark-core");
  });

  test("reduced motion stills every mark animation", async () => {
    const src = await Bun.file(FILE).text();
    const css = src.slice(src.indexOf("<style>"));
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain('html[data-motion="reduce"]');
    for (const cls of ["cx-mark-tw", "cx-mark-core", "cx-mark-orbit"]) {
      expect(css.match(new RegExp(`\\.${cls}`, "g"))!.length).toBeGreaterThanOrEqual(3);
    }
  });

  test("gradients are referenced by the instance id", async () => {
    const html = await renderComponent(FILE, {});
    const id = /id="([^"]+)-ring"/.exec(html)?.[1];
    expect(id).toBeDefined();
    expect(html).toContain(`url(#${id}-ring)`);
  });
});
