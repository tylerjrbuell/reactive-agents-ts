/** Server-render of the plan transfer controls: export needs a saved plan, import only on the editable card. */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { renderComponent } from "../kit/test-render.js";

const file = join(import.meta.dir, "PlanTransferMenu.svelte");
const markup = (html: string): string => html.replace(/<!--[^]*?-->/g, "");

describe("PlanTransferMenu", () => {
  test("editable card with a saved plan: Export and Import", async () => {
    const html = markup(await renderComponent(file, { idBase: "t", canExport: true, canImport: true }));
    expect(html).toContain('data-testid="plan-export"');
    expect(html).toContain('data-testid="plan-import"');
  });

  test("past card: Export only; no saved plan: neither", async () => {
    const past = markup(await renderComponent(file, { idBase: "t", canExport: true, canImport: false }));
    expect(past).toContain('data-testid="plan-export"');
    expect(past).not.toContain('data-testid="plan-import"');
    const none = markup(await renderComponent(file, { idBase: "t", canExport: false, canImport: false }));
    expect(none).not.toContain("plan-export");
    expect(none).not.toContain("plan-import");
  });
});
