import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { renderComponent } from "./kit/test-render.js";

const file = join(import.meta.dir, "TopBarEdge.svelte");

describe("TopBarEdge", () => {
  test("running renders the track with a travelling highlight", async () => {
    const html = await renderComponent(file, { state: "run" });
    expect(html).toContain('data-state="run"');
    expect(html).toContain('role="progressbar"');
    expect(html).not.toContain("aria-valuenow");
    expect(html).toContain('data-testid="topbar-edge-highlight"');
    expect(html).toContain('data-motion="travel"');
  });
  test("stopping renders the calm travelling highlight", async () => {
    const html = await renderComponent(file, { state: "calm" });
    expect(html).toContain('data-state="calm"');
    expect(html).toContain('data-motion="travel"');
  });
  test("idle renders nothing", async () => {
    const html = await renderComponent(file, { state: "off" });
    expect(html).not.toContain("topbar-edge");
    expect(html).not.toContain("travel");
  });
});
