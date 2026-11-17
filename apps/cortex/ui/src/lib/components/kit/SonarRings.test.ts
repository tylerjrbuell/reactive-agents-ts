import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { htmlSnippet, renderComponent } from "./test-render.js";

const kit = (name: string): string => join(import.meta.dir, `${name}.svelte`);

describe("SonarRings (Beacon first-run ambient rings)", () => {
  test("three decorative rings around the child, calm while idle", async () => {
    const html = await renderComponent(kit("SonarRings"), { size: 132, children: htmlSnippet("<b>mark</b>") });
    expect(html.match(/class="cx-sonar-ring[ "]/g)?.length).toBe(3);
    expect(html).toContain("<b>mark</b>");
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("cx-sonar-live");
  });

  test("live is a distinct, faster state", async () => {
    const html = await renderComponent(kit("SonarRings"), { size: 132, live: true, children: htmlSnippet("x") });
    expect(html).toContain("cx-sonar-live");
  });

  test("hero EmptyState draws rings only when asked; plain and non-ring heroes never", async () => {
    const ring = await renderComponent(kit("EmptyState"), { hero: true, markRings: true, title: "t" });
    expect(ring.match(/class="cx-sonar-ring[ "]/g)?.length).toBe(3);
    const hero = await renderComponent(kit("EmptyState"), { hero: true, title: "t" });
    expect(hero).not.toContain("cx-sonar");
  });

  test("reduced motion: still rings at fixed radii, no animation, for OS and app setting", async () => {
    const css = (await Bun.file(kit("SonarRings")).text()).slice((await Bun.file(kit("SonarRings")).text()).indexOf("<style>"));
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain('html[data-motion="reduce"]');
    expect(css.match(/animation: none/g)!.length).toBe(2);
    expect(css).not.toMatch(/(?:background|box-shadow|filter)\s*:/);
  });
});
